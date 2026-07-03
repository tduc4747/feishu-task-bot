// ─── Action menu chat dùng chung cho webhook.js (menu bot/tin nhắn) và callback.js (nút trên card) ───
// Trước đây 2 file nhân bản 4 nhánh xử lý giống hệt nhau, dễ sửa 1 nơi quên nơi kia.
const { sendDM, sendCard } = require('./helpers');
const { getMyTasks, getTasksBySale, getPendingTasks, getMediaMembers, getWorkload } = require('./db');
const { cardMediaTasks, cardSaleTasks, cardPendingTasks, cardWorkload } = require('./cards');

// Trả về true nếu action thuộc nhóm menu và đã được xử lý (kể cả trường hợp bị chặn quyền).
async function handleMenuAction(action, userId, roles) {
  if (action === 'sale_my_tasks') {
    if (!roles.includes('sale')) { await sendDM(userId, '⛔ Bạn không có quyền truy cập chức năng này.'); return true; }
    await sendCard(userId, cardSaleTasks(await getTasksBySale(userId)));

  } else if (action === 'media_my_tasks') {
    if (!roles.includes('media') && !roles.includes('admin')) { await sendDM(userId, '⛔ Bạn không có quyền truy cập chức năng này.'); return true; }
    await sendCard(userId, cardMediaTasks(await getMyTasks(userId)));

  } else if (action === 'admin_pending_tasks') {
    if (!roles.includes('admin')) { await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.'); return true; }
    await sendCard(userId, cardPendingTasks(await getPendingTasks(), await getMediaMembers()));

  } else if (action === 'admin_workload') {
    if (!roles.includes('admin')) { await sendDM(userId, '⛔ Chức năng này chỉ dành cho Admin.'); return true; }
    await sendCard(userId, cardWorkload(await getWorkload()));

  } else {
    return false;
  }
  return true;
}

module.exports = { handleMenuAction };
