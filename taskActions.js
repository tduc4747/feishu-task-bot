// ─── Logic chuyển trạng thái task, dùng chung cho card chat (callback.js) và REST API (api.js) ───
const { sendDM, formatText, formatDate } = require('./helpers');
const db = require('./db');
const { syncTaskToBitable, scheduleQuickSync } = require('./bitable');
const { renderMessage } = require('./messages');
const config = require('./config');

const { COLS, STATUS } = config;
const TASK_TABLE = config.TABLE.TASK;

async function assignTask({ recordId, assigneeId, actorId }) {
  const allMembers = await db.getMediaMembers();
  const assignee = allMembers.find(m => m.id === assigneeId);
  if (!assignee) throw new Error('Người thực hiện không hợp lệ hoặc không còn trong DS_TEAM');

  await db.updateRecord(TASK_TABLE, recordId, {
    [COLS.NGUOI_THUC_HIEN]: [{ id: assigneeId, name: assignee.name }],
    [COLS.TRANG_THAI]: STATUS.DANG_CHO,
  });

  const task = await db.getRecord(TASK_TABLE, recordId);
  const taskName = formatText(task.fields[COLS.TASK_NAME]);
  const sku = formatText(task.fields[COLS.SKU]);
  const moTa = formatText(task.fields[COLS.MO_TA_CHI_TIET]);
  const vars = { ten_task: taskName, sku, mo_ta_chi_tiet: moTa !== 'N/A' ? moTa : '', deadline: formatDate(task.fields[COLS.DEADLINE]), ten_nguoi_giao: formatText(task.fields[COLS.NGUOI_GIAO]).replace(/^@/, ''), ten_nguoi_thuc_hien: assignee.name };

  syncTaskToBitable(task); scheduleQuickSync(); // nền, không chờ + lưới an toàn 10s sau

  await Promise.all([
    sendDM(assigneeId, await renderMessage('task_assigned', vars)),
    actorId && actorId !== assigneeId ? sendDM(actorId, await renderMessage('task_assign_confirm', vars)) : null,
  ]);

  return { task, members: allMembers };
}

async function startTask({ recordId, userId }) {
  await db.updateRecord(TASK_TABLE, recordId, {
    [COLS.TRANG_THAI]: STATUS.DANG_LAM,
  });

  const task = await db.getRecord(TASK_TABLE, recordId);
  const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
  const taskName = formatText(task.fields[COLS.TASK_NAME]);
  const sku = formatText(task.fields[COLS.SKU]);
  const thucHienName = task.fields[COLS.NGUOI_THUC_HIEN]?.[0]?.name || '';
  const vars = { ten_task: taskName, sku, ten_nguoi_thuc_hien: thucHienName };
  const notifySale = saleId && saleId !== userId && await db.userExists(saleId);

  syncTaskToBitable(task); scheduleQuickSync(); // nền, không chờ + lưới an toàn 10s sau

  await Promise.all([
    sendDM(userId, await renderMessage('task_started_self', vars)),
    notifySale ? sendDM(saleId, await renderMessage('task_started_notify_sale', vars)) : null,
  ]);

  return { task };
}

async function pendingCheckTask({ recordId, userId }) {
  await db.updateRecord(TASK_TABLE, recordId, {
    [COLS.TRANG_THAI]: STATUS.CHO_CHECK,
  });

  const task = await db.getRecord(TASK_TABLE, recordId);
  const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
  const taskName = formatText(task.fields[COLS.TASK_NAME]);
  const sku = formatText(task.fields[COLS.SKU]);
  const saleActive = saleId && await db.userExists(saleId);
  const notifyId = saleActive ? saleId : userId;

  syncTaskToBitable(task); scheduleQuickSync(); // nền, không chờ + lưới an toàn 10s sau

  if (saleActive && saleId !== userId) {
    await sendDM(userId, await renderMessage('task_pending_check_self', { ten_task: taskName, sku }));
  }

  return { task, taskName, sku, notifyId, saleActive };
}

async function completeTask({ recordId, userId }) {
  await db.updateRecord(TASK_TABLE, recordId, {
    [COLS.TRANG_THAI]: STATUS.HOAN_THANH,
    [db.INTERNAL_FIELDS.COMPLETED_AT]: new Date(),
  });

  const task = await db.getRecord(TASK_TABLE, recordId);
  const mediaId = task.fields[COLS.NGUOI_THUC_HIEN]?.[0]?.id;
  const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
  const taskName = formatText(task.fields[COLS.TASK_NAME]);
  const sku = formatText(task.fields[COLS.SKU]);

  const [notifySale, notifyMedia, msg] = await Promise.all([
    saleId && saleId !== userId ? db.userExists(saleId) : false,
    mediaId && mediaId !== userId ? db.userExists(mediaId) : false,
    renderMessage('task_completed', { ten_task: taskName, sku }),
  ]);

  syncTaskToBitable(task); scheduleQuickSync(); // nền, không chờ + lưới an toàn 10s sau

  await Promise.all([
    sendDM(userId, msg),
    notifySale ? sendDM(saleId, msg) : null,
    notifyMedia ? sendDM(mediaId, msg) : null,
  ]);

  return { task };
}

module.exports = { assignTask, startTask, pendingCheckTask, completeTask };
