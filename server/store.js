// Tiny JSON file store. One agent, small data: a file per collection with atomic writes is plenty.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

function ensureDir() { fs.mkdirSync(DATA_DIR, { recursive: true }); }
function file(name) { return path.join(DATA_DIR, name + '.json'); }

function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error('store read', name, e.message); return typeof fallback === 'function' ? fallback() : fallback; }
}

function write(name, value) {
  ensureDir();
  const tmp = file(name) + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file(name));
}

// A secret that survives restarts, generated once if SESSION_SECRET is not set.
function getOrCreateSecret() {
  ensureDir();
  const p = path.join(DATA_DIR, 'secret.key');
  try { return fs.readFileSync(p, 'utf8').trim(); } catch (e) { /* create */ }
  const s = crypto.randomBytes(48).toString('base64');
  fs.writeFileSync(p, s, { mode: 0o600 });
  return s;
}

module.exports = { read, write, getOrCreateSecret, DATA_DIR };
