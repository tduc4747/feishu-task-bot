const cron = require('node-cron');
const { sendCard, sendCardToChat, formatText, formatDate } = require('./helpers');
const { getAllTasks, getMediaMembers, getAdminIds } = require('./db');
const { getAllSettings } = require('./settings');
const { renderMessage } = require('./messages');
const { syncAllTasksToBitable } = require('./bitable');
const { cardMorningMedia, cardMorningAdmin } = require('./cards');
const config = require('./config');

const { STATUS, COLS, SCHEDULE } = config;

// ─── Gửi thông báo sáng ─────────────────────────────────────────
async function sendMorningNotifications() {
  console.log('Sending morning notifications...');

  try {
    const [allTasks, settings] = await Promise.all([getAllTasks(), getAllSettings()]);
    const activeStatuses = [STATUS.DANG_CHO, STATUS.DANG_LAM, STATUS.CHO_CHECK];

    // ── Thông báo cho từng media (task của riêng họ) ─
    const mediaMembers = await getMediaMembers();

    for (const member of mediaMembers) {
      const myTasks = allTasks.filter(t => {
        const nguoiThucHien = t.fields[COLS.NGUOI_THUC_HIEN];
        if (!nguoiThucHien || !Array.isArray(nguoiThucHien)) return false;
        const isAssigned = nguoiThucHien.some(u => u.id === member.id);
        const status = t.fields[COLS.TRANG_THAI];
        return isAssigned && activeStatuses.includes(status);
      });

      if (myTasks.length > 0) {
        const greeting = await renderMessage('morning_media_greeting', { ten_nguoi_nhan: member.name });
        await sendCard(member.id, cardMorningMedia(myTasks, greeting));
      }
    }

    // ── Báo cáo cho admin: task chờ gán (đầy đủ chi tiết) + task đang xử lý (gom theo người) ──
    const pendingTasks = allTasks.filter(t => t.fields[COLS.TRANG_THAI] === STATUS.CHO_GAN);
    const activeTasks = allTasks.filter(t => [STATUS.DANG_LAM, STATUS.CHO_CHECK].includes(t.fields[COLS.TRANG_THAI]));

    const grouped = {};
    for (const t of activeTasks) {
      const nguoiThucHien = t.fields[COLS.NGUOI_THUC_HIEN];
      const person = Array.isArray(nguoiThucHien) ? nguoiThucHien[0] : null;
      const key = person?.id || 'unknown';
      if (!grouped[key]) grouped[key] = { name: person?.name || 'Không có', tasks: [] };
      grouped[key].tasks.push({
        taskName: formatText(t.fields[COLS.TASK_NAME]),
        trangThai: formatText(t.fields[COLS.TRANG_THAI]),
        deadline: formatDate(t.fields[COLS.DEADLINE]),
      });
    }
    const tasksByPerson = Object.values(grouped);
    const adminTitle = await renderMessage('morning_admin_title', {});
    const adminCard = cardMorningAdmin(pendingTasks, tasksByPerson, adminTitle);

    if (settings.morning_report_target === 'group' && settings.morning_report_group_chat_id) {
      await sendCardToChat(settings.morning_report_group_chat_id, adminCard);
    } else {
      const admins = await getAdminIds();
      for (const admin of admins) await sendCard(admin.id, adminCard);
    }

    console.log('Morning notifications sent!');
  } catch (err) {
    console.error('Scheduler error:', err.message, err.stack);
  }
}

// ─── Đồng bộ Postgres -> Bitable định kỳ (chỉ để xem bằng spreadsheet) ───
async function runBitableSync() {
  try {
    await syncAllTasksToBitable();
    console.log('Bitable sync xong.');
  } catch (err) {
    console.error('Bitable sync lỗi:', err.message);
  }
}

// ─── Khởi động scheduler ────────────────────────────────────────
// Báo cáo sáng đọc giờ/phút/ngày từ bảng settings mỗi phút (cho phép đổi qua
// dashboard mà không cần restart bot), chỉ gửi 1 lần/ngày nhờ chốt lastSentDate.
let lastSentDate = null;

function startScheduler() {
  cron.schedule('* * * * *', async () => {
    try {
      const settings = await getAllSettings();
      const now = new Date(new Date().toLocaleString('en-US', { timeZone: SCHEDULE.TIMEZONE }));
      const hour = now.getHours();
      const minute = now.getMinutes();
      const dayOfWeek = now.getDay(); // 0 = Chủ nhật
      const days = (settings.morning_report_days || '').split(',').map(s => s.trim()).filter(Boolean);
      const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

      const shouldSend =
        hour === Number(settings.morning_report_hour) &&
        minute === Number(settings.morning_report_minute) &&
        days.includes(String(dayOfWeek)) &&
        lastSentDate !== todayKey;

      if (shouldSend) {
        lastSentDate = todayKey;
        await sendMorningNotifications();
      }
    } catch (err) {
      console.error('Scheduler tick lỗi:', err.message);
    }
  }, { timezone: SCHEDULE.TIMEZONE });

  // Đồng bộ Bitable mỗi 15 phút (chạy nền, không ảnh hưởng tốc độ bot)
  cron.schedule('*/15 * * * *', runBitableSync);

  console.log('Scheduler started: kiểm tra báo cáo sáng mỗi phút (theo settings), Bitable sync every 15min');
}

module.exports = { startScheduler, sendMorningNotifications };
