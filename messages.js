// ─── Quản lý mẫu tin nhắn (admin sửa nội dung, bot dùng để gửi DM) ───
const db = require('./db');

// Các "đầu mục" hệ thống — gắn với từng điểm bot tự gửi tin nhắn trong code.
// Admin chỉ sửa được nội dung (content), không xoá được (xoá = phục hồi mặc định).
// "group" gắn mỗi mẫu hệ thống vào 1 bước (step) để tab quản lý gom cụm cho dễ
// thêm/bớt. Mỗi bước có tối đa 3 mẫu: gửi cho Sale / Media / Admin — để trống
// nội dung nghĩa là không gửi cho vai trò đó ở bước này.
const DEFAULTS = {
  task_new_for_admin: {
    title: 'Task mới → báo Admin',
    group: 'Task mới được tạo',
    content: '🆕 Có task mới cần gán!\nTask: $ten_task\nSKU: $sku\nNgười giao: $ten_nguoi_giao\nChi tiết: $mo_ta_chi_tiet',
  },

  task_assigned: {
    title: 'Gán task → báo Media (người được gán)',
    group: 'Gán task cho người thực hiện',
    content: '📌 Bạn vừa được gán task mới!\nTask: $ten_task\nSKU: $sku\nMô tả: $mo_ta_chi_tiet\nNhắn "hi" để xem chi tiết.',
  },
  task_assign_confirm: {
    title: 'Gán task → báo Sale (người giao, nếu khác người gán)',
    group: 'Gán task cho người thực hiện',
    content: '✅ Đã gán task "$ten_task" thành công cho $ten_nguoi_thuc_hien.',
  },
  task_assigned_notify_admin: {
    title: 'Gán task → báo Admin',
    group: 'Gán task cho người thực hiện',
    content: '',
  },

  task_started_self: {
    title: 'Bắt đầu làm → báo Media (tự xác nhận)',
    group: 'Bắt đầu làm',
    content: '▶️ Đã bắt đầu làm task "$ten_task"!',
  },
  task_started_notify_sale: {
    title: 'Bắt đầu làm → báo Sale (người giao)',
    group: 'Bắt đầu làm',
    content: '🔄 Task "$ten_task | $sku" đã được $ten_nguoi_thuc_hien bắt đầu thực hiện.',
  },
  task_started_notify_admin: {
    title: 'Bắt đầu làm → báo Admin',
    group: 'Bắt đầu làm',
    content: '🔄 $ten_nguoi_thuc_hien đã bắt đầu làm "$ten_task | $sku".',
  },

  // Bước "Chờ duyệt" cố tình KHÔNG có mẫu cho Admin — theo yêu cầu không báo
  // admin ở bước này, chỉ Sale (duyệt) và Media (tự xác nhận) nhận thông báo.
  task_pending_check_self: {
    title: 'Chờ duyệt → báo Media (tự xác nhận)',
    group: 'Chờ duyệt (không báo Admin)',
    content: '👀 Đã chuyển sang "Chờ check". Đang chờ sale duyệt.',
  },

  task_completed: {
    title: 'Hoàn thành → báo Sale (người giao)',
    group: 'Hoàn thành',
    content: '✅ $ten_nguoi_thuc_hien đã hoàn thành task "$ten_task | $sku" của bạn!',
  },
  task_completed_for_media: {
    title: 'Hoàn thành → báo Media (người thực hiện)',
    group: 'Hoàn thành',
    content: '🎉 Bạn đã hoàn thành task "$ten_task | $sku"! Cảm ơn bạn nhiều.',
  },
  task_completed_notify_admin: {
    title: 'Hoàn thành → báo Admin',
    group: 'Hoàn thành',
    content: '✅ $ten_nguoi_thuc_hien đã hoàn thành "$ten_task | $sku" (giao bởi $ten_nguoi_giao).',
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

const GROUP_ORDER = [
  'Task mới được tạo', 'Gán task cho người thực hiện', 'Bắt đầu làm',
  'Chờ duyệt (không báo Admin)', 'Hoàn thành', 'Tuỳ chỉnh',
];

async function ensureSeeded() {
  for (const [key, d] of Object.entries(DEFAULTS)) {
    await db.pool.query(
      `INSERT INTO message_templates (key, title, content, is_system) VALUES ($1, $2, $3, true)
       ON CONFLICT (key) DO NOTHING`,
      [key, d.title, d.content]
    );
  }
}

function withGroup(row) {
  return { ...row, group: DEFAULTS[row.key]?.group || 'Tuỳ chỉnh' };
}

async function listTemplates() {
  const res = await db.pool.query('SELECT key, title, content, is_system, updated_at FROM message_templates ORDER BY is_system DESC, title');
  const rows = res.rows.map(withGroup);
  rows.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  return rows;
}

async function getTemplate(key) {
  const res = await db.pool.query('SELECT key, title, content, is_system FROM message_templates WHERE key = $1', [key]);
  if (res.rows[0]) return withGroup(res.rows[0]);
  return DEFAULTS[key] ? withGroup({ key, ...DEFAULTS[key], is_system: true }) : null;
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
