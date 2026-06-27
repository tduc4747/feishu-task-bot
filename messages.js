// ─── Quản lý mẫu tin nhắn (admin sửa nội dung, bot dùng để gửi DM) ───
const db = require('./db');

// Các "đầu mục" hệ thống — gắn với từng điểm bot tự gửi tin nhắn trong code.
// Admin chỉ sửa được nội dung (content), không xoá được (xoá = phục hồi mặc định).
const DEFAULTS = {
  task_assigned: {
    title: 'Gán task mới cho người thực hiện',
    content: '📌 Bạn vừa được gán task mới!\nTask: $ten_task\nSKU: $sku\nMô tả: $mo_ta_chi_tiet\nNhắn "hi" để xem chi tiết.',
  },
  task_assign_confirm: {
    title: 'Xác nhận đã gán task (gửi cho người bấm gán)',
    content: '✅ Đã gán task "$ten_task" thành công.',
  },
  task_started_self: {
    title: 'Xác nhận bắt đầu làm task (gửi cho người thực hiện)',
    content: '▶️ Đã bắt đầu làm task "$ten_task"!',
  },
  task_started_notify_sale: {
    title: 'Báo người giao khi task được bắt đầu làm',
    content: '🔄 Task "$ten_task | $sku" đã được $ten_nguoi_thuc_hien bắt đầu thực hiện.',
  },
  task_pending_check_self: {
    title: 'Xác nhận chuyển trạng thái Chờ check',
    content: '👀 Đã chuyển sang "Chờ check". Đang chờ sale duyệt.',
  },
  task_completed: {
    title: 'Báo hoàn thành task (gửi cho người giao)',
    content: '✅ $ten_nguoi_thuc_hien đã hoàn thành task "$ten_task | $sku" của bạn!',
  },
  task_completed_for_media: {
    title: 'Báo hoàn thành task (gửi cho người thực hiện)',
    content: '🎉 Bạn đã hoàn thành task "$ten_task | $sku"! Cảm ơn bạn nhiều.',
  },
  task_new_for_admin: {
    title: 'Báo admin có task mới cần gán',
    content: '🆕 Có task mới cần gán!\nTask: $ten_task\nSKU: $sku\nNgười giao: $ten_nguoi_giao',
  },
};

const VAR_HELP = ['ten_task', 'sku', 'mo_ta_chi_tiet', 'deadline', 'ten_nguoi_giao', 'ten_nguoi_thuc_hien', 'trang_thai'];

// Thay $var bằng giá trị tương ứng trong vars; var không có trong vars thì giữ nguyên token gốc.
function render(content, vars = {}) {
  return content.replace(/\$([a-z_]+)/gi, (token, key) => {
    if (!(key in vars)) return token;
    const v = vars[key];
    return v === undefined || v === null || v === '' ? '' : String(v);
  });
}

async function ensureSeeded() {
  for (const [key, d] of Object.entries(DEFAULTS)) {
    await db.pool.query(
      `INSERT INTO message_templates (key, title, content, is_system) VALUES ($1, $2, $3, true)
       ON CONFLICT (key) DO NOTHING`,
      [key, d.title, d.content]
    );
  }
}

async function listTemplates() {
  const res = await db.pool.query('SELECT key, title, content, is_system, updated_at FROM message_templates ORDER BY is_system DESC, title');
  return res.rows;
}

async function getTemplate(key) {
  const res = await db.pool.query('SELECT key, title, content, is_system FROM message_templates WHERE key = $1', [key]);
  if (res.rows[0]) return res.rows[0];
  return DEFAULTS[key] ? { key, ...DEFAULTS[key], is_system: true } : null;
}

async function renderMessage(key, vars) {
  const tpl = await getTemplate(key);
  if (!tpl) return null;
  return render(tpl.content, vars);
}

function slugify(title) {
  return 'custom_' + title.toLowerCase().trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 40) || 'custom_' + Date.now();
}

async function createTemplate({ title, content }) {
  let key = slugify(title);
  const exists = await db.pool.query('SELECT 1 FROM message_templates WHERE key = $1', [key]);
  if (exists.rows.length) key = `${key}_${Date.now()}`;
  await db.pool.query(
    `INSERT INTO message_templates (key, title, content, is_system) VALUES ($1, $2, $3, false)`,
    [key, title, content]
  );
  return getTemplate(key);
}

async function updateTemplate(key, { title, content }) {
  const fields = [];
  const values = [];
  if (title !== undefined) { values.push(title); fields.push(`title = $${values.length}`); }
  if (content !== undefined) { values.push(content); fields.push(`content = $${values.length}`); }
  if (!fields.length) return getTemplate(key);

  // Mẫu hệ thống chưa từng được sửa thì chưa có row trong DB -> seed trước khi update.
  await ensureSeeded();
  values.push(key);
  await db.pool.query(`UPDATE message_templates SET ${fields.join(', ')}, updated_at = now() WHERE key = $${values.length}`, values);
  return getTemplate(key);
}

async function deleteTemplate(key) {
  const res = await db.pool.query('SELECT is_system FROM message_templates WHERE key = $1', [key]);
  if (res.rows[0]?.is_system) throw new Error('Không thể xoá mục hệ thống, chỉ có thể sửa nội dung');
  await db.pool.query('DELETE FROM message_templates WHERE key = $1', [key]);
}

module.exports = {
  VAR_HELP, ensureSeeded, listTemplates, getTemplate, renderMessage,
  createTemplate, updateTemplate, deleteTemplate,
};
