require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const { handleWebhook } = require('./webhook');
const { handleCallback } = require('./callback');
const { startScheduler } = require('./scheduler');
const apiRouter = require('./api');

const app = express();
app.use(express.json());
app.use('/api', cors({ origin: process.env.MINI_PROGRAM_ORIGIN || true }), apiRouter);
app.use('/app', express.static(path.join(__dirname, 'webapp/public')));

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
