const axios = require('axios');
const { getTenantToken } = require('./helpers');
const config = require('./config');

const BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN;
const TASK_TABLE = config.TABLE.TASK;
const { COLS } = config;

// ─── Đồng bộ 1 task từ Postgres lên Bitable (chạy nền, không block flow chính) ───
// Lỗi ở đây chỉ log, không throw — Bitable giờ chỉ là bản sao để xem, không phải nguồn sự thật.
async function syncTaskToBitable(task) {
  try {
    const token = await getTenantToken();
    const fields = {
      [COLS.TASK_NAME]: task.fields[COLS.TASK_NAME],
      [COLS.SKU]: task.fields[COLS.SKU],
      [COLS.MO_TA_NGAN]: task.fields[COLS.MO_TA_NGAN],
      [COLS.MO_TA_CHI_TIET]: task.fields[COLS.MO_TA_CHI_TIET],
      [COLS.TRANG_THAI]: task.fields[COLS.TRANG_THAI],
      [COLS.NGUOI_GIAO]: task.fields[COLS.NGUOI_GIAO]?.map(u => ({ id: u.id })) || [],
      [COLS.NGUOI_THUC_HIEN]: task.fields[COLS.NGUOI_THUC_HIEN]?.map(u => ({ id: u.id })) || [],
      [COLS.DEADLINE]: task.fields[COLS.DEADLINE],
    };

    if (task.bitable_record_id) {
      await axios.put(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TASK_TABLE}/records/${task.bitable_record_id}`,
        { fields },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } else {
      const res = await axios.post(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TASK_TABLE}/records`,
        { fields },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const newRecordId = res.data.data?.record?.record_id;
      if (newRecordId) {
        const db = require('./db');
        await db.pool.query('UPDATE tasks SET bitable_record_id = $1 WHERE id = $2', [newRecordId, task.record_id]);
      }
    }
  } catch (err) {
    console.error('syncTaskToBitable lỗi (bỏ qua, không ảnh hưởng bot):', err.response?.data || err.message);
  }
}

// ─── Đồng bộ toàn bộ task đang hoạt động lên Bitable (gọi định kỳ từ scheduler) ───
async function syncAllTasksToBitable() {
  const db = require('./db');
  const res = await db.pool.query(`SELECT *, id AS record_id FROM tasks WHERE updated_at > now() - interval '1 day'`);
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
  }
}

module.exports = { syncTaskToBitable, syncAllTasksToBitable };
