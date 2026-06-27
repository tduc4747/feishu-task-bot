const { sendDM, sendCard, updateCard } = require('./helpers');
const { getUserRole, getMyTasks, getTasksBySale, getPendingTasks, getMediaMembers, getWorkload } = require('./db');
const taskActions = require('./taskActions');
const { cardMediaTasks, cardSaleTasks, cardPendingTasks, cardSaleApprove, cardWorkload } = require('./cards');

async function handleCallback(req, res) {
  console.log('=== CALLBACK HIT ===');
  const body = req.body;

  if (body.type === 'url_verification' || body.challenge) {
    return res.status(200).json({ challenge: body.challenge });
  }

  // Ack ngay lập tức bằng JSON rỗng (không phải sendStatus rỗng) — các thành
  // phần tương tác như select_static cần body JSON hợp lệ để không báo lỗi client.
  res.status(200).json({});

  try {
    const eventData = body.event || {};
    const action = eventData.action?.value?.action || eventData.action?.value?.key;
    const userId = eventData.operator?.open_id;
    const messageId = eventData.context?.open_message_id || eventData.open_message_id;
    const cardMessageId = eventData.action?.value?.message_id || messageId;
    console.log('Action:', action, '| UserId:', userId, '| MessageId:', messageId);

    if (!action || !userId) {
      console.log('Missing action or userId');
      return;
    }

    const roles = await getUserRole(userId);

    if (action === 'sale_my_tasks') {
      if (!roles.includes('sale')) { await sendDM(userId, '⛔ Bạn không có quyền truy cập.'); return; }
      const tasks = await getTasksBySale(userId);
      await sendCard(userId, cardSaleTasks(tasks));

    } else if (action === 'media_my_tasks') {
      if (!roles.includes('media') && !roles.includes('admin')) { await sendDM(userId, '⛔ Bạn không có quyền truy cập.'); return; }
      const tasks = await getMyTasks(userId);
      await sendCard(userId, cardMediaTasks(tasks));

    } else if (action === 'admin_pending_tasks') {
      if (!roles.includes('admin')) { await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.'); return; }
      const tasks = await getPendingTasks();
      const members = await getMediaMembers();
      await sendCard(userId, cardPendingTasks(tasks, members));

    } else if (action === 'admin_workload') {
      if (!roles.includes('admin')) { await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.'); return; }
      const workload = await getWorkload();
      await sendCard(userId, cardWorkload(workload));

    } else if (action === 'assign_task') {
      if (!roles.includes('admin')) { await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.'); return; }
      const recordId = eventData.action?.value?.record_id;

      // Card cũ (không phải form): giá trị select_static nằm ở action.option,
      // không phải form_value (form_value chỉ có ở card kiểu "form" container).
      const assigneeId = eventData.action?.option || null;

      console.log('AssigneeId:', assigneeId);

      if (!assigneeId) { await sendDM(userId, '⚠️ Vui lòng chọn người thực hiện trước!'); return; }

      const { members } = await taskActions.assignTask({ recordId, assigneeId, actorId: userId });
      const pendingTasks = await getPendingTasks();

      if (messageId) await updateCard(messageId, cardPendingTasks(pendingTasks, members));

    } else if (action === 'start_task') {
      const recordId = eventData.action?.value?.record_id;

      await taskActions.startTask({ recordId, userId });
      const tasks = await getMyTasks(userId);

      if (cardMessageId) await updateCard(cardMessageId, cardMediaTasks(tasks));

    } else if (action === 'pending_check') {
      const recordId = eventData.action?.value?.record_id;

      const { taskName, sku, notifyId } = await taskActions.pendingCheckTask({ recordId, userId });
      const tasks = await getMyTasks(userId);

      await Promise.all([
        cardMessageId ? updateCard(cardMessageId, cardMediaTasks(tasks)) : null,
        sendCard(notifyId, cardSaleApprove(recordId, taskName, sku)),
      ]);

    } else if (action === 'complete_task') {
      const recordId = eventData.action?.value?.record_id;

      await taskActions.completeTask({ recordId, userId });
      const tasks = await (roles.includes('sale') ? getTasksBySale(userId) : getMyTasks(userId));

      if (cardMessageId) {
        await updateCard(cardMessageId, roles.includes('sale') ? cardSaleTasks(tasks) : cardMediaTasks(tasks));
      }
    }

  } catch (err) {
    console.error('Callback error:', err.message, err.stack);
  }
}

module.exports = { handleCallback };
