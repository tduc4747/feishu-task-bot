// ─── Cài đặt báo cáo sáng: giờ/phút, ngày trong tuần, gửi cá nhân hay vào 1 group ───
const db = require('./db');

// morning_report_days: các thứ trong tuần được gửi, phân tách bằng dấu phẩy (0 = Chủ nhật .. 6 = Thứ 7)
const DEFAULTS = {
  morning_report_hour:          '8',
  morning_report_minute:        '0',
  morning_report_days:          '0,1,2,3,4,5,6',
  morning_report_target:        'individual', // individual | group
  morning_report_group_chat_id: '',
};

async function getAllSettings() {
  const res = await db.pool.query('SELECT key, value FROM settings');
  const out = { ...DEFAULTS };
  for (const row of res.rows) out[row.key] = row.value;
  return out;
}

async function setSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in DEFAULTS)) continue; // chỉ nhận đúng các khoá đã định nghĩa
    await db.pool.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, String(value ?? '')]
    );
  }
  return getAllSettings();
}

module.exports = { DEFAULTS, getAllSettings, setSettings };
