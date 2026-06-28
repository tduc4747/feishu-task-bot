// Wrapper gọi REST API backend (cùng origin, không cần BASE_URL) + OAuth login Feishu Web App
const FEISHU_APP_ID = 'cli_aaa0cf1a963a9bc0';

let sessionToken = localStorage.getItem('sessionToken') || null;

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function redirectToFeishuLogin() {
  const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname);
  window.location.href = `https://open.feishu.cn/open-apis/authen/v1/index?app_id=${FEISHU_APP_ID}&redirect_uri=${redirectUri}`;
}

async function loginWithCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return null;

  const data = await request('/api/auth/login', { method: 'POST', body: { code } });
  sessionToken = data.token;
  localStorage.setItem('sessionToken', sessionToken);
  window.history.replaceState({}, '', window.location.pathname);
  return data;
}

// Đảm bảo có session hợp lệ; nếu chưa có/đã hết hạn thì xử lý code từ URL hoặc redirect sang Feishu login
async function ensureLoggedIn() {
  if (sessionToken) {
    try {
      await request('/api/me');
      return;
    } catch (err) {
      sessionToken = null;
      localStorage.removeItem('sessionToken');
    }
  }
  const fromRedirect = await loginWithCodeFromUrl();
  if (fromRedirect) return;
  redirectToFeishuLogin();
  throw new Error('redirecting');
}

window.Api = {
  ensureLoggedIn,
  getMe: () => request('/api/me'),
  getTeamMembers: () => request('/api/team-members'),
  getMyTasks: () => request('/api/tasks/mine'),
  getSentTasks: () => request('/api/tasks/sent'),
  getPendingTasks: () => request('/api/tasks/pending'),
  getWorkload: () => request('/api/tasks/workload'),
  getTasksByMedia: (id) => request(`/api/tasks/by-media/${id}`),
  getCompletedTasks: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/tasks/completed${qs ? '?' + qs : ''}`);
  },
  createTask: (body) => request('/api/tasks', { method: 'POST', body }),
  updateTask: (id, body) => request(`/api/tasks/${id}`, { method: 'PATCH', body }),
  deleteTask: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  assignTask: (id, assigneeId) => request(`/api/tasks/${id}/assign`, { method: 'POST', body: { assigneeId } }),
  startTask: (id) => request(`/api/tasks/${id}/start`, { method: 'POST' }),
  updateStatus: (id, status) => request(`/api/tasks/${id}/status`, { method: 'PATCH', body: { status } }),
  pendingCheck: (id) => request(`/api/tasks/${id}/pending-check`, { method: 'POST' }),
  completeTask: (id) => request(`/api/tasks/${id}/complete`, { method: 'POST' }),
  getUsers: () => request('/api/users'),
  syncContacts: () => request('/api/contacts/sync'),
  createUser: (body) => request('/api/users', { method: 'POST', body }),
  updateUser: (openId, body) => request(`/api/users/${openId}`, { method: 'PATCH', body }),
  deleteUser: (openId) => request(`/api/users/${openId}`, { method: 'DELETE' }),
  getMessageTemplates: () => request('/api/message-templates'),
  createMessageTemplate: (body) => request('/api/message-templates', { method: 'POST', body }),
  updateMessageTemplate: (key, body) => request(`/api/message-templates/${key}`, { method: 'PATCH', body }),
  deleteMessageTemplate: (key) => request(`/api/message-templates/${key}`, { method: 'DELETE' }),
  getSettings: () => request('/api/settings'),
  updateSettings: (body) => request('/api/settings', { method: 'PUT', body }),
  listUploads: () => request('/api/uploads'),
  deleteUploads: (filenames) => request('/api/uploads/delete-batch', { method: 'POST', body: { filenames } }),
  uploadFile: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/uploads', {
      method: 'POST',
      headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload thất bại');
    return data;
  },
};
