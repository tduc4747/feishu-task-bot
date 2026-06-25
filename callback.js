const { sendDM, sendCard, updateCard } = require('./helpers');
const { getUserRole, getMyTasks, getTasksBySale, getPendingTasks, getMediaMembers, updateRecord, getRecord } = require('./bitable');
const { cardMediaTasks, cardSaleTasks, cardPendingTasks } = require('./cards');
const config = require('./config');

const { COLS, STATUS } = config;
const TASK_TABLE = config.TABLE.TASK;

// ─── Xử lý button click từ card ─────────────────────────────────
async function handleCallback(req, res) {
  console.log('=== CALLBACK HIT ===');
  console.log('Body:', JSON.stringify(req.body).substring(0, 500));
  const body = req.body;

  if (body.type === 'url_verification' || body.challenge) {
    return res.status(200).json({ challenge: body.challenge });
  }

  res.sendStatus(200);

  try {

// Feishu Card 2.0: operator và action nằm trong body.event
const eventData = body.event || {};
const action = eventData.action?.value?.action || eventData.action?.value?.key;
const userId = eventData.operator?.open_id;
const messageId = eventData.open_message_id;
const recordId_global = eventData.action?.value?.record_id;
console.log('Action:', action, 'UserId:', userId, 'RecordId:', recordId_global);
console.log('Action:', action, 'UserId:', userId, 'MessageId:', messageId);
console.log('Full value:', JSON.stringify(body.action?.value));
if (!action || !userId) {
  console.log('Missing action or userId, returning');
  return;
}

    const roles = await getUserRole(userId);

    // ─── Sale: xem task đã gửi ──────────────────────
    if (action === 'sale_my_tasks') {
      if (!roles.includes('sale')) {
        await sendDM(userId, '⛔ Bạn không có quyền truy cập chức năng này.');
        return;
      }
      const tasks = await getTasksBySale(userId);
      await sendCard(userId, cardSaleTasks(tasks, messageId));

    // ─── Media: xem task của mình ───────────────────
    } else if (action === 'media_my_tasks') {
      if (!roles.includes('media') && !roles.includes('admin')) {
        await sendDM(userId, '⛔ Bạn không có quyền truy cập chức năng này.');
        return;
      }
      const tasks = await getMyTasks(userId);
      await sendCard(userId, cardMediaTasks(tasks, messageId));

    // ─── Admin: xem task chờ gán ────────────────────
    } else if (action === 'admin_pending_tasks') {
      if (!roles.includes('admin')) {
        await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.');
        return;
      }
      const tasks = await getPendingTasks();
      const members = await getMediaMembers();
      await sendCard(userId, cardPendingTasks(tasks, members));

    // ─── Admin: chọn người thực hiện ────────────────
    } else if (action === 'select_assignee') {
      // Lưu tạm lựa chọn — Feishu tự xử lý qua form_value
      // Không cần làm gì ở đây

    // ─── Admin: gán task ────────────────────────────
    } else if (action === 'assign_task') {
      if (!roles.includes('admin')) {
        await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.');
        return;
      }
      const recordId = eventData.action?.value?.record_id;
      const formValues = body.action?.form_value || {};

      // Lấy assignee từ select_static
      let assigneeId = null;
      for (const key of Object.keys(formValues)) {
        const val = formValues[key];
        if (typeof val === 'string' && val.startsWith('ou_')) {
          assigneeId = val;
          break;
        }
        if (Array.isArray(val) && val[0]?.startsWith?.('ou_')) {
          assigneeId = val[0];
          break;
        }
      }

      if (!assigneeId) {
        await sendDM(userId, '⚠️ Vui lòng chọn người thực hiện trước khi gán!');
        return;
      }

      // Cập nhật Bitable
      await updateRecord(TASK_TABLE, recordId, {
        [COLS.NGUOI_THUC_HIEN]: [{ id: assigneeId }],
        [COLS.TRANG_THAI]: STATUS.DANG_CHO,
      });

      // Lấy thông tin task để notify
      const task = await getRecord(TASK_TABLE, recordId);
      const taskName = task.fields[COLS.TASK_NAME];
      const sku = task.fields[COLS.SKU];

      // Notify nhân viên được gán
      await sendDM(assigneeId, `📌 Bạn vừa được gán task mới!\nTask: ${taskName}\nSKU: ${sku}\nNhắn "hi" để xem chi tiết.`);
      await sendDM(userId, `✅ Đã gán task thành công.`);

      // Update lại card chờ gán
      const pendingTasks = await getPendingTasks();
      const members = await getMediaMembers();
      await updateCard(messageId, cardPendingTasks(pendingTasks, members));

    // ─── Media: bắt đầu làm ─────────────────────────
    } else if (action === 'start_task') {
      const recordId = eventData.action?.value?.record_id;
      const cardMessageId = body.action?.value?.message_id || messageId;

      await updateRecord(TASK_TABLE, recordId, {
        [COLS.TRANG_THAI]: STATUS.DANG_LAM,
        [COLS.DANG_LAM]: 1,
      });

      // Notify người giao
      const task = await getRecord(TASK_TABLE, recordId);
      const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
      const taskName = task.fields[COLS.TASK_NAME];
      const sku = task.fields[COLS.SKU];
      if (saleId) await sendDM(saleId, `🔄 Task "${taskName} | ${sku}" đã được bắt đầu thực hiện.`);

      // Update lại card realtime
      const tasks = await getMyTasks(userId);
      await updateCard(cardMessageId, cardMediaTasks(tasks, cardMessageId));

    // ─── Media: chờ check ───────────────────────────
    } else if (action === 'pending_check') {
      const recordId = eventData.action?.value?.record_id;
      const cardMessageId = body.action?.value?.message_id || messageId;

      await updateRecord(TASK_TABLE, recordId, {
        [COLS.TRANG_THAI]: STATUS.CHO_CHECK,
        [COLS.CHO_CHECK]: 1,
      });

      // Notify người giao
      const task = await getRecord(TASK_TABLE, recordId);
      const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
      const taskName = task.fields[COLS.TASK_NAME];
      const sku = task.fields[COLS.SKU];
      if (saleId) await sendDM(saleId, `👀 Task "${taskName} | ${sku}" đang chờ bạn kiểm tra.\nVào bot để duyệt hoàn thành.`);

      // Update lại card realtime
      const tasks = await getMyTasks(userId);
      await updateCard(cardMessageId, cardMediaTasks(tasks, cardMessageId));

    // ─── Sale/Media/Admin: hoàn thành ───────────────
    } else if (action === 'complete_task') {
      const recordId = eventData.action?.value?.record_id;
      const cardMessageId = body.action?.value?.message_id || messageId;

      await updateRecord(TASK_TABLE, recordId, {
        [COLS.TRANG_THAI]: STATUS.HOAN_THANH,
        [COLS.DONE]: 1,
      });

      const task = await getRecord(TASK_TABLE, recordId);
      const mediaId = task.fields[COLS.NGUOI_THUC_HIEN]?.[0]?.id;
      const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
      const taskName = task.fields[COLS.TASK_NAME];
      const sku = task.fields[COLS.SKU];
      const msg = `✅ Task "${taskName} | ${sku}" đã hoàn thành!`;

      // Notify cả sale lẫn media
      if (saleId && saleId !== userId) await sendDM(saleId, msg);
      if (mediaId && mediaId !== userId) await sendDM(mediaId, msg);

      // Update lại card realtime tùy role người bấm
      if (roles.includes('sale')) {
        const tasks = await getTasksBySale(userId);
        await updateCard(cardMessageId, cardSaleTasks(tasks, cardMessageId));
      } else {
        const tasks = await getMyTasks(userId);
        await updateCard(cardMessageId, cardMediaTasks(tasks, cardMessageId));
      }
    }

  } catch (err) {
    console.error('Callback error:', err.message, err.stack);
  }
}

module.exports = { handleCallback };
