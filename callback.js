const { sendDM, sendCard, updateCard, formatText } = require('./helpers');
const { getUserRole, getMyTasks, getTasksBySale, getPendingTasks, getMediaMembers, updateRecord, getRecord } = require('./bitable');
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

  // select_static changes don't need a toast — just acknowledge
  const actionTag = body.event?.action?.tag || body.action?.tag;
  if (actionTag === 'select_static') {
    res.sendStatus(200);
  } else {
    res.json({ toast: { type: 'info', content: '⏳ Đang xử lý...' } });
  }

  try {
    const eventData = body.event || {};
    const action = eventData.action?.value?.action || eventData.action?.value?.key;
    const userId = eventData.operator?.open_id;
    const messageId = eventData.context?.open_message_id || eventData.open_message_id;
    const cardMessageId = eventData.action?.value?.message_id || messageId;
    const formValues = eventData.action?.form_value || eventData.form_value || {};

    console.log('Action:', action, '| UserId:', userId, '| MessageId:', messageId);

    if (!action || !userId) {
      console.log('Missing action or userId');
      return;
    }

    const roles = await getUserRole(userId);

    if (action === 'sale_my_tasks') {
      if (!roles.includes('sale')) { await sendDM(userId, '⛔ Bạn không có quyền truy cập.'); return; }
      const tasks = await getTasksBySale(userId);
      await sendCard(userId, cardSaleTasks(tasks, messageId));

    } else if (action === 'media_my_tasks') {
      if (!roles.includes('media') && !roles.includes('admin')) { await sendDM(userId, '⛔ Bạn không có quyền truy cập.'); return; }
      const tasks = await getMyTasks(userId);
      await sendCard(userId, cardMediaTasks(tasks, messageId));

    } else if (action === 'admin_pending_tasks') {
      if (!roles.includes('admin')) { await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.'); return; }
      const tasks = await getPendingTasks();
      const members = await getMediaMembers();
      await sendCard(userId, cardPendingTasks(tasks, members));

    } else if (action === 'admin_workload') {
      if (!roles.includes('admin')) { await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.'); return; }
      const { getWorkload } = require('./bitable');
      const workload = await getWorkload();
      await sendCard(userId, cardWorkload(workload));

    } else if (action === 'assign_task') {
      if (!roles.includes('admin')) { await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.'); return; }
      const recordId = eventData.action?.value?.record_id;

      // Read by name="assignee" first, then fall back to scanning all values
      let assigneeId = formValues.assignee || null;
      if (!assigneeId) {
        for (const key of Object.keys(formValues)) {
          const val = formValues[key];
          if (typeof val === 'string' && val.startsWith('ou_')) { assigneeId = val; break; }
          if (Array.isArray(val)) {
            const found = val.find(v => typeof v === 'string' && v.startsWith('ou_'));
            if (found) { assigneeId = found; break; }
          }
        }
      }

      console.log('AssigneeId:', assigneeId);

      if (!assigneeId) { await sendDM(userId, '⚠️ Vui lòng chọn người thực hiện trước!'); return; }

      await updateRecord(TASK_TABLE, recordId, {
        [COLS.NGUOI_THUC_HIEN]: [{ id: assigneeId }],
        [COLS.TRANG_THAI]: STATUS.DANG_CHO,
      });

      const task = await getRecord(TASK_TABLE, recordId);
      const taskName = formatText(task.fields[COLS.TASK_NAME]);
      const sku = formatText(task.fields[COLS.SKU]);

      await sendDM(assigneeId, `📌 Bạn vừa được gán task mới!\nTask: ${taskName}\nSKU: ${sku}\nNhắn "hi" để xem chi tiết.`);
      await sendDM(userId, `✅ Đã gán task thành công.`);

      const pendingTasks = await getPendingTasks();
      const members = await getMediaMembers();
      if (messageId) await updateCard(messageId, cardPendingTasks(pendingTasks, members));

    } else if (action === 'start_task') {
      const recordId = eventData.action?.value?.record_id;

      await updateRecord(TASK_TABLE, recordId, {
        [COLS.TRANG_THAI]: STATUS.DANG_LAM,
        [COLS.DANG_LAM]: true,
      });

      const task = await getRecord(TASK_TABLE, recordId);
      const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
      const taskName = formatText(task.fields[COLS.TASK_NAME]);
      const sku = formatText(task.fields[COLS.SKU]);

      if (saleId && saleId !== userId) await sendDM(saleId, `🔄 Task "${taskName} | ${sku}" đã được bắt đầu thực hiện.`);
      await sendDM(userId, `▶️ Đã bắt đầu làm task "${taskName}"!`);

      const tasks = await getMyTasks(userId);
      if (cardMessageId) await updateCard(cardMessageId, cardMediaTasks(tasks, cardMessageId));

    } else if (action === 'pending_check') {
      const recordId = eventData.action?.value?.record_id;

      await updateRecord(TASK_TABLE, recordId, {
        [COLS.TRANG_THAI]: STATUS.CHO_CHECK,
        [COLS.DANG_LAM]: false,
        [COLS.CHO_CHECK]: true,
      });

      const task = await getRecord(TASK_TABLE, recordId);
      const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
      const taskName = formatText(task.fields[COLS.TASK_NAME]);
      const sku = formatText(task.fields[COLS.SKU]);

      // Gửi card approve cho sale (kể cả khi test tự giao cho mình)
      const notifyId = saleId || userId;
      await sendCard(notifyId, cardSaleApprove(recordId, taskName, sku));
      if (saleId && saleId !== userId) {
        await sendDM(userId, `👀 Đã chuyển sang "Chờ check". Đang chờ sale duyệt.`);
      }

      const tasks = await getMyTasks(userId);
      if (cardMessageId) await updateCard(cardMessageId, cardMediaTasks(tasks, cardMessageId));

    } else if (action === 'complete_task') {
      const recordId = eventData.action?.value?.record_id;

      await updateRecord(TASK_TABLE, recordId, {
        [COLS.TRANG_THAI]: STATUS.HOAN_THANH,
        [COLS.DANG_LAM]: false,
        [COLS.CHO_CHECK]: false,
        [COLS.DONE]: true,
      });

      const task = await getRecord(TASK_TABLE, recordId);
      const mediaId = task.fields[COLS.NGUOI_THUC_HIEN]?.[0]?.id;
      const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
      const taskName = formatText(task.fields[COLS.TASK_NAME]);
      const sku = formatText(task.fields[COLS.SKU]);
      const msg = `✅ Task "${taskName} | ${sku}" đã hoàn thành!`;

      await sendDM(userId, msg);
      if (saleId && saleId !== userId) await sendDM(saleId, msg);
      if (mediaId && mediaId !== userId) await sendDM(mediaId, msg);

      if (roles.includes('sale')) {
        const tasks = await getTasksBySale(userId);
        if (cardMessageId) await updateCard(cardMessageId, cardSaleTasks(tasks, cardMessageId));
      } else {
        const tasks = await getMyTasks(userId);
        if (cardMessageId) await updateCard(cardMessageId, cardMediaTasks(tasks, cardMessageId));
      }
    }

  } catch (err) {
    console.error('Callback error:', err.message, err.stack);
  }
}

module.exports = { handleCallback };
