const { Pool } = require('pg');
const config = require('./config');

const { COLS, STATUS } = config;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

// ─── Khởi tạo schema (idempotent, an toàn chạy mỗi lần start) ───
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      open_id TEXT PRIMARY KEY,
      name    TEXT NOT NULL,
      roles   TEXT[] NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id                  SERIAL PRIMARY KEY,
      task_name           TEXT NOT NULL,
      sku                 TEXT,
      mo_ta_chi_tiet      TEXT,
      status              TEXT NOT NULL DEFAULT '${STATUS.CHO_GAN}',
      nguoi_giao_id       TEXT,
      nguoi_giao_name     TEXT,
      nguoi_thuc_hien_id  TEXT,
      nguoi_thuc_hien_name TEXT,
      deadline            BIGINT,
      attachment_url      TEXT,
      bitable_record_id   TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at        TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_thuc_hien ON tasks(nguoi_thuc_hien_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_giao ON tasks(nguoi_giao_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

    CREATE TABLE IF NOT EXISTS message_templates (
      key         TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      content     TEXT NOT NULL,
      is_system   BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- Nhiều file đính kèm / task (thay cho cột tasks.attachment_url chỉ chứa được 1 file)
    CREATE TABLE IF NOT EXISTS task_attachments (
      id         SERIAL PRIMARY KEY,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      file_url   TEXT NOT NULL,
      file_name  TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);
  `);

  // Bỏ ràng buộc khoá ngoại cũ nếu bảng đã được tạo từ lần deploy trước
  await pool.query(`
    ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_nguoi_giao_id_fkey;
    ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_nguoi_thuc_hien_id_fkey;
  `);

  // Dọn cột cũ không còn dùng (dữ liệu trùng với status, hoặc thay bằng Formula riêng trong Bitable)
  // và thêm cột mới cho deploy đã tồn tại từ trước
  await pool.query(`
    ALTER TABLE tasks DROP COLUMN IF EXISTS phan_loai;
    ALTER TABLE tasks DROP COLUMN IF EXISTS dang_lam;
    ALTER TABLE tasks DROP COLUMN IF EXISTS cho_check;
    ALTER TABLE tasks DROP COLUMN IF EXISTS done;
    ALTER TABLE tasks DROP COLUMN IF EXISTS mo_ta_ngan;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS attachment_url TEXT;
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
  `);

  // Một lần: chuyển file đính kèm cũ (1 file/task, cột attachment_url) sang
  // bảng task_attachments (nhiều file/task), rồi bỏ cột cũ không dùng nữa.
  await pool.query(`
    INSERT INTO task_attachments (task_id, file_url)
    SELECT id, attachment_url FROM tasks
    WHERE attachment_url IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM task_attachments ta WHERE ta.task_id = tasks.id AND ta.file_url = tasks.attachment_url);
  `);
  await pool.query(`ALTER TABLE tasks DROP COLUMN IF EXISTS attachment_url;`);
}

// ─── Chuyển 1 row Postgres -> hình dạng "record" giống Bitable cũ ───
function rowToRecord(row) {
  return {
    record_id: String(row.id),
    bitable_record_id: row.bitable_record_id,
    created_at: row.created_at,
    completed_at: row.completed_at,
    attachments: [],
    fields: {
      [COLS.TASK_NAME]: row.task_name,
      [COLS.SKU]: row.sku,
      [COLS.MO_TA_CHI_TIET]: row.mo_ta_chi_tiet,
      [COLS.TRANG_THAI]: row.status,
      [COLS.NGUOI_GIAO]: row.nguoi_giao_id ? [{ id: row.nguoi_giao_id, name: row.nguoi_giao_name }] : null,
      [COLS.NGUOI_THUC_HIEN]: row.nguoi_thuc_hien_id ? [{ id: row.nguoi_thuc_hien_id, name: row.nguoi_thuc_hien_name }] : null,
      [COLS.DEADLINE]: row.deadline ? Number(row.deadline) : null,
    },
  };
}

// ─── Gắn danh sách file đính kèm (bảng task_attachments) vào từng task ───
async function withAttachments(tasks) {
  if (tasks.length === 0) return tasks;
  const ids = tasks.map(t => Number(t.record_id));
  const res = await pool.query(
    'SELECT task_id, file_url, file_name FROM task_attachments WHERE task_id = ANY($1) ORDER BY created_at',
    [ids]
  );
  const byTask = {};
  for (const row of res.rows) {
    (byTask[row.task_id] ||= []).push({ url: row.file_url, name: row.file_name });
  }
  return tasks.map(t => ({ ...t, attachments: byTask[Number(t.record_id)] || [] }));
}

// ─── Task queries ────────────────────────────────────────────────
async function getAllTasks() {
  const res = await pool.query('SELECT * FROM tasks ORDER BY created_at');
  return withAttachments(res.rows.map(rowToRecord));
}

async function getRecord(_tableId, recordId) {
  const res = await pool.query('SELECT * FROM tasks WHERE id = $1', [recordId]);
  if (!res.rows[0]) return null;
  const [task] = await withAttachments([rowToRecord(res.rows[0])]);
  return task;
}

async function getMyTasks(openId) {
  const res = await pool.query(
    `SELECT * FROM tasks
     WHERE nguoi_thuc_hien_id = $1 AND status NOT IN ($2, $3)
     ORDER BY deadline ASC NULLS LAST`,
    [openId, STATUS.HOAN_THANH, STATUS.CHO_GAN]
  );
  return withAttachments(res.rows.map(rowToRecord));
}

async function getTasksBySale(openId) {
  const res = await pool.query(
    `SELECT * FROM tasks WHERE nguoi_giao_id = $1 AND status != $2 ORDER BY created_at`,
    [openId, STATUS.HOAN_THANH]
  );
  return withAttachments(res.rows.map(rowToRecord));
}

async function getPendingTasks() {
  const res = await pool.query('SELECT * FROM tasks WHERE nguoi_thuc_hien_id IS NULL ORDER BY created_at');
  return withAttachments(res.rows.map(rowToRecord));
}

// month: 'YYYY-MM', lọc theo completed_at trong tháng đó
async function getCompletedTasks({ saleId, mediaId, month } = {}) {
  const conditions = [`status = $1`];
  const values = [STATUS.HOAN_THANH];
  let i = 2;
  if (saleId) { conditions.push(`nguoi_giao_id = $${i++}`); values.push(saleId); }
  if (mediaId) { conditions.push(`nguoi_thuc_hien_id = $${i++}`); values.push(mediaId); }
  if (month) {
    conditions.push(`to_char(completed_at, 'YYYY-MM') = $${i++}`);
    values.push(month);
  }
  const res = await pool.query(
    `SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY completed_at DESC`,
    values
  );
  return withAttachments(res.rows.map(rowToRecord));
}

// ─── Cập nhật task (nhận fields theo tên COLS.* để khỏi đổi callback.js) ───
async function updateRecord(_tableId, recordId, fields) {
  const sets = [];
  const values = [];
  let i = 1;

  const map = {
    [COLS.TRANG_THAI]: 'status',
    [COLS.TASK_NAME]: 'task_name',
    [COLS.SKU]: 'sku',
    [COLS.MO_TA_CHI_TIET]: 'mo_ta_chi_tiet',
    [COLS.DEADLINE]: 'deadline',
  };

  for (const [col, val] of Object.entries(fields)) {
    if (col === COLS.NGUOI_THUC_HIEN) {
      const user = Array.isArray(val) ? val[0] : null;
      sets.push(`nguoi_thuc_hien_id = $${i++}`); values.push(user?.id || null);
      sets.push(`nguoi_thuc_hien_name = $${i++}`); values.push(user?.name || null);
      continue;
    }
    if (col === COLS.NGUOI_GIAO) {
      const user = Array.isArray(val) ? val[0] : null;
      sets.push(`nguoi_giao_id = $${i++}`); values.push(user?.id || null);
      sets.push(`nguoi_giao_name = $${i++}`); values.push(user?.name || null);
      continue;
    }
    if (col === '_completed_at') {
      sets.push(`completed_at = $${i++}`); values.push(val);
      continue;
    }
    const dbCol = map[col];
    if (!dbCol) continue;
    sets.push(`${dbCol} = $${i++}`);
    values.push(val);
  }

  if (sets.length === 0) return;
  sets.push(`updated_at = now()`);
  values.push(recordId);

  await pool.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $${i}`, values);
}

async function deleteTask(recordId) {
  const res = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING bitable_record_id', [recordId]);
  return res.rows[0] || null;
}

// attachments: [{ url, name }] — không bắt buộc, 1 task có thể có nhiều file đính kèm.
async function createTask({ taskName, sku, moTaChiTiet, deadline, nguoiGiaoId, nguoiGiaoName, bitableRecordId, attachments = [] }) {
  const res = await pool.query(
    `INSERT INTO tasks (task_name, sku, mo_ta_chi_tiet, deadline, nguoi_giao_id, nguoi_giao_name, status, bitable_record_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [taskName, sku, moTaChiTiet, deadline || null, nguoiGiaoId || null, nguoiGiaoName || null, STATUS.CHO_GAN, bitableRecordId || null]
  );
  const task = rowToRecord(res.rows[0]);
  if (attachments.length) await addAttachments(task.record_id, attachments);
  task.attachments = attachments;
  return task;
}

// ─── Quản lý file đính kèm task (nhiều file/task) ────────────────────
async function addAttachments(taskId, files) {
  for (const f of files) {
    if (!f?.url) continue;
    await pool.query(
      'INSERT INTO task_attachments (task_id, file_url, file_name) VALUES ($1, $2, $3)',
      [taskId, f.url, f.name || null]
    );
  }
}

async function deleteAttachmentsByUrls(urls) {
  if (!urls.length) return;
  await pool.query('DELETE FROM task_attachments WHERE file_url = ANY($1)', [urls]);
}

// Toàn bộ file đính kèm (kèm task chứa nó) — dùng cho tab "File đính kèm" gom theo task.
async function getAllAttachments() {
  const res = await pool.query(`
    SELECT ta.file_url, ta.file_name, ta.task_id, t.task_name
    FROM task_attachments ta
    JOIN tasks t ON t.id = ta.task_id
    ORDER BY ta.task_id, ta.created_at
  `);
  return res.rows;
}

// ─── User / role queries ─────────────────────────────────────────
async function upsertUser(openId, name, roles) {
  await pool.query(
    `INSERT INTO users (open_id, name, roles) VALUES ($1, $2, $3)
     ON CONFLICT (open_id) DO UPDATE SET name = $2, roles = $3`,
    [openId, name, roles]
  );
}

async function getUserRole(openId) {
  const res = await pool.query('SELECT roles FROM users WHERE open_id = $1', [openId]);
  return res.rows[0]?.roles || [];
}

async function getUserInfo(openId) {
  const res = await pool.query('SELECT name, roles FROM users WHERE open_id = $1', [openId]);
  return res.rows[0] || null;
}

// ─── Kiểm tra user còn trong DS_TEAM hiện tại không (tránh nhắn nhầm người đã bị xoá) ───
async function userExists(openId) {
  if (!openId) return false;
  const res = await pool.query('SELECT 1 FROM users WHERE open_id = $1', [openId]);
  return res.rows.length > 0;
}

async function getMediaMembers() {
  const res = await pool.query(`SELECT open_id AS id, name FROM users WHERE 'media' = ANY(roles)`);
  return res.rows;
}

// ─── Toàn bộ thành viên DS_TEAM (dùng cho dropdown "Người giao") ───
async function getTeamMembers() {
  const res = await pool.query('SELECT open_id AS id, name, roles FROM users ORDER BY name');
  return res.rows;
}

async function getAdminIds() {
  const res = await pool.query(`SELECT open_id AS id, name FROM users WHERE 'admin' = ANY(roles)`);
  return res.rows;
}

// ─── Quản lý người (tab admin) ─────────────────────────────────────
async function getAllUsers() {
  const res = await pool.query('SELECT open_id AS id, name, roles FROM users ORDER BY name');
  return res.rows;
}

async function deleteUser(openId) {
  await pool.query('DELETE FROM users WHERE open_id = $1', [openId]);
}

// ─── Workload ─────────────────────────────────────────────────────
async function getWorkload() {
  const members = await getMediaMembers();
  const activeStatuses = [STATUS.DANG_CHO, STATUS.DANG_LAM, STATUS.CHO_CHECK];

  const res = await pool.query(
    `SELECT nguoi_thuc_hien_id AS id, status, COUNT(*) AS count
     FROM tasks
     WHERE nguoi_thuc_hien_id IS NOT NULL AND status = ANY($1)
     GROUP BY nguoi_thuc_hien_id, status`,
    [activeStatuses]
  );

  const workload = {};
  for (const m of members) workload[m.id] = { id: m.id, name: m.name, dang_cho: 0, dang_lam: 0, cho_check: 0, total: 0 };

  for (const row of res.rows) {
    if (!workload[row.id]) continue;
    const n = Number(row.count);
    workload[row.id].total += n;
    if (row.status === STATUS.DANG_CHO) workload[row.id].dang_cho += n;
    else if (row.status === STATUS.DANG_LAM) workload[row.id].dang_lam += n;
    else if (row.status === STATUS.CHO_CHECK) workload[row.id].cho_check += n;
  }

  return Object.values(workload);
}

// Khoá nội bộ dùng với updateRecord() cho field không thuộc Bitable (không sync ra ngoài)
const INTERNAL_FIELDS = { COMPLETED_AT: '_completed_at' };

module.exports = {
  pool, init, INTERNAL_FIELDS,
  getAllTasks, getRecord, getMyTasks, getTasksBySale, getPendingTasks, getCompletedTasks,
  updateRecord, createTask, deleteTask,
  addAttachments, deleteAttachmentsByUrls, getAllAttachments,
  upsertUser, getUserRole, getUserInfo, userExists, getMediaMembers, getAdminIds, getWorkload, getTeamMembers,
  getAllUsers, deleteUser,
};
