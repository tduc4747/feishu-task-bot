require('dotenv').config();
const config = require('./config');
const db = require('./db');
const oldBitable = require('./bitable-legacy');
const { formatText } = require('./helpers');

const { COLS, TEAM_COLS } = config;

async function runMigration() {
  await db.init();
  const result = { usersMigrated: 0, tasksMigrated: 0, tasksSkipped: 0 };

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

  for (const [openId, u] of Object.entries(usersByOpenId)) {
    await db.upsertUser(openId, u.name, [...u.roles]);
    result.usersMigrated++;
  }

  const tasks = await oldBitable.getAllTasks();
  for (const t of tasks) {
    // An toàn khi bấm chạy nhiều lần: bỏ qua task đã migrate trước đó
    const existing = await db.pool.query('SELECT 1 FROM tasks WHERE bitable_record_id = $1', [t.record_id]);
    if (existing.rows.length > 0) { result.tasksSkipped++; continue; }

    const f = t.fields;
    const nguoiGiao = Array.isArray(f[COLS.NGUOI_GIAO]) ? f[COLS.NGUOI_GIAO][0] : null;
    const nguoiThucHien = Array.isArray(f[COLS.NGUOI_THUC_HIEN]) ? f[COLS.NGUOI_THUC_HIEN][0] : null;
    const status = formatText(f[COLS.TRANG_THAI]) || config.STATUS.CHO_GAN;

    await db.pool.query(
      `INSERT INTO tasks (task_name, sku, mo_ta_ngan, mo_ta_chi_tiet, phan_loai, status,
         nguoi_giao_id, nguoi_giao_name, nguoi_thuc_hien_id, nguoi_thuc_hien_name,
         deadline, dang_lam, cho_check, done, bitable_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        formatText(f[COLS.TASK_NAME]),
        formatText(f[COLS.SKU]),
        formatText(f[COLS.MO_TA_NGAN]),
        formatText(f[COLS.MO_TA_CHI_TIET]),
        formatText(f[COLS.PHAN_LOAI]),
        status,
        nguoiGiao?.id || null,
        nguoiGiao?.name || null,
        nguoiThucHien?.id || null,
        nguoiThucHien?.name || null,
        f[COLS.DEADLINE] || null,
        !!f[COLS.DANG_LAM],
        !!f[COLS.CHO_CHECK],
        !!f[COLS.DONE],
        t.record_id,
      ]
    );
    result.tasksMigrated++;
  }

  return result;
}

// Cho phép chạy trực tiếp bằng `node migrate-seed.js` (CLI), không bắt buộc.
if (require.main === module) {
  runMigration()
    .then(result => {
      console.log('Migrate xong:', result);
      return db.pool.end();
    })
    .catch(err => {
      console.error('Migrate lỗi:', err.message, err.stack);
      process.exit(1);
    });
}

module.exports = { runMigration };
