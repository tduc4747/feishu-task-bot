// ─── Đọc danh bạ tổ chức từ Feishu Contact API (cần quyền contact:user.base:readonly
// và contact:department.base:readonly đã được cấp trong Feishu Developer Console) ───
const axios = require('axios');
const { getTenantToken } = require('./helpers');

// Feishu trả HTTP 200 kèm body.code khác 0 khi lỗi logic (thiếu quyền, sai param...).
// Khi tham số sai hẳn (vd department_id_type không hợp lệ), Feishu trả luôn HTTP 4xx —
// axios throw thẳng, nên bọc lại để lấy đúng message gốc từ Feishu thay vì "status code 400".
async function callFeishu(url, params) {
  const token = await getTenantToken();
  try {
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` }, params });
    if (res.data.code !== 0) throw new Error(res.data.msg || `Lỗi API Feishu (code ${res.data.code})`);
    return res.data.data;
  } catch (err) {
    const feishuMsg = err.response?.data?.msg;
    throw new Error(feishuMsg ? `Feishu: ${feishuMsg}` : err.message);
  }
}

// Dùng department_id_type=department_id (ID nội bộ của Feishu) vì department_id "0"
// (gốc tổ chức) chỉ hợp lệ với type này — dùng open_department_id cho "0" sẽ bị HTTP 400.
async function listChildDepartments(parentId) {
  const out = [];
  let pageToken;
  do {
    const data = await callFeishu('https://open.feishu.cn/open-apis/contact/v3/departments', {
      parent_department_id: parentId, department_id_type: 'department_id', page_size: 50, page_token: pageToken,
    });
    out.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  return out;
}

async function listDepartmentUsers(departmentId) {
  const out = [];
  let pageToken;
  do {
    const data = await callFeishu('https://open.feishu.cn/open-apis/contact/v3/users/find_by_department', {
      department_id: departmentId, department_id_type: 'department_id',
      user_id_type: 'open_id', page_size: 50, page_token: pageToken,
    });
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
      await walk(c.department_id);
    }
  }

  await walk('0');
  return [...seen.values()];
}

module.exports = { listAllOrgMembers };
