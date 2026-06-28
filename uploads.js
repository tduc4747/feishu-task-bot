// ─── Lưu file đính kèm task lên Railway Volume (mount tại UPLOAD_DIR) ───
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads-local');

function ensureDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Tên file ngẫu nhiên (không đoán được) + giữ phần mở rộng gốc để mở file đúng định dạng.
function saveBuffer(buffer, originalName) {
  ensureDir();
  const ext = path.extname(originalName || '').slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return filename;
}

function publicUrl(filename) {
  return `${config.PUBLIC_ORIGIN}/uploads/${filename}`;
}

function listFiles() {
  ensureDir();
  return fs.readdirSync(UPLOAD_DIR).map(name => {
    const stat = fs.statSync(path.join(UPLOAD_DIR, name));
    return { name, size: stat.size, mtime: stat.mtime, url: publicUrl(name) };
  });
}

function deleteFile(filename) {
  // Chặn path traversal — chỉ cho phép tên file nằm thẳng trong UPLOAD_DIR.
  if (!filename || filename.includes('/') || filename.includes('..')) throw new Error('Tên file không hợp lệ');
  const full = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

module.exports = { UPLOAD_DIR, ensureDir, saveBuffer, publicUrl, listFiles, deleteFile };
