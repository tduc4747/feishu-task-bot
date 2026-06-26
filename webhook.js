const { sendDM, sendCard } = require('./helpers');
const { getUserRole, getMyTasks, getTasksBySale, getPendingTasks, getMediaMembers, getWorkload } = require('./bitable');
const { cardMainMenu, cardMediaTasks, cardSaleTasks, cardPendingTasks, cardWorkload } = require('./cards');

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

    } else {
      return;
    }

    if (!userId) return;

    // ─── Gửi loading ngay khi có action tốn thời gian ──────────
    const HEAVY_ACTIONS = ['sale_my_tasks', 'media_my_tasks', 'admin_pending_tasks', 'admin_workload'];
    if (HEAVY_ACTIONS.includes(action)) {
      await sendDM(userId, '⏳ Đang tải dữ liệu...');
    }

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
      await sendCard(userId, cardSaleTasks(tasks, null));

    } else if (action === 'media_my_tasks') {
      if (!roles.includes('media') && !roles.includes('admin')) {
        await sendDM(userId, '⛔ Bạn không có quyền truy cập chức năng này.');
        return;
      }
      const tasks = await getMyTasks(userId);
      await sendCard(userId, cardMediaTasks(tasks, null));

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
