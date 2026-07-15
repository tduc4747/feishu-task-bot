// ─── Dịch máy Việt -> Trung cho người xem TQ, có cache để tiết kiệm ───
// Thứ tự: (1) bản dịch cố định do người đặt sẵn -> (2) cache trong DB (bảng translations)
// -> (3) gọi Google Translate cho phần còn lại rồi LƯU vào cache. Mỗi câu chỉ gọi API 1 lần.
// Lỗi API hoặc thiếu key -> giữ nguyên bản gốc tiếng Việt (không làm vỡ bảng).
const axios = require('axios');
const db = require('./db');

const KEY = process.env.GOOGLE_TRANSLATE_API_KEY;

// Nhãn cố định — đặt tay cho đúng, không để máy đoán sai (vd "Hoàn thành" bị dịch thành "完全的").
// Chủ yếu là các giá trị trạng thái; frontend cũng có map riêng cho nhãn giao diện.
const FIXED = {
  zh: {
    'Chờ gán người thực hiện': '待分配处理人',
    'Đang chờ': '等待中',
    'Đang làm': '进行中',
    'Chờ check': '待检查',
    'Hoàn thành': '已完成',
  },
};

async function googleTranslate(texts, gTarget) {
  const res = await axios.post(
    'https://translation.googleapis.com/language/translate/v2?key=' + KEY,
    { q: texts, source: 'vi', target: gTarget, format: 'text' },
    { timeout: 15000 }
  );
  return res.data.data.translations.map(t => t.translatedText);
}

// texts: mảng chuỗi tiếng Việt (có thể trùng/null). Trả về object { [gốc]: [đã dịch] }.
async function translateMany(texts, target = 'zh') {
  const uniq = [...new Set((texts || []).filter(t => typeof t === 'string' && t.trim()))];
  const result = {};
  if (uniq.length === 0) return result;

  const fixed = FIXED[target] || {};
  const needCache = [];
  for (const t of uniq) {
    if (fixed[t]) result[t] = fixed[t];
    else needCache.push(t);
  }

  // (2) cache DB
  const cached = await db.getTranslations(needCache, target);
  const needApi = [];
  for (const t of needCache) {
    if (cached[t] != null) result[t] = cached[t];
    else needApi.push(t);
  }

  // (3) Google cho phần chưa có, rồi lưu cache
  if (needApi.length) {
    if (!KEY) {
      needApi.forEach(t => { result[t] = t; }); // không cấu hình key -> giữ nguyên
      return result;
    }
    const gTarget = target === 'zh' ? 'zh-CN' : target;
    // Google giới hạn 128 đoạn / request (và giới hạn ký tự) -> chia lô, dịch từng lô,
    // cache riêng từng lô. 1 lô lỗi thì chỉ phần đó giữ tiếng Việt, không kéo hỏng cả bảng.
    for (const batch of chunkTexts(needApi)) {
      try {
        const out = await googleTranslate(batch, gTarget);
        const toStore = [];
        batch.forEach((t, i) => {
          result[t] = out[i] != null ? out[i] : t;
          if (out[i] != null) toStore.push({ source: t, translated: out[i] });
        });
        if (toStore.length) await db.saveTranslations(toStore, target);
      } catch (e) {
        console.error('Google Translate lỗi (giữ nguyên bản gốc):', e.response?.data?.error?.message || e.message);
        batch.forEach(t => { if (result[t] == null) result[t] = t; });
      }
    }
  }
  return result;
}

// Chia danh sách chuỗi thành các lô đủ nhỏ cho Google (≤ maxCount đoạn và ≤ maxChars ký tự/lô).
function chunkTexts(texts, maxCount = 100, maxChars = 25000) {
  const chunks = [];
  let cur = [];
  let chars = 0;
  for (const t of texts) {
    if (cur.length && (cur.length >= maxCount || chars + t.length > maxChars)) {
      chunks.push(cur); cur = []; chars = 0;
    }
    cur.push(t); chars += t.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

module.exports = { translateMany, FIXED };
