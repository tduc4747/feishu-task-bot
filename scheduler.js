const cron = require('node-cron');
const { sendCard } = require('./helpers');
const { getAllTasks, getMediaMembers, getAdminIds } = require('./db');
const { syncAllTasksToBitable } = require('./bitable');
const { cardMorningMedia, cardMorningAdmin } = require('./cards');
const config = require('./config');

const { STATUS, COLS, SCHEDULE } = config;

// ─── Gửi thông báo sáng ─────────────────────────────────────────
async function sendMorningNotifications() {
  console.log('Sending morning notifications...');

  try {
    const allTasks = await getAllTasks();
    const activeStatuses = [STATUS.DANG_CHO, STATUS.DANG_LAM, STATUS.CHO_CHECK];

    // ── Thông báo cho từng media ─────────────────────
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
        await sendCard(member.id, cardMorningMedia(myTasks, member.name));
      }
    }

    // ── Thông báo cho admin ──────────────────────────
    const pendingTasks = allTasks.filter(t =>
      t.fields[COLS.TRANG_THAI] === STATUS.CHO_GAN
    );

    const activeTasks = allTasks.filter(t =>
      [STATUS.DANG_LAM, STATUS.CHO_CHECK].includes(t.fields[COLS.TRANG_THAI])
    );

    const admins = await getAdminIds();
    for (const admin of admins) {
      await sendCard(admin.id, cardMorningAdmin(pendingTasks.length, activeTasks));
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
function startScheduler() {
  const { HOUR, MINUTE } = SCHEDULE;

  // Chạy lúc 8:00 sáng giờ VN hàng ngày
  cron.schedule(`${MINUTE} ${HOUR} * * *`, sendMorningNotifications, {
    timezone: SCHEDULE.TIMEZONE
  });

  // Đồng bộ Bitable mỗi 15 phút (chạy nền, không ảnh hưởng tốc độ bot)
  cron.schedule('*/15 * * * *', runBitableSync);

  console.log(`Scheduler started: daily at ${HOUR}:${MINUTE.toString().padStart(2,'0')} ${SCHEDULE.TIMEZONE}, Bitable sync every 15min`);
}

module.exports = { startScheduler, sendMorningNotifications };
