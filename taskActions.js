// ─── Logic chuyển trạng thái task, dùng chung cho card chat (callback.js) và REST API (api.js) ───
const { sendDM, formatText } = require('./helpers');
const db = require('./db');
const { syncTaskToBitable } = require('./bitable');
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

  syncTaskToBitable(task); // nền, không chờ

  await Promise.all([
    sendDM(assigneeId, `📌 Bạn vừa được gán task mới!\nTask: ${taskName}\nSKU: ${sku}\nNhắn "hi" để xem chi tiết.`),
    actorId && actorId !== assigneeId ? sendDM(actorId, `✅ Đã gán task thành công.`) : null,
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
  const notifySale = saleId && saleId !== userId && await db.userExists(saleId);

  syncTaskToBitable(task); // nền, không chờ

  await Promise.all([
    sendDM(userId, `▶️ Đã bắt đầu làm task "${taskName}"!`),
    notifySale ? sendDM(saleId, `🔄 Task "${taskName} | ${sku}" đã được bắt đầu thực hiện.`) : null,
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

  syncTaskToBitable(task); // nền, không chờ

  if (saleActive && saleId !== userId) {
    await sendDM(userId, `👀 Đã chuyển sang "Chờ check". Đang chờ sale duyệt.`);
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
  const msg = `✅ Task "${taskName} | ${sku}" đã hoàn thành!`;

  const [notifySale, notifyMedia] = await Promise.all([
    saleId && saleId !== userId ? db.userExists(saleId) : false,
    mediaId && mediaId !== userId ? db.userExists(mediaId) : false,
  ]);

  syncTaskToBitable(task); // nền, không chờ

  await Promise.all([
    sendDM(userId, msg),
    notifySale ? sendDM(saleId, msg) : null,
    notifyMedia ? sendDM(mediaId, msg) : null,
  ]);

  return { task };
}

module.exports = { assignTask, startTask, pendingCheckTask, completeTask };
