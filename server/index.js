// Life Insurance CRM server: single-owner login, server-side data, bank deposit tracking.
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./store');
const bank = require('./bank');
const plaid = require('./plaid');
const { encrypt, decrypt } = require('./crypto');

// --- .env loader (no dependency) ---
(function loadEnv() {
  try {
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* no .env */ }
})();

const PORT = Number(process.env.PORT) || 3000;
const SECRET = process.env.SESSION_SECRET || store.getOrCreateSecret();
const ROOT = path.join(__dirname, '..');
const SESSION_HOURS = Number(process.env.SESSION_HOURS) || 12;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '15mb' }));
app.use(cookieSession({ name: 'licrm', keys: [SECRET], maxAge: SESSION_HOURS * 3600 * 1000, sameSite: 'lax', httpOnly: true, secure: COOKIE_SECURE }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  res.set('Cache-Control', 'no-store');
  next();
});

// --- data helpers ---
function defaultCrm() { return { clients: [], policies: [], payments: [], activity: [], settings: { agentName: '', rates: { 'Term Life': 80, 'IUL': 90, 'Whole Life': 100 }, advance: 75, theme: 'auto' } }; }
function defaultBank() { return { rules: bank.DEFAULT_RULES.slice(), transactions: [], items: [] }; }
const users = () => store.read('users', []);
const crm = () => Object.assign(defaultCrm(), store.read('crm', {}));
const bankDb = () => Object.assign(defaultBank(), store.read('bank', {}));
const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

// --- auth ---
const attempts = new Map(); // ip -> {n, until}
function loginLimiter(req, res, next) {
  const a = attempts.get(req.ip);
  if (a && a.until > Date.now()) return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil((a.until - Date.now()) / 60000)} min.` });
  next();
}
function noteFailure(ip) { const a = attempts.get(ip) || { n: 0, until: 0 }; a.n++; if (a.n >= 5) { a.until = Date.now() + 15 * 60000; a.n = 0; } attempts.set(ip, a); }
function requireAuth(req, res, next) {
  if (req.session && req.session.uid && users().some(u => u.id === req.session.uid)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Please sign in' });
  res.redirect('/login');
}

app.get('/api/auth/status', (req, res) => {
  const u = users();
  res.json({ setupNeeded: u.length === 0, loggedIn: !!(req.session && req.session.uid && u.some(x => x.id === req.session.uid)), username: u.find(x => req.session && x.id === req.session.uid)?.username || null });
});
app.post('/api/auth/setup', (req, res) => {
  if (users().length) return res.status(403).json({ error: 'An account already exists. Sign in instead.' });
  const { username, password } = req.body || {};
  if (!username || String(username).trim().length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (!password || String(password).length < 10) return res.status(400).json({ error: 'Password must be at least 10 characters' });
  const u = { id: uid(), username: String(username).trim(), hash: bcrypt.hashSync(String(password), 12), createdAt: new Date().toISOString() };
  store.write('users', [u]);
  req.session.uid = u.id;
  res.json({ ok: true, username: u.username });
});
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const u = users().find(x => x.username.toLowerCase() === String(username || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.hash)) { noteFailure(req.ip); return res.status(401).json({ error: 'Wrong username or password' }); }
  attempts.delete(req.ip);
  req.session = { uid: u.id, at: Date.now() };
  res.json({ ok: true, username: u.username });
});
app.post('/api/auth/logout', (req, res) => { req.session = null; res.json({ ok: true }); });
app.post('/api/auth/password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  const list = users(); const u = list.find(x => x.id === req.session.uid);
  if (!bcrypt.compareSync(String(current || ''), u.hash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (!next || String(next).length < 10) return res.status(400).json({ error: 'New password must be at least 10 characters' });
  u.hash = bcrypt.hashSync(String(next), 12); store.write('users', list);
  res.json({ ok: true });
});

// --- pages ---
app.get('/login', (req, res) => res.sendFile(path.join(ROOT, 'login.html')));
app.get(['/', '/index.html'], requireAuth, (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.use('/css', express.static(path.join(ROOT, 'css')));
app.use('/js', requireAuth, express.static(path.join(ROOT, 'js')));

// --- CRM data ---
app.get('/api/me', requireAuth, (req, res) => res.json({ server: true, username: users().find(x => x.id === req.session.uid).username, plaid: plaid.configured() }));
app.get('/api/data', requireAuth, (req, res) => res.json(crm()));
app.put('/api/data', requireAuth, (req, res) => {
  const d = req.body || {};
  for (const k of ['clients', 'policies', 'payments', 'activity']) if (!Array.isArray(d[k])) return res.status(400).json({ error: `${k} must be an array` });
  if (!d.settings || typeof d.settings !== 'object') return res.status(400).json({ error: 'settings missing' });
  const clean = { clients: d.clients, policies: d.policies, payments: d.payments, activity: d.activity.slice(0, 300), settings: d.settings, savedAt: new Date().toISOString() };
  store.write('crm', clean);
  res.json({ ok: true, savedAt: clean.savedAt });
});

// --- bank ---
function publicBank(b) {
  return {
    rules: b.rules,
    transactions: b.transactions.slice().sort((a, c) => (c.date || '').localeCompare(a.date || '') || (c.importedAt || '').localeCompare(a.importedAt || '')),
    plaid: { configured: plaid.configured(), env: plaid.env(), items: b.items.map(i => ({ id: i.id, institution: i.institution, accounts: i.accounts, lastSync: i.lastSync, error: i.error || null })) }
  };
}
app.get('/api/bank', requireAuth, (req, res) => res.json(publicBank(bankDb())));
app.put('/api/bank/rules', requireAuth, (req, res) => {
  const rules = (req.body.rules || []).filter(r => r && r.pattern && r.carrier).map(r => ({ pattern: String(r.pattern), carrier: String(r.carrier) }));
  for (const r of rules) { try { new RegExp(r.pattern, 'i'); } catch (e) { return res.status(400).json({ error: `Bad pattern: ${r.pattern}` }); } }
  const b = bankDb(); b.rules = rules; const changed = bank.rematch(b.transactions, b.rules); store.write('bank', b);
  res.json({ ok: true, rematched: changed, bank: publicBank(b) });
});
app.post('/api/bank/import', requireAuth, (req, res) => {
  const rows = bank.normalizeRows(req.body.rows, 'csv');
  const b = bankDb(); const r = bank.mergeTransactions(b.transactions, rows, b.rules); store.write('bank', b);
  res.json({ ok: true, added: r.added, skipped: r.skipped, invalid: (req.body.rows || []).length - rows.length, bank: publicBank(b) });
});
app.post('/api/bank/transactions/:id', requireAuth, (req, res) => {
  const b = bankDb(); const t = b.transactions.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if ('carrier' in req.body) { t.carrier = String(req.body.carrier || ''); t.manual = true; t.auto = false; }
  if ('ignored' in req.body) t.ignored = !!req.body.ignored;
  store.write('bank', b); res.json({ ok: true, transaction: t });
});
app.delete('/api/bank/transactions/:id', requireAuth, (req, res) => {
  const b = bankDb(); b.transactions = b.transactions.filter(x => x.id !== req.params.id); store.write('bank', b); res.json({ ok: true });
});
app.post('/api/bank/clear', requireAuth, (req, res) => {
  const b = bankDb(); const n = b.transactions.length; b.transactions = b.transactions.filter(t => t.paymentId); store.write('bank', b); res.json({ ok: true, removed: n - b.transactions.length });
});
// Turn bank deposits into ledger payments in the CRM.
app.post('/api/bank/ledger', requireAuth, (req, res) => {
  const ids = new Set(req.body.ids || []);
  const b = bankDb(), c = crm(); let added = 0;
  for (const t of b.transactions) {
    if (!ids.has(t.id) || t.paymentId || t.ignored) continue;
    const p = { id: uid(), date: t.date, amount: t.amount, type: t.amount < 0 ? 'Chargeback' : (req.body.type || 'Commission advance'), carrier: t.carrier || 'Other', policyId: '', note: 'Bank: ' + t.description, bankTxId: t.id };
    c.payments.push(p); t.paymentId = p.id; added++;
    c.activity.unshift({ t: new Date().toISOString(), text: `Logged ${p.amount < 0 ? '-' : ''}$${Math.abs(p.amount).toFixed(2)} ${p.type} from ${p.carrier} (bank import)` });
  }
  c.activity = c.activity.slice(0, 300);
  store.write('bank', b); store.write('crm', c);
  res.json({ ok: true, added, data: c, bank: publicBank(b) });
});

// --- plaid ---
const wrap = fn => (req, res) => fn(req, res).catch(e => { const msg = e.response?.data?.error_message || e.message; console.error('plaid', msg); res.status(e.status || 500).json({ error: msg }); });
app.get('/api/plaid/status', requireAuth, (req, res) => res.json({ configured: plaid.configured(), env: plaid.env() }));
app.post('/api/plaid/link-token', requireAuth, wrap(async (req, res) => res.json({ link_token: await plaid.createLinkToken(req.session.uid) })));
app.post('/api/plaid/exchange', requireAuth, wrap(async (req, res) => {
  const { accessToken, itemId } = await plaid.exchangePublicToken(req.body.public_token);
  const accounts = await plaid.getAccounts(accessToken);
  const b = bankDb();
  b.items.push({ id: itemId, institution: req.body.institution || 'Bank', token: encrypt(SECRET, accessToken), accounts, cursor: '', lastSync: null, addedAt: new Date().toISOString() });
  store.write('bank', b);
  res.json({ ok: true, bank: publicBank(b) });
}));
app.post('/api/plaid/sync', requireAuth, wrap(async (req, res) => {
  const b = bankDb(); let added = 0, skipped = 0;
  for (const item of b.items) {
    try {
      const r = await plaid.syncTransactions(decrypt(SECRET, item.token), item.cursor);
      const names = Object.fromEntries((item.accounts || []).map(a => [a.id, `${a.name} ••${a.mask || ''}`]));
      const rows = bank.normalizeRows(r.added.map(t => Object.assign({}, t, { account: names[t.account] || t.account })), 'plaid');
      const m = bank.mergeTransactions(b.transactions, rows, b.rules); added += m.added; skipped += m.skipped;
      item.cursor = r.cursor; item.lastSync = new Date().toISOString(); item.error = null;
    } catch (e) { item.error = e.response?.data?.error_message || e.message; }
  }
  store.write('bank', b);
  res.json({ ok: true, added, skipped, bank: publicBank(b) });
}));
app.delete('/api/plaid/items/:id', requireAuth, wrap(async (req, res) => {
  const b = bankDb(); const item = b.items.find(i => i.id === req.params.id);
  if (item) { await plaid.removeItem(decrypt(SECRET, item.token)); b.items = b.items.filter(i => i !== item); store.write('bank', b); }
  res.json({ ok: true, bank: publicBank(b) });
}));

app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message || 'Server error' }); });

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Life Insurance CRM running at http://localhost:${PORT}  (data in ${store.DATA_DIR}, Plaid ${plaid.configured() ? plaid.env() : 'not configured'})`);
    if (!users().length) console.log('No login yet — open the address above to create yours.');
  });
}
module.exports = app;
