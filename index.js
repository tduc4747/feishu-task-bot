require('dotenv').config();
const express = require('express');
const db = require('./db');
const { handleWebhook } = require('./webhook');
const { handleCallback } = require('./callback');
const { startScheduler } = require('./scheduler');

const app = express();
app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────
app.post('/webhook', handleWebhook);
app.post('/callback', handleCallback);
app.get('/', (req, res) => res.json({ status: 'ok', message: 'Feishu Task Bot running' }));

// ─── Route tạm để chạy migrate-seed 1 lần qua trình duyệt ───────
// Xoá route này (và biến MIGRATE_KEY) sau khi đã migrate xong.
app.get('/admin/migrate-seed', async (req, res) => {
  if (!process.env.MIGRATE_KEY || req.query.key !== process.env.MIGRATE_KEY) {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const { runMigration } = require('./migrate-seed');
    const result = await runMigration();
    res.json({ status: 'ok', result });
  } catch (err) {
    console.error('Migrate qua route lỗi:', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;

db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Bot running on port ${PORT}`);
      startScheduler();
    });
  })
  .catch(err => {
    console.error('Không khởi tạo được database:', err.message);
    process.exit(1);
  });
