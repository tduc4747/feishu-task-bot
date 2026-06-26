const axios = require('axios');
const { getTenantToken, formatText } = require('./helpers');
const config = require('./config');

const BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN;

// ─── Lấy danh sách records ───────────────────────────────────────
async function getRecords(tableId) {
  const token = await getTenantToken();
  let items = [];
  let pageToken = null;

  do {
    const params = { page_size: 100 };
    if (pageToken) params.page_token = pageToken;

    const res = await axios.get(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${tableId}/records`,
      { headers: { Authorization: `Bearer ${token}` }, params }
    );
    items = items.concat(res.data.data?.items || []);
    pageToken = res.data.data?.has_more ? res.data.data.page_token : null;
  } while (pageToken);

  return items;
}

// ─── Lấy 1 record ───────────────────────────────────────────────
async function getRecord(tableId, recordId) {
  const token = await getTenantToken();
  const res = await axios.get(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${tableId}/records/${recordId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.data?.record;
}

// ─── Cập nhật record ────────────────────────────────────────────
async function updateRecord(tableId, recordId, fields) {
  const token = await getTenantToken();
  await axios.put(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${tableId}/records/${recordId}`,
    { fields },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

// ─── Tạo record mới ─────────────────────────────────────────────
async function createRecord(tableId, fields) {
  const token = await getTenantToken();
  const res = await axios.post(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${tableId}/records`,
    { fields },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.data?.record;
}

// ─── Lấy tất cả task ────────────────────────────────────────────
async function getAllTasks() {
  return getRecords(config.TABLE.TASK);
}

// ─── Lấy task theo người thực hiện (media) ──────────────────────
async function getMyTasks(openId) {
  const tasks = await getAllTasks();
  const { STATUS, COLS } = config;
  return tasks.filter(t => {
    const nguoiThucHien = t.fields[COLS.NGUOI_THUC_HIEN];
    if (!nguoiThucHien || !Array.isArray(nguoiThucHien)) return false;
    const isAssigned = nguoiThucHien.some(u => u.id === openId || u.open_id === openId);
    const status = formatText(t.fields[COLS.TRANG_THAI]);
    const isActive = status !== STATUS.HOAN_THANH && status !== STATUS.CHO_GAN;
    return isAssigned && isActive;
  });
}

// ─── Lấy task theo người giao (sale) ────────────────────────────
async function getTasksBySale(openId) {
  const tasks = await getAllTasks();
  const { STATUS, COLS } = config;
  return tasks.filter(t => {
    const nguoiGiao = t.fields[COLS.NGUOI_GIAO];
    if (!nguoiGiao || !Array.isArray(nguoiGiao)) return false;
    const isSender = nguoiGiao.some(u => u.id === openId || u.open_id === openId);
    const status = formatText(t.fields[COLS.TRANG_THAI]);
    const isActive = status !== STATUS.HOAN_THANH;
    return isSender && isActive;
  });
}

// ─── Lấy task chờ gán (admin) - task chưa có người thực hiện ────
async function getPendingTasks() {
  const tasks = await getAllTasks();
  const { COLS } = config;
  return tasks.filter(t => {
    const assignee = t.fields[COLS.NGUOI_THUC_HIEN];
    return !assignee || !Array.isArray(assignee) || assignee.length === 0;
  });
}

// ─── Lấy danh sách team từ DS TEAM ──────────────────────────────
async function getTeamList() {
  return getRecords(config.TABLE.DS_TEAM);
}

// ─── Lấy role của user theo open_id ─────────────────────────────
async function getUserRole(openId) {
  const teamList = await getTeamList();
  const { TEAM_COLS } = config;
  const roles = [];

  for (const row of teamList) {
    for (const role of ['ADMIN', 'SALE', 'EDITOR', 'DESIGNER']) {
      const col = TEAM_COLS[role];
      const val = row.fields[col];
      if (!val || !Array.isArray(val)) continue;
      if (val.some(u => u.id === openId || u.open_id === openId)) {
        if (role === 'ADMIN') roles.push('admin');
        else if (role === 'SALE') roles.push('sale');
        else roles.push('media');
      }
    }
  }

  return [...new Set(roles)];
}

// ─── Lấy danh sách editor + designer (để gán task) ──────────────
async function getMediaMembers() {
  const teamList = await getTeamList();
  const { TEAM_COLS } = config;
  const members = [];

  for (const row of teamList) {
    for (const col of [TEAM_COLS.EDITOR, TEAM_COLS.DESIGNER]) {
      const val = row.fields[col];
      if (!val || !Array.isArray(val)) continue;
      for (const u of val) {
        if (u.id && !members.find(m => m.id === u.id)) {
          members.push({ id: u.id, name: u.name || u.id });
        }
      }
    }
  }

  return members;
}

// ─── Lấy workload từng nhân viên media ──────────────────────────
async function getWorkload() {
  const tasks = await getAllTasks();
  const members = await getMediaMembers();
  const { STATUS, COLS } = config;
  const activeStatuses = [STATUS.DANG_CHO, STATUS.DANG_LAM, STATUS.CHO_CHECK];

  const workload = {};
  for (const m of members) {
    workload[m.id] = { name: m.name, dang_cho: 0, dang_lam: 0, cho_check: 0, total: 0 };
  }

  for (const t of tasks) {
    const nguoiThucHien = t.fields[COLS.NGUOI_THUC_HIEN];
    const status = formatText(t.fields[COLS.TRANG_THAI]);
    if (!nguoiThucHien || !Array.isArray(nguoiThucHien)) continue;
    if (!activeStatuses.includes(status)) continue;

    for (const u of nguoiThucHien) {
      if (workload[u.id]) {
        workload[u.id].total++;
        if (status === STATUS.DANG_CHO) workload[u.id].dang_cho++;
        else if (status === STATUS.DANG_LAM) workload[u.id].dang_lam++;
        else if (status === STATUS.CHO_CHECK) workload[u.id].cho_check++;
      }
    }
  }

  return Object.values(workload);
}

module.exports = {
  getRecords, getRecord, updateRecord, createRecord,
  getAllTasks, getMyTasks, getTasksBySale, getPendingTasks,
  getTeamList, getUserRole, getMediaMembers, getWorkload
};
