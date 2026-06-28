// ─── REST API cho Feishu Mini Program ───
const express = require('express');
const multer = require('multer');
const db = require('./db');
const { sendDM, formatText } = require('./helpers');
const taskActions = require('./taskActions');
const auth = require('./auth');
const config = require('./config');
const messages = require('./messages');
const settings = require('./settings');
const uploads = require('./uploads');

const { COLS, STATUS } = config;
const TASK_TABLE = config.TABLE.TASK;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const router = express.Router();

// ─── Auth ──────────────────────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Thiếu code' });

    const { openId } = await auth.exchangeCodeForOpenId(code);
    const exists = await db.userExists(openId);
    if (!exists) return res.status(403).json({ error: 'Bạn chưa được thêm vào hệ thống. Vui lòng liên hệ admin.' });

    const roles = await db.getUserRole(openId);
    const token = auth.issueSessionToken(openId);
    res.json({ token, roles });
  } catch (err) {
    console.error('auth/login lỗi:', err.response?.data || err.message);
    res.status(500).json({ error: 'Đăng nhập thất bại' });
  }
});

router.use(auth.requireAuth);

// ─── Thông tin user đang đăng nhập (dùng để render UI theo role) ────
router.get('/me', async (req, res) => {
  const info = await db.getUserInfo(req.openId);
  res.json({ openId: req.openId, name: info?.name || null, roles: info?.roles || [] });
});

// ─── Danh sách thành viên DS_TEAM (dropdown "Người giao") ───────────
router.get('/team-members', async (req, res) => {
  const members = await db.getTeamMembers();
  res.json(members);
});

// ─── Task lists theo role ────────────────────────────────────────────
router.get('/tasks/mine', auth.requireRole('media', 'admin'), async (req, res) => {
  res.json(await db.getMyTasks(req.openId));
});

router.get('/tasks/sent', auth.requireRole('sale'), async (req, res) => {
  res.json(await db.getTasksBySale(req.openId));
});

router.get('/tasks/pending', auth.requireRole('admin'), async (req, res) => {
  res.json(await db.getPendingTasks());
});

router.get('/tasks/workload', auth.requireRole('admin'), async (req, res) => {
  res.json(await db.getWorkload());
});

router.get('/tasks/by-media/:id', auth.requireRole('admin'), async (req, res) => {
  res.json(await db.getMyTasks(req.params.id));
});

router.get('/tasks/completed', async (req, res) => {
  const roles = req.roles || await db.getUserRole(req.openId);
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const filter = roles.includes('admin')
    ? { saleId: req.query.senderId || undefined, month }
    : { saleId: roles.includes('sale') ? req.openId : undefined, mediaId: roles.includes('media') ? req.openId : undefined, month };
  res.json(await db.getCompletedTasks(filter));
});

// ─── Tạo task mới (Sale) ─────────────────────────────────────────────
router.post('/tasks', auth.requireRole('sale', 'admin'), async (req, res) => {
  try {
    const { taskName, sku, moTaChiTiet, deadline, attachments, nguoiGiaoId } = req.body;
    if (!taskName || !sku || !deadline) {
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
    }
    if (taskName.length > 50) {
      return res.status(400).json({ error: 'Yêu cầu không được vượt quá 50 ký tự' });
    }

    let giaoId = req.openId;
    let giaoName = null;
    if (nguoiGiaoId && nguoiGiaoId !== req.openId) {
      const members = await db.getTeamMembers();
      const picked = members.find(m => m.id === nguoiGiaoId);
      if (!picked) return res.status(400).json({ error: 'Người giao không hợp lệ' });
      giaoId = picked.id;
      giaoName = picked.name;
    } else {
      const members = await db.getTeamMembers();
      giaoName = members.find(m => m.id === giaoId)?.name || null;
    }

    const task = await db.createTask({
      taskName, sku, moTaChiTiet, deadline,
      nguoiGiaoId: giaoId, nguoiGiaoName: giaoName,
      attachments: Array.isArray(attachments) ? attachments : [],
    });

    require('./bitable').syncTaskToBitable(task); require('./bitable').scheduleQuickSync(); // nền

    messages.renderMessage('task_new_for_admin', {
      ten_task: formatText(task.fields[COLS.TASK_NAME]),
      sku: formatText(task.fields[COLS.SKU]),
      ten_nguoi_giao: giaoName || '',
    }).then(msg => db.getAdminIds().then(admins => Promise.all(
      admins.map(a => sendDM(a.id, msg))
    ))).catch(err => console.error('Thông báo admin lỗi (bỏ qua):', err.message));

    res.status(201).json(task);
  } catch (err) {
    console.error('POST /tasks lỗi:', err.message);
    res.status(500).json({ error: 'Tạo task thất bại' });
  }
});

// ─── Chỉ admin hoặc đúng người đã giao task mới được sửa/xoá task đó ───
async function assertOwnsTask(req, res) {
  const task = await db.getRecord(TASK_TABLE, req.params.id);
  if (!task) { res.status(404).json({ error: 'Không tìm thấy task' }); return null; }
  const roles = req.roles || await db.getUserRole(req.openId);
  const giaoId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
  if (!roles.includes('admin') && giaoId !== req.openId) {
    res.status(403).json({ error: 'Bạn không có quyền sửa/xoá task này' });
    return null;
  }
  return task;
}

// ─── Sửa task (field thường) ─────────────────────────────────────────
router.patch('/tasks/:id', auth.requireRole('sale', 'admin'), async (req, res) => {
  try {
    if (!(await assertOwnsTask(req, res))) return;

    const fields = {};
    const { taskName, sku, moTaChiTiet, deadline } = req.body;
    if (taskName !== undefined && taskName.length > 50) {
      return res.status(400).json({ error: 'Yêu cầu không được vượt quá 50 ký tự' });
    }
    if (taskName !== undefined) fields[COLS.TASK_NAME] = taskName;
    if (sku !== undefined) fields[COLS.SKU] = sku;
    if (moTaChiTiet !== undefined) fields[COLS.MO_TA_CHI_TIET] = moTaChiTiet;
    if (deadline !== undefined) fields[COLS.DEADLINE] = deadline;

    await db.updateRecord(TASK_TABLE, req.params.id, fields);
    const task = await db.getRecord(TASK_TABLE, req.params.id);
    require('./bitable').syncTaskToBitable(task); require('./bitable').scheduleQuickSync();
    res.json(task);
  } catch (err) {
    console.error('PATCH /tasks/:id lỗi:', err.message);
    res.status(500).json({ error: 'Cập nhật task thất bại' });
  }
});

// ─── Xoá task (Sale tự xoá task mình đã gửi, hoặc admin) ─────────────
router.delete('/tasks/:id', auth.requireRole('sale', 'admin'), async (req, res) => {
  try {
    if (!(await assertOwnsTask(req, res))) return;

    const deleted = await db.deleteTask(req.params.id);
    require('./bitable').deleteRecordFromBitable(deleted?.bitable_record_id); require('./bitable').scheduleQuickSync();
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /tasks/:id lỗi:', err.message);
    res.status(500).json({ error: 'Xoá task thất bại' });
  }
});

// ─── Sửa trạng thái trực tiếp (Media tự sửa nếu bấm nhầm) ─────────────
router.patch('/tasks/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!Object.values(STATUS).includes(status)) {
      return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
    }
    const task = await db.getRecord(TASK_TABLE, req.params.id);
    if (!task) return res.status(404).json({ error: 'Không tìm thấy task' });

    const roles = req.roles || await db.getUserRole(req.openId);
    const thucHienId = task.fields[COLS.NGUOI_THUC_HIEN]?.[0]?.id;
    if (!roles.includes('admin') && thucHienId !== req.openId) {
      return res.status(403).json({ error: 'Bạn không có quyền sửa task này' });
    }

    const fields = { [COLS.TRANG_THAI]: status };
    if (status === STATUS.HOAN_THANH) fields[db.INTERNAL_FIELDS.COMPLETED_AT] = new Date();
    await db.updateRecord(TASK_TABLE, req.params.id, fields);

    const updated = await db.getRecord(TASK_TABLE, req.params.id);
    require('./bitable').syncTaskToBitable(updated);
    require('./bitable').scheduleQuickSync();
    res.json(updated);
  } catch (err) {
    console.error('PATCH /tasks/:id/status lỗi:', err.message);
    res.status(500).json({ error: 'Cập nhật trạng thái thất bại' });
  }
});

// ─── Gán người thực hiện ─────────────────────────────────────────────
router.post('/tasks/:id/assign', auth.requireRole('admin'), async (req, res) => {
  try {
    const { assigneeId } = req.body;
    if (!assigneeId) return res.status(400).json({ error: 'Thiếu assigneeId' });
    const { task } = await taskActions.assignTask({ recordId: req.params.id, assigneeId, actorId: req.openId });
    res.json(task);
  } catch (err) {
    console.error('assign lỗi:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ─── Chuyển trạng thái ────────────────────────────────────────────────
router.post('/tasks/:id/start', async (req, res) => {
  const { task } = await taskActions.startTask({ recordId: req.params.id, userId: req.openId });
  res.json(task);
});

router.post('/tasks/:id/pending-check', async (req, res) => {
  const { task } = await taskActions.pendingCheckTask({ recordId: req.params.id, userId: req.openId });
  res.json(task);
});

router.post('/tasks/:id/complete', async (req, res) => {
  const { task } = await taskActions.completeTask({ recordId: req.params.id, userId: req.openId });
  res.json(task);
});

// ─── Tải file/ảnh đính kèm, lưu trên volume Railway (UPLOAD_DIR) ───
// Trả về 1 link thật (https://.../uploads/xxxx.ext) — bấm mở được, gắn được
// thẳng vào tin nhắn Feishu DM, không còn giới hạn loại file như khi đẩy qua
// vùng "import" của Feishu Drive (chỉ nhận docx/xlsx/pdf...).
router.post('/uploads', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Thiếu file' });
    const filename = uploads.saveBuffer(req.file.buffer, req.file.originalname);
    res.json({ attachmentUrl: uploads.publicUrl(filename), fileName: req.file.originalname });
  } catch (err) {
    console.error('upload lỗi:', err.message);
    res.status(500).json({ error: 'Tải file lên thất bại' });
  }
});

// ─── Quản lý file đã lưu (admin) — gom theo task để dễ dọn dẹp định kỳ ───
router.get('/uploads', auth.requireRole('admin'), async (req, res) => {
  const files = uploads.listFiles();
  const attachments = await db.getAllAttachments();
  const byUrl = new Map(attachments.map(a => [a.file_url, a]));

  const groupsByTask = new Map();
  const orphans = [];
  for (const f of files) {
    const match = byUrl.get(f.url);
    if (!match) { orphans.push(f); continue; }
    if (!groupsByTask.has(match.task_id)) {
      groupsByTask.set(match.task_id, { taskId: match.task_id, taskName: match.task_name, files: [] });
    }
    groupsByTask.get(match.task_id).files.push(f);
  }

  const groups = [...groupsByTask.values()].sort((a, b) => b.taskId - a.taskId);
  orphans.sort((a, b) => b.mtime - a.mtime);
  res.json({ groups, orphans });
});

// Xoá theo lô — xoá file vật lý trên volume + dọn luôn tham chiếu trong task_attachments.
router.post('/uploads/delete-batch', auth.requireRole('admin'), async (req, res) => {
  try {
    const { filenames } = req.body || {};
    if (!Array.isArray(filenames) || !filenames.length) {
      return res.status(400).json({ error: 'Thiếu danh sách file cần xoá' });
    }
    const urls = filenames.map(f => uploads.publicUrl(f));
    await db.deleteAttachmentsByUrls(urls);
    for (const filename of filenames) uploads.deleteFile(filename);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /uploads/delete-batch lỗi:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// ─── Quản lý người (admin) ───────────────────────────────────────────
const VALID_ROLES = ['admin', 'sale', 'media'];

router.get('/users', auth.requireRole('admin'), async (req, res) => {
  res.json(await db.getAllUsers());
});

// Lấy toàn bộ Open ID trong tổ chức từ danh bạ Feishu — không cần ai nhắn "hi" cho bot.
// Cần app đã được cấp quyền contact:user.base:readonly + contact:department.base:readonly.
router.get('/contacts/sync', auth.requireRole('admin'), async (req, res) => {
  try {
    const members = await require('./feishu-contact').listAllOrgMembers();
    const existing = await db.getAllUsers();
    const existingIds = new Set(existing.map(u => u.id));
    res.json(members.map(m => ({ ...m, alreadyAdded: existingIds.has(m.openId) })));
  } catch (err) {
    console.error('GET /contacts/sync lỗi:', err.response?.data || err.message);
    res.status(500).json({ error: err.message || 'Đồng bộ danh bạ thất bại' });
  }
});

router.post('/users', auth.requireRole('admin'), async (req, res) => {
  try {
    const { openId, name, roles } = req.body;
    if (!openId || !name || !Array.isArray(roles) || !roles.length) {
      return res.status(400).json({ error: 'Thiếu openId/name/roles' });
    }
    if (roles.some(r => !VALID_ROLES.includes(r))) {
      return res.status(400).json({ error: 'Vị trí không hợp lệ' });
    }
    if (await db.userExists(openId)) {
      return res.status(400).json({ error: 'Open ID này đã tồn tại' });
    }
    await db.upsertUser(openId, name, roles);
    res.status(201).json({ id: openId, name, roles });
  } catch (err) {
    console.error('POST /users lỗi:', err.message);
    res.status(500).json({ error: 'Thêm người dùng thất bại' });
  }
});

router.patch('/users/:openId', auth.requireRole('admin'), async (req, res) => {
  try {
    const { name, roles } = req.body;
    if (!(await db.userExists(req.params.openId))) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    }
    if (roles && roles.some(r => !VALID_ROLES.includes(r))) {
      return res.status(400).json({ error: 'Vị trí không hợp lệ' });
    }
    const current = await db.getUserInfo(req.params.openId);
    await db.upsertUser(req.params.openId, name ?? current.name, roles ?? current.roles);
    res.json({ id: req.params.openId, name: name ?? current.name, roles: roles ?? current.roles });
  } catch (err) {
    console.error('PATCH /users/:openId lỗi:', err.message);
    res.status(500).json({ error: 'Cập nhật người dùng thất bại' });
  }
});

router.delete('/users/:openId', auth.requireRole('admin'), async (req, res) => {
  try {
    if (req.params.openId === req.openId) {
      return res.status(400).json({ error: 'Không thể tự xoá chính mình' });
    }
    await db.deleteUser(req.params.openId);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /users/:openId lỗi:', err.message);
    res.status(500).json({ error: 'Xoá người dùng thất bại' });
  }
});

// ─── Quản lý mẫu tin nhắn (admin) ─────────────────────────────────────
router.get('/message-templates', auth.requireRole('admin'), async (req, res) => {
  res.json({ templates: await messages.listTemplates(), variables: messages.VAR_HELP });
});

router.post('/message-templates', auth.requireRole('admin'), async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Thiếu title/content' });
    res.status(201).json(await messages.createTemplate({ title, content }));
  } catch (err) {
    console.error('POST /message-templates lỗi:', err.message);
    res.status(500).json({ error: 'Tạo mẫu tin nhắn thất bại' });
  }
});

router.patch('/message-templates/:key', auth.requireRole('admin'), async (req, res) => {
  try {
    const { title, content } = req.body;
    res.json(await messages.updateTemplate(req.params.key, { title, content }));
  } catch (err) {
    console.error('PATCH /message-templates/:key lỗi:', err.message);
    res.status(500).json({ error: 'Cập nhật mẫu tin nhắn thất bại' });
  }
});

router.delete('/message-templates/:key', auth.requireRole('admin'), async (req, res) => {
  try {
    await messages.deleteTemplate(req.params.key);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Cài đặt báo cáo sáng (giờ/ngày/đối tượng gửi) ────────────────────
router.get('/settings', auth.requireRole('admin'), async (req, res) => {
  res.json(await settings.getAllSettings());
});

router.put('/settings', auth.requireRole('admin'), async (req, res) => {
  try {
    res.json(await settings.setSettings(req.body || {}));
  } catch (err) {
    console.error('PUT /settings lỗi:', err.message);
    res.status(500).json({ error: 'Lưu cài đặt thất bại' });
  }
});

module.exports = router;
