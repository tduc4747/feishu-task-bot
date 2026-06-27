const { sendDM, sendCard, formatText } = require('./helpers');
const { getUserRole, getMyTasks, getTasksBySale, getPendingTasks, getMediaMembers, getWorkload } = require('./db');
const db = require('./db');
const { getRecord: getBitableRecord } = require('./bitable-legacy');
const { cardMainMenu, cardMediaTasks, cardSaleTasks, cardPendingTasks, cardWorkload } = require('./cards');
const config = require('./config');

const { COLS } = config;
const TASK_TABLE = config.TABLE.TASK;

// ─── Sale gửi task mới qua form Base -> ghi ngay vào Postgres ───
// Lưu ý: cần bật event subscription "Record Changed" cho bảng TASK trong
// Feishu Developer Console, trỏ về route nhận event này (xem index.js).
async function handleNewBitableRecord(event) {
  const actions = event.action_list || [];
  for (const act of actions) {
    if (act.action_type !== 'AddRecord' && act.action_type !== 'add_record') continue;
    const bitableRecordId = act.record_id;
    if (!bitableRecordId) continue;

    const record = await getBitableRecord(TASK_TABLE, bitableRecordId);
    if (!record) continue;
    const f = record.fields;
    const nguoiGiao = Array.isArray(f[COLS.NGUOI_GIAO]) ? f[COLS.NGUOI_GIAO][0] : null;

    await db.createTask({
      taskName: formatText(f[COLS.TASK_NAME]),
      sku: formatText(f[COLS.SKU]),
      moTaNgan: formatText(f[COLS.MO_TA_NGAN]),
      moTaChiTiet: formatText(f[COLS.MO_TA_CHI_TIET]),
      deadline: f[COLS.DEADLINE] || null,
      nguoiGiaoId: nguoiGiao?.id || null,
      nguoiGiaoName: nguoiGiao?.name || null,
      bitableRecordId,
    });
  }
}

// ─── Xử lý tin nhắn + menu click ────────────────────────────────
async function handleWebhook(req, res) {
  const body = req.body;

  // Feishu URL verification
  if (body.type === 'url_verification' || body.challenge) {
    return res.status(200).json({ challenge: body.challenge });
  }

  res.sendStatus(200);

  try {
    const event = body.event;
    if (!event) return;

    const eventType = body.header?.event_type || event.type;
    let userId = null;
    let action = null;

    // ─── Xác định userId và action ──────────────────
    if (eventType === 'im.message.receive_v1') {
      userId = event.sender?.sender_id?.open_id;
      const msgType = event.message?.message_type;
      if (msgType !== 'text') return;
      const text = JSON.parse(event.message.content).text.trim().toLowerCase();

      // Map text → action
      if (['menu', 'start', 'bắt đầu', 'bat dau', 'xin chào', 'xin chao', 'hello', 'hi'].includes(text)) {
        action = 'show_menu';
      } else {
        action = 'show_menu'; // mặc định hiện menu
      }

    } else if (eventType === 'application.bot.menu_v6') {
      userId = event.operator?.operator_id?.open_id;
      action = event.event_key;

    } else if (eventType === 'drive.file.bitable_record_changed_v1') {
      if (event.table_id === TASK_TABLE) await handleNewBitableRecord(event);
      return;

    } else {
      return;
    }

    if (!userId) return;

    // ─── Lấy role của user ──────────────────────────
    const roles = await getUserRole(userId);
    if (roles.length === 0) {
      await sendDM(userId, '⛔ Bạn chưa được thêm vào hệ thống. Vui lòng liên hệ admin.');
      return;
    }

    // ─── Xử lý action ───────────────────────────────
    if (action === 'show_menu') {
      await sendCard(userId, cardMainMenu(roles));

    } else if (action === 'sale_my_tasks') {
      if (!roles.includes('sale')) {
        await sendDM(userId, '⛔ Bạn không có quyền truy cập chức năng này.');
        return;
      }
      const tasks = await getTasksBySale(userId);
      await sendCard(userId, cardSaleTasks(tasks));

    } else if (action === 'media_my_tasks') {
      if (!roles.includes('media') && !roles.includes('admin')) {
        await sendDM(userId, '⛔ Bạn không có quyền truy cập chức năng này.');
        return;
      }
      const tasks = await getMyTasks(userId);
      await sendCard(userId, cardMediaTasks(tasks));

    } else if (action === 'admin_pending_tasks') {
      if (!roles.includes('admin')) {
        await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.');
        return;
      }
      const tasks = await getPendingTasks();
      const members = await getMediaMembers();
      await sendCard(userId, cardPendingTasks(tasks, members));

    } else if (action === 'admin_workload') {
      if (!roles.includes('admin')) {
        await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.');
        return;
      }
      const workload = await getWorkload();
      await sendCard(userId, cardWorkload(workload));

    } else {
      await sendCard(userId, cardMainMenu(roles));
    }

  } catch (err) {
    console.error('Webhook error:', err.message, err.stack);
  }
}

module.exports = { handleWebhook };
