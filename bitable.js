const axios = require('axios');
const FormData = require('form-data');
const { getTenantToken } = require('./helpers');
const config = require('./config');

const BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN;
const TASK_TABLE = config.TABLE.TASK;
const { COLS } = config;

// ─── Upload 1 file đính kèm lên Bitable, trả về file_token để ghi vào field Attachment ───
// Bitable không nhận URL cho field Attachment — phải tải file thật lên rồi tham chiếu bằng file_token.
// Cache lại trong DB (bitable_file_token) để không phải upload lại mỗi lần đồng bộ.
async function uploadAttachmentToBitable(token, taskId, attachment) {
  if (attachment.bitableFileToken) return attachment.bitableFileToken;

  const fileRes = await axios.get(attachment.url, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(fileRes.data);

  const form = new FormData();
  form.append('file_name', attachment.name || 'file');
  form.append('parent_type', 'bitable_file');
  form.append('parent_node', BITABLE_APP_TOKEN);
  form.append('size', String(buffer.length));
  form.append('file', buffer, { filename: attachment.name || 'file' });

  const res = await axios.post('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', form, {
    headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
  });
  const fileToken = res.data.data?.file_token;
  if (fileToken) {
    const db = require('./db');
    await db.setAttachmentBitableToken(taskId, attachment.url, fileToken);
  }
  return fileToken;
}

// ─── Đồng bộ 1 task từ Postgres lên Bitable (chạy nền, không block flow chính) ───
// Lỗi ở đây chỉ log, không throw — Bitable giờ chỉ là bản sao để xem, không phải nguồn sự thật.
// Tự retry 1 lần nếu thất bại (token vừa hết hạn, network blip...) trước khi bỏ qua.
async function syncTaskToBitable(task, isRetry = false) {
  try {
    const token = await getTenantToken();

    const fileTokens = [];
    for (const a of task.attachments || []) {
      try {
        const fileToken = await uploadAttachmentToBitable(token, task.record_id, a);
        if (fileToken) fileTokens.push({ file_token: fileToken });
      } catch (err) {
        console.error('upload file đính kèm lên Bitable lỗi (bỏ qua file này):', err.response?.data || err.message);
      }
    }

    const fields = {
      [COLS.TASK_NAME]: task.fields[COLS.TASK_NAME],
      [COLS.SKU]: task.fields[COLS.SKU],
      [COLS.MO_TA_CHI_TIET]: task.fields[COLS.MO_TA_CHI_TIET],
      [COLS.TRANG_THAI]: task.fields[COLS.TRANG_THAI],
      [COLS.NGUOI_GIAO]: task.fields[COLS.NGUOI_GIAO]?.map(u => ({ id: u.id })) || [],
      [COLS.NGUOI_THUC_HIEN]: task.fields[COLS.NGUOI_THUC_HIEN]?.map(u => ({ id: u.id })) || [],
      [COLS.DEADLINE]: task.fields[COLS.DEADLINE],
      [COLS.NGAY_GIAO]: task.created_at ? new Date(task.created_at).getTime() : null,
      [COLS.NGAY_HOAN_THANH]: task.completed_at ? new Date(task.completed_at).getTime() : null,
      [COLS.FILE_GOC]: fileTokens,
    };

    let shouldCreate = !task.bitable_record_id;

    if (task.bitable_record_id) {
      try {
        await axios.put(
          `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TASK_TABLE}/records/${task.bitable_record_id}`,
          { fields },
          { headers: { Authorization: `Bearer ${token}` } }
        );
      } catch (err) {
        // Record cũ không còn tồn tại trong bảng hiện tại (vd vừa đổi sang Bitable khác) -> tạo lại mới
        if (err.response?.status === 404 || err.response?.data?.code === 1254043) shouldCreate = true;
        else throw err;
      }
    }

    if (shouldCreate) {
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
    if (!isRetry) {
      await new Promise(r => setTimeout(r, 2000));
      return syncTaskToBitable(task, true);
    }
    console.error('syncTaskToBitable lỗi (đã retry, bỏ qua, không ảnh hưởng bot):', err.response?.data || err.message);
  }
}

// ─── Đồng bộ task lên Bitable (gọi định kỳ từ scheduler) ───
// full=true: đồng bộ TẤT CẢ task, không phụ thuộc updated_at (dùng khi cần đối soát lại toàn bộ,
// ví dụ sau khi sửa sai cấu hình Bitable). full=false (mặc định): chỉ đồng bộ task thay đổi trong 24h.
async function syncAllTasksToBitable({ full = false } = {}) {
  const db = require('./db');
  const res = await db.pool.query(
    full
      ? 'SELECT *, id AS record_id FROM tasks'
      : `SELECT *, id AS record_id FROM tasks WHERE updated_at > now() - interval '1 day'`
  );
  const tasks = await db.withAttachments(res.rows.map(db.rowToRecord));
  for (const task of tasks) {
    await syncTaskToBitable(task);
  }
  return tasks.length;
}

// ─── Sync nhanh: sau 10s không có thao tác nào nữa thì chạy đồng bộ toàn bộ ───
// (thay cho việc chỉ chờ lịch cố định 15 phút — gọi scheduleQuickSync() mỗi khi
// có hành động tạo/sửa/gán/đổi trạng thái task, debounce lại nếu có hành động mới).
let quickSyncTimer = null;
function scheduleQuickSync() {
  if (quickSyncTimer) clearTimeout(quickSyncTimer);
  quickSyncTimer = setTimeout(() => {
    quickSyncTimer = null;
    syncAllTasksToBitable().catch(err => console.error('quickSync lỗi:', err.message));
  }, 10000);
}

// ─── Xoá record trên Bitable khi task bị xoá khỏi DB ───
async function deleteRecordFromBitable(bitableRecordId) {
  if (!bitableRecordId) return;
  try {
    const token = await getTenantToken();
    await axios.delete(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${TASK_TABLE}/records/${bitableRecordId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch (err) {
    console.error('deleteRecordFromBitable lỗi (bỏ qua):', err.response?.data || err.message);
  }
}

module.exports = { syncTaskToBitable, syncAllTasksToBitable, deleteRecordFromBitable, scheduleQuickSync };
