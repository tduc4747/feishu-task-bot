const axios = require('axios');

const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;

// ─── Lấy tenant access token (cached, token sống ~2h) ───────────
let cachedToken = null;
let tokenExpiresAt = 0;

async function getTenantToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: FEISHU_APP_ID,
    app_secret: FEISHU_APP_SECRET
  });
  cachedToken = res.data.tenant_access_token;
  // Trừ hao 5 phút để tránh dùng token sát hạn
  tokenExpiresAt = Date.now() + (res.data.expire - 300) * 1000;
  return cachedToken;
}

// ─── Gửi tin nhắn text (DM) ─────────────────────────────────────
async function sendDM(userId, text) {
  const token = await getTenantToken();
  await axios.post(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
    {
      receive_id: userId,
      msg_type: 'text',
      content: JSON.stringify({ text })
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

// ─── Gửi card (DM) ──────────────────────────────────────────────
async function sendCard(userId, card) {
  const token = await getTenantToken();
  await axios.post(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id',
    {
      receive_id: userId,
      msg_type: 'interactive',
      content: JSON.stringify(card)
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

// ─── Update card đã gửi (realtime) ──────────────────────────────
async function updateCard(messageId, card) {
  const token = await getTenantToken();
  try {
    await axios.patch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`,
      {
        msg_type: 'interactive',
        content: JSON.stringify(card)
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('updateCard error:', err.response?.status, err.response?.data);
  }
}

// ─── Format tên người dùng từ Bitable ───────────────────────────
function formatUser(val) {
  if (!val) return 'N/A';
  if (Array.isArray(val)) {
    return val.map(u => `@${u.name || u.id}`).join(', ');
  }
  if (typeof val === 'object' && val.name) return `@${val.name}`;
  return String(val);
}

// ─── Format giá trị text thông thường từ Bitable ────────────────
function formatText(val) {
  if (!val) return 'N/A';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    if (val[0]?.text) return val.map(v => v.text).join(', ');
    if (val[0]?.name) return val.map(v => v.name).join(', ');
  }
  if (typeof val === 'object') {
    if (val.text) return val.text;
    if (val.name) return val.name;
  }
  return String(val);
}

// ─── Format ngày từ timestamp Bitable ───────────────────────────
function formatDate(val) {
  if (!val) return 'N/A';
  const ts = typeof val === 'number' ? val : parseInt(val);
  if (isNaN(ts) || ts < 0) return 'N/A';
  const d = new Date(ts);
  return `${d.getDate().toString().padStart(2,'0')}/${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getFullYear()}`;
}

module.exports = { getTenantToken, sendDM, sendCard, updateCard, formatUser, formatText, formatDate };
