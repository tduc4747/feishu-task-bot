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
