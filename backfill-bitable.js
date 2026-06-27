// Đẩy TOÀN BỘ task trong Postgres lên Bitable (không giới hạn 24h như syncAllTasksToBitable
// dùng cho scheduler) — chạy 1 lần khi mới đổi sang Bitable mới để backfill dữ liệu cũ.
require('dotenv').config();
const db = require('./db');
const { syncTaskToBitable } = require('./bitable');
const config = require('./config');

const { COLS } = config;

async function backfillAll() {
  const res = await db.pool.query(`SELECT *, id AS record_id FROM tasks ORDER BY created_at`);
  let synced = 0;
  for (const row of res.rows) {
    const task = {
      record_id: row.id,
      bitable_record_id: row.bitable_record_id,
      fields: {
        [COLS.TASK_NAME]: row.task_name,
        [COLS.SKU]: row.sku,
        [COLS.MO_TA_NGAN]: row.mo_ta_ngan,
        [COLS.MO_TA_CHI_TIET]: row.mo_ta_chi_tiet,
        [COLS.TRANG_THAI]: row.status,
        [COLS.NGUOI_GIAO]: row.nguoi_giao_id ? [{ id: row.nguoi_giao_id, name: row.nguoi_giao_name }] : [],
        [COLS.NGUOI_THUC_HIEN]: row.nguoi_thuc_hien_id ? [{ id: row.nguoi_thuc_hien_id, name: row.nguoi_thuc_hien_name }] : [],
        [COLS.DEADLINE]: row.deadline ? Number(row.deadline) : null,
      },
    };
    await syncTaskToBitable(task);
    synced++;
  }
  return { totalTasks: res.rows.length, synced };
}

if (require.main === module) {
  backfillAll()
    .then(result => { console.log('Backfill xong:', result); return db.pool.end(); })
    .catch(err => { console.error('Backfill lỗi:', err.message, err.stack); process.exit(1); });
}

module.exports = { backfillAll };
