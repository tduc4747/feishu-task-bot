// Đồng bộ lại bảng `users` từ DS_TEAM hiện tại (BITABLE_TEAM_TABLE_ID trong .env).
// An toàn để chạy lại nhiều lần — chỉ upsert user, KHÔNG đụng tới bảng tasks
// (khác với migrate-seed.js vốn migrate cả tasks, không nên chạy lại trên DB đã có dữ liệu thật).
require('dotenv').config();
const config = require('./config');
const db = require('./db');
const oldBitable = require('./bitable-legacy');

const { TEAM_COLS } = config;

async function syncTeam() {
  await db.init();
  const teamList = await oldBitable.getTeamList();
  const usersByOpenId = {};

  for (const row of teamList) {
    for (const role of ['ADMIN', 'SALE', 'EDITOR', 'DESIGNER']) {
      const val = row.fields[TEAM_COLS[role]];
      if (!val || !Array.isArray(val)) continue;
      for (const u of val) {
        if (!u.id) continue;
        if (!usersByOpenId[u.id]) usersByOpenId[u.id] = { name: u.name || u.id, roles: new Set() };
        if (role === 'ADMIN') usersByOpenId[u.id].roles.add('admin');
        else if (role === 'SALE') usersByOpenId[u.id].roles.add('sale');
        else usersByOpenId[u.id].roles.add('media');
      }
    }
  }

  let count = 0;
  for (const [openId, u] of Object.entries(usersByOpenId)) {
    await db.upsertUser(openId, u.name, [...u.roles]);
    count++;
  }

  const keepIds = Object.keys(usersByOpenId);
  const staleRes = await db.pool.query(
    `SELECT open_id, name FROM users WHERE open_id != ALL($1)`,
    [keepIds]
  );

  // Chỉ xoá khi truyền --delete-stale, để tránh xoá nhầm khi chỉ muốn xem trước danh sách thừa
  if (process.argv.includes('--delete-stale') && staleRes.rows.length > 0) {
    await db.pool.query(`DELETE FROM users WHERE open_id != ALL($1)`, [keepIds]);
  }

  return { usersUpserted: count, staleUsers: staleRes.rows, deleted: process.argv.includes('--delete-stale') };
}

if (require.main === module) {
  syncTeam()
    .then(result => { console.log('Sync team xong:', JSON.stringify(result, null, 2)); return db.pool.end(); })
    .catch(err => { console.error('Sync team lỗi:', err.message, err.stack); process.exit(1); });
}

module.exports = { syncTeam };
