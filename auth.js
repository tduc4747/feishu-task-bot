// ─── Đăng nhập Feishu Web App (OAuth chuẩn) + session JWT cho REST API ───
const axios = require('axios');
const jwt = require('jsonwebtoken');
const db = require('./db');

const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;
const JWT_SECRET = process.env.SESSION_JWT_SECRET;
const JWT_EXPIRES_IN = '7d';

if (!JWT_SECRET) {
  console.warn('⚠️ SESSION_JWT_SECRET chưa được set trong .env — Mini Program API sẽ không an toàn.');
}

// ─── App access token (khác tenant_access_token), cần cho đổi code OAuth ───
let cachedAppToken = null;
let appTokenExpiresAt = 0;

async function getAppAccessToken() {
  if (cachedAppToken && Date.now() < appTokenExpiresAt) return cachedAppToken;

  const res = await axios.post('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
    app_id: FEISHU_APP_ID,
    app_secret: FEISHU_APP_SECRET,
  });
  cachedAppToken = res.data.app_access_token;
  appTokenExpiresAt = Date.now() + (res.data.expire - 300) * 1000;
  return cachedAppToken;
}

// ─── Đổi code (từ redirect OAuth của Web App) -> open_id ───
// Flow: trang web redirect user tới https://open.feishu.cn/open-apis/authen/v1/index?app_id=...&redirect_uri=...
// Feishu redirect lại kèm ?code=xxx, frontend gửi code này cho /api/auth/login.
async function exchangeCodeForOpenId(code) {
  const token = await getAppAccessToken();
  const res = await axios.post(
    'https://open.feishu.cn/open-apis/authen/v1/access_token',
    { grant_type: 'authorization_code', code },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const openId = res.data.data?.open_id;
  if (!openId) throw new Error('Không lấy được open_id từ Feishu: ' + JSON.stringify(res.data));
  return { openId, name: res.data.data?.name };
}

function issueSessionToken(openId) {
  return jwt.sign({ openId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifySessionToken(token) {
  return jwt.verify(token, JWT_SECRET).openId;
}

// ─── Middleware: xác thực JWT, gắn req.openId ───
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Thiếu token đăng nhập' });

  try {
    req.openId = verifySessionToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}

// ─── Middleware: yêu cầu một trong các role được chỉ định ───
function requireRole(...allowedRoles) {
  return async (req, res, next) => {
    const roles = await db.getUserRole(req.openId);
    if (!roles.some(r => allowedRoles.includes(r))) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng này' });
    }
    req.roles = roles;
    next();
  };
}

module.exports = { exchangeCodeForOpenId, issueSessionToken, verifySessionToken, requireAuth, requireRole };
