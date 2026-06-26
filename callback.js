const { sendDM, sendCard, updateCard, formatText } = require('./helpers');
const { getUserRole, getMyTasks, getTasksBySale, getPendingTasks, getMediaMembers, getWorkload, updateRecord, getRecord } = require('./db');
const { syncTaskToBitable } = require('./bitable');
const { cardMediaTasks, cardSaleTasks, cardPendingTasks, cardSaleApprove, cardWorkload } = require('./cards');
const config = require('./config');

const { COLS, STATUS } = config;
const TASK_TABLE = config.TABLE.TASK;

async function handleCallback(req, res) {
  console.log('=== CALLBACK HIT ===');
  const body = req.body;

  if (body.type === 'url_verification' || body.challenge) {
    return res.status(200).json({ challenge: body.challenge });
  }

  // Ack ngay lập tức, không hiện toast "đang xử lý" để tránh cảm giác delay
  res.sendStatus(200);

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

      await updateRecord(TASK_TABLE, recordId, {
        [COLS.NGUOI_THUC_HIEN]: [{ id: assigneeId }],
        [COLS.TRANG_THAI]: STATUS.DANG_CHO,
      });

      const [task, pendingTasks, members] = await Promise.all([
        getRecord(TASK_TABLE, recordId),
        getPendingTasks(),
        getMediaMembers(),
      ]);
      const taskName = formatText(task.fields[COLS.TASK_NAME]);
      const sku = formatText(task.fields[COLS.SKU]);

      syncTaskToBitable(task); // nền, không chờ

      await Promise.all([
        sendDM(assigneeId, `📌 Bạn vừa được gán task mới!\nTask: ${taskName}\nSKU: ${sku}\nNhắn "hi" để xem chi tiết.`),
        sendDM(userId, `✅ Đã gán task thành công.`),
        messageId ? updateCard(messageId, cardPendingTasks(pendingTasks, members)) : null,
      ]);

    } else if (action === 'start_task') {
      const recordId = eventData.action?.value?.record_id;

      await updateRecord(TASK_TABLE, recordId, {
        [COLS.TRANG_THAI]: STATUS.DANG_LAM,
        [COLS.DANG_LAM]: true,
      });

      const [task, tasks] = await Promise.all([getRecord(TASK_TABLE, recordId), getMyTasks(userId)]);
      const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
      const taskName = formatText(task.fields[COLS.TASK_NAME]);
      const sku = formatText(task.fields[COLS.SKU]);

      syncTaskToBitable(task); // nền, không chờ

      await Promise.all([
        cardMessageId ? updateCard(cardMessageId, cardMediaTasks(tasks)) : null,
        sendDM(userId, `▶️ Đã bắt đầu làm task "${taskName}"!`),
        (saleId && saleId !== userId) ? sendDM(saleId, `🔄 Task "${taskName} | ${sku}" đã được bắt đầu thực hiện.`) : null,
      ]);

    } else if (action === 'pending_check') {
      const recordId = eventData.action?.value?.record_id;

      // Giữ nguyên DANG_LAM:true (ô kiểm cũ không bị bỏ), chỉ thêm CHO_CHECK
      await updateRecord(TASK_TABLE, recordId, {
        [COLS.TRANG_THAI]: STATUS.CHO_CHECK,
        [COLS.CHO_CHECK]: true,
      });

      const [task, tasks] = await Promise.all([getRecord(TASK_TABLE, recordId), getMyTasks(userId)]);
      const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
      const taskName = formatText(task.fields[COLS.TASK_NAME]);
      const sku = formatText(task.fields[COLS.SKU]);
      const notifyId = saleId || userId;

      syncTaskToBitable(task); // nền, không chờ

      await Promise.all([
        cardMessageId ? updateCard(cardMessageId, cardMediaTasks(tasks)) : null,
        sendCard(notifyId, cardSaleApprove(recordId, taskName, sku)),
        (saleId && saleId !== userId) ? sendDM(userId, `👀 Đã chuyển sang "Chờ check". Đang chờ sale duyệt.`) : null,
      ]);

    } else if (action === 'complete_task') {
      const recordId = eventData.action?.value?.record_id;

      // Giữ nguyên DANG_LAM:true, CHO_CHECK:true (ô kiểm cũ không bị bỏ), chỉ thêm DONE
      await updateRecord(TASK_TABLE, recordId, {
        [COLS.TRANG_THAI]: STATUS.HOAN_THANH,
        [COLS.DONE]: true,
      });

      const [task, tasks] = await Promise.all([
        getRecord(TASK_TABLE, recordId),
        roles.includes('sale') ? getTasksBySale(userId) : getMyTasks(userId),
      ]);
      const mediaId = task.fields[COLS.NGUOI_THUC_HIEN]?.[0]?.id;
      const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
      const taskName = formatText(task.fields[COLS.TASK_NAME]);
      const sku = formatText(task.fields[COLS.SKU]);
      const msg = `✅ Task "${taskName} | ${sku}" đã hoàn thành!`;

      syncTaskToBitable(task); // nền, không chờ

      await Promise.all([
        cardMessageId
          ? updateCard(cardMessageId, roles.includes('sale') ? cardSaleTasks(tasks) : cardMediaTasks(tasks))
          : null,
        sendDM(userId, msg),
        (saleId && saleId !== userId) ? sendDM(saleId, msg) : null,
        (mediaId && mediaId !== userId) ? sendDM(mediaId, msg) : null,
      ]);
    }

  } catch (err) {
    console.error('Callback error:', err.message, err.stack);
  }
}

module.exports = { handleCallback };
