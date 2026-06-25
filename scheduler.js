const cron = require('node-cron');
const { sendCard } = require('./helpers');
const { getAllTasks, getMyTasks, getTeamList, getUserRole } = require('./bitable');
const { cardMorningMedia, cardMorningAdmin } = require('./cards');
const config = require('./config');

const { STATUS, COLS, TEAM_COLS, SCHEDULE } = config;

// ─── Lấy tất cả media members kèm open_id ───────────────────────
async function getMediaMembersWithId() {
  const teamList = await getTeamList();
  const members = [];

  for (const row of teamList) {
    for (const col of [TEAM_COLS.EDITOR, TEAM_COLS.DESIGNER]) {
      const val = row.fields[col];
      if (!val || !Array.isArray(val)) continue;
      for (const u of val) {
        if (u.id && !members.find(m => m.id === u.id)) {
          members.push({ id: u.id, name: u.name || u.id });
        }
      }
    }
  }

  return members;
}

// ─── Lấy admin open_id ──────────────────────────────────────────
async function getAdminIds() {
  const teamList = await getTeamList();
  const admins = [];

  for (const row of teamList) {
    const val = row.fields[TEAM_COLS.ADMIN];
    if (!val || !Array.isArray(val)) continue;
    for (const u of val) {
      if (u.id && !admins.find(a => a.id === u.id)) {
        admins.push({ id: u.id, name: u.name || u.id });
      }
    }
  }

  return admins;
}

// ─── Gửi thông báo sáng ─────────────────────────────────────────
async function sendMorningNotifications() {
  console.log('Sending morning notifications...');

  try {
    const allTasks = await getAllTasks();
    const activeStatuses = [STATUS.DANG_CHO, STATUS.DANG_LAM, STATUS.CHO_CHECK];

    // ── Thông báo cho từng media ─────────────────────
    const mediaMembers = await getMediaMembersWithId();

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

// ─── Khởi động scheduler ────────────────────────────────────────
function startScheduler() {
  const { HOUR, MINUTE } = SCHEDULE;

  // Chạy lúc 8:00 sáng giờ VN hàng ngày
  cron.schedule(`${MINUTE} ${HOUR} * * *`, sendMorningNotifications, {
    timezone: SCHEDULE.TIMEZONE
  });

  console.log(`Scheduler started: daily at ${HOUR}:${MINUTE.toString().padStart(2,'0')} ${SCHEDULE.TIMEZONE}`);
}

module.exports = { startScheduler, sendMorningNotifications };
