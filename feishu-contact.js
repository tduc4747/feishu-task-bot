// ─── Đọc danh bạ tổ chức từ Feishu Contact API (cần quyền contact:user.base:readonly
// và contact:department.base:readonly đã được cấp trong Feishu Developer Console) ───
const axios = require('axios');
const { getTenantToken } = require('./helpers');

// Feishu trả HTTP 200 kèm body.code khác 0 khi lỗi logic (thiếu quyền, sai param...).
function unwrap(res) {
  if (res.data.code !== 0) {
    throw new Error(res.data.msg || `Lỗi API Feishu (code ${res.data.code})`);
  }
  return res.data.data;
}

async function listChildDepartments(parentId) {
  const token = await getTenantToken();
  const out = [];
  let pageToken;
  do {
    const res = await axios.get('https://open.feishu.cn/open-apis/contact/v3/departments', {
      headers: { Authorization: `Bearer ${token}` },
      params: { parent_department_id: parentId, department_id_type: 'open_department_id', page_size: 50, page_token: pageToken },
    });
    const data = unwrap(res);
    out.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  return out;
}

async function listDepartmentUsers(departmentId) {
  const token = await getTenantToken();
  const out = [];
  let pageToken;
  do {
    const res = await axios.get('https://open.feishu.cn/open-apis/contact/v3/users/find_by_department', {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        department_id: departmentId, department_id_type: 'open_department_id',
        user_id_type: 'open_id', page_size: 50, page_token: pageToken,
      },
    });
    const data = unwrap(res);
    out.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  return out;
}

// Duyệt toàn bộ cây phòng ban từ gốc ("0"), gom tất cả nhân viên (loại trùng theo open_id).
async function listAllOrgMembers() {
  const seen = new Map();

  async function walk(departmentId) {
    const [users, children] = await Promise.all([
      listDepartmentUsers(departmentId),
      listChildDepartments(departmentId),
    ]);
    for (const u of users) {
      if (u.open_id) seen.set(u.open_id, { openId: u.open_id, name: u.name || u.en_name || u.open_id });
    }
    for (const c of children) {
      await walk(c.open_department_id || c.department_id);
    }
  }

  await walk('0');
  return [...seen.values()];
}

module.exports = { listAllOrgMembers };
