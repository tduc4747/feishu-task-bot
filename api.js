// ─── REST API cho Feishu Mini Program ───
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const db = require('./db');
const { getTenantToken } = require('./helpers');
const taskActions = require('./taskActions');
const auth = require('./auth');
const config = require('./config');

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
  const roles = await db.getUserRole(req.openId);
  res.json({ openId: req.openId, roles });
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

router.get('/tasks/completed', async (req, res) => {
  const roles = req.roles || await db.getUserRole(req.openId);
  const filter = roles.includes('admin')
    ? {}
    : { saleId: roles.includes('sale') ? req.openId : undefined, mediaId: roles.includes('media') ? req.openId : undefined };
  res.json(await db.getCompletedTasks(filter));
});

// ─── Tạo task mới (Sale) ─────────────────────────────────────────────
router.post('/tasks', auth.requireRole('sale', 'admin'), async (req, res) => {
  try {
    const { taskName, sku, moTaNgan, moTaChiTiet, deadline, attachmentUrl, nguoiGiaoId } = req.body;
    if (!taskName || !sku || !moTaNgan || !deadline) {
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
    }
    if (moTaNgan.length > 150) {
      return res.status(400).json({ error: 'Mô tả ngắn không được vượt quá 150 ký tự' });
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
      taskName, sku, moTaNgan, moTaChiTiet, deadline,
      nguoiGiaoId: giaoId, nguoiGiaoName: giaoName,
      attachmentUrl: attachmentUrl || null,
    });

    require('./bitable').syncTaskToBitable(task); // nền, không chờ
    res.status(201).json(task);
  } catch (err) {
    console.error('POST /tasks lỗi:', err.message);
    res.status(500).json({ error: 'Tạo task thất bại' });
  }
});

// ─── Sửa task (field thường) ─────────────────────────────────────────
router.patch('/tasks/:id', auth.requireRole('sale', 'admin'), async (req, res) => {
  try {
    const fields = {};
    const { taskName, sku, moTaNgan, moTaChiTiet, deadline, attachmentUrl } = req.body;
    if (moTaNgan !== undefined && moTaNgan.length > 150) {
      return res.status(400).json({ error: 'Mô tả ngắn không được vượt quá 150 ký tự' });
    }
    if (taskName !== undefined) fields[COLS.TASK_NAME] = taskName;
    if (sku !== undefined) fields[COLS.SKU] = sku;
    if (moTaNgan !== undefined) fields[COLS.MO_TA_NGAN] = moTaNgan;
    if (moTaChiTiet !== undefined) fields[COLS.MO_TA_CHI_TIET] = moTaChiTiet;
    if (deadline !== undefined) fields[COLS.DEADLINE] = deadline;
    if (attachmentUrl !== undefined) fields[db.INTERNAL_FIELDS.ATTACHMENT_URL] = attachmentUrl;

    await db.updateRecord(TASK_TABLE, req.params.id, fields);
    const task = await db.getRecord(TASK_TABLE, req.params.id);
    require('./bitable').syncTaskToBitable(task);
    res.json(task);
  } catch (err) {
    console.error('PATCH /tasks/:id lỗi:', err.message);
    res.status(500).json({ error: 'Cập nhật task thất bại' });
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

// ─── Tải file/ảnh đính kèm lên Feishu, trả về reference để gắn vào task ───
router.post('/uploads', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Thiếu file' });
    const token = await getTenantToken();
    const isImage = req.file.mimetype.startsWith('image/');

    if (isImage) {
      const form = new FormData();
      form.append('image_type', 'message');
      form.append('image', req.file.buffer, { filename: req.file.originalname });
      const r = await axios.post('https://open.feishu.cn/open-apis/im/v1/images', form, {
        headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
      });
      return res.json({ attachmentUrl: `feishu_image:${r.data.data.image_key}` });
    }

    const form = new FormData();
    form.append('file_name', req.file.originalname);
    form.append('parent_type', 'ccm_import_open');
    form.append('size', String(req.file.size));
    form.append('file', req.file.buffer, { filename: req.file.originalname });
    const r = await axios.post('https://open.feishu.cn/open-apis/drive/v1/files/upload_all', form, {
      headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
    });
    res.json({ attachmentUrl: `feishu_file:${r.data.data.file_token}` });
  } catch (err) {
    console.error('upload lỗi:', err.response?.data || err.message);
    res.status(500).json({ error: 'Tải file lên thất bại' });
  }
});

module.exports = router;
