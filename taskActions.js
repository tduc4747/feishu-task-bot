// ─── Logic chuyển trạng thái task, dùng chung cho card chat (callback.js) và REST API (api.js) ───
const { sendDM, formatText, formatDate } = require('./helpers');
const db = require('./db');
const { syncTaskToBitable, scheduleQuickSync } = require('./bitable');
const { renderMessage } = require('./messages');
const config = require('./config');

const { COLS, STATUS } = config;
const TASK_TABLE = config.TABLE.TASK;

// Luôn build đủ cả 7 biến cho mọi tin nhắn, tránh trường hợp admin sửa mẫu
// dùng 1 biến mà callsite không truyền -> hiện nguyên "$ten_xyz" chưa thay.
function buildVars(task) {
  const moTa = formatText(task.fields[COLS.MO_TA_CHI_TIET]);
  return {
    ten_task: formatText(task.fields[COLS.TASK_NAME]),
    sku: formatText(task.fields[COLS.SKU]),
    mo_ta_chi_tiet: moTa !== 'N/A' ? moTa : '',
    deadline: formatDate(task.fields[COLS.DEADLINE]),
    ten_nguoi_giao: task.fields[COLS.NGUOI_GIAO]?.[0]?.name || '',
    ten_nguoi_thuc_hien: task.fields[COLS.NGUOI_THUC_HIEN]?.[0]?.name || '',
    trang_thai: task.fields[COLS.TRANG_THAI] || '',
  };
}

async function assignTask({ recordId, assigneeId, actorId }) {
  const allMembers = await db.getMediaMembers();
  const assignee = allMembers.find(m => m.id === assigneeId);
  if (!assignee) throw new Error('Người thực hiện không hợp lệ hoặc không còn trong DS_TEAM');

  await db.updateRecord(TASK_TABLE, recordId, {
    [COLS.NGUOI_THUC_HIEN]: [{ id: assigneeId, name: assignee.name }],
    [COLS.TRANG_THAI]: STATUS.DANG_CHO,
  });

  const task = await db.getRecord(TASK_TABLE, recordId);
  const vars = buildVars(task);

  syncTaskToBitable(task); scheduleQuickSync(); // nền, không chờ + lưới an toàn 10s sau

  const adminMsg = await renderMessage('task_assigned_notify_admin', vars);
  const admins = adminMsg ? await db.getAdminIds() : [];

  await Promise.all([
    sendDM(assigneeId, await renderMessage('task_assigned', vars)),
    actorId && actorId !== assigneeId ? sendDM(actorId, await renderMessage('task_assign_confirm', vars)) : null,
    ...admins.filter(a => a.id !== actorId).map(a => sendDM(a.id, adminMsg)),
  ]);

  return { task, members: allMembers };
}

async function startTask({ recordId, userId }) {
  await db.updateRecord(TASK_TABLE, recordId, {
    [COLS.TRANG_THAI]: STATUS.DANG_LAM,
  });

  const task = await db.getRecord(TASK_TABLE, recordId);
  const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
  const vars = buildVars(task);
  const notifySale = saleId && saleId !== userId && await db.userExists(saleId);

  syncTaskToBitable(task); scheduleQuickSync(); // nền, không chờ + lưới an toàn 10s sau

  const adminMsg = await renderMessage('task_started_notify_admin', vars);
  const admins = adminMsg ? await db.getAdminIds() : [];

  await Promise.all([
    sendDM(userId, await renderMessage('task_started_self', vars)),
    notifySale ? sendDM(saleId, await renderMessage('task_started_notify_sale', vars)) : null,
    ...admins.filter(a => a.id !== userId).map(a => sendDM(a.id, adminMsg)),
  ]);

  return { task };
}

async function pendingCheckTask({ recordId, userId }) {
  await db.updateRecord(TASK_TABLE, recordId, {
    [COLS.TRANG_THAI]: STATUS.CHO_CHECK,
  });

  const task = await db.getRecord(TASK_TABLE, recordId);
  const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
  const vars = buildVars(task);
  const saleActive = saleId && await db.userExists(saleId);
  const notifyId = saleActive ? saleId : userId;

  syncTaskToBitable(task); scheduleQuickSync(); // nền, không chờ + lưới an toàn 10s sau

  if (saleActive && saleId !== userId) {
    await sendDM(userId, await renderMessage('task_pending_check_self', vars));
  }

  return { task, taskName: vars.ten_task, sku: vars.sku, notifyId, saleActive };
}

async function completeTask({ recordId, userId }) {
  await db.updateRecord(TASK_TABLE, recordId, {
    [COLS.TRANG_THAI]: STATUS.HOAN_THANH,
    [db.INTERNAL_FIELDS.COMPLETED_AT]: new Date(),
  });

  const task = await db.getRecord(TASK_TABLE, recordId);
  const mediaId = task.fields[COLS.NGUOI_THUC_HIEN]?.[0]?.id;
  const saleId = task.fields[COLS.NGUOI_GIAO]?.[0]?.id;
  const vars = buildVars(task);

  const [saleActive, mediaActive, msgForSale, msgForMedia, msgForAdmin] = await Promise.all([
    saleId ? db.userExists(saleId) : false,
    mediaId ? db.userExists(mediaId) : false,
    renderMessage('task_completed', vars),
    renderMessage('task_completed_for_media', vars),
    renderMessage('task_completed_notify_admin', vars),
  ]);

  syncTaskToBitable(task); scheduleQuickSync(); // nền, không chờ + lưới an toàn 10s sau

  // Người giao và người thực hiện nhận 2 nội dung khác nhau. Nếu người bấm
  // hoàn thành không phải là 1 trong 2 (vd admin bấm giùm) thì báo chung 1 lần.
  const notifiedIds = new Set();
  const jobs = [];
  if (saleActive) { jobs.push(sendDM(saleId, msgForSale)); notifiedIds.add(saleId); }
  if (mediaActive && !notifiedIds.has(mediaId)) { jobs.push(sendDM(mediaId, msgForMedia)); notifiedIds.add(mediaId); }
  if (userId && !notifiedIds.has(userId) && await db.userExists(userId)) jobs.push(sendDM(userId, msgForSale));

  if (msgForAdmin) {
    const admins = await db.getAdminIds();
    admins.filter(a => !notifiedIds.has(a.id) && a.id !== userId).forEach(a => jobs.push(sendDM(a.id, msgForAdmin)));
  }

  await Promise.all(jobs);

  return { task };
}

module.exports = { assignTask, startTask, pendingCheckTask, completeTask };
