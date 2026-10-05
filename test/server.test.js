// Smoke test for the server: setup → login → data → bank import → ledger → logout.
// Run: npm test
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'licrm-test-'));
process.env.PORT = '0';
const app = require('../server/index.js');

let cookie = '';
async function call(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  if (sc.length) cookie = sc.map(s => s.split(';')[0]).join('; ');
  let json = null; try { json = await r.clone().json(); } catch (e) { /* html */ }
  return { status: r.status, json, text: json ? null : await r.text(), location: r.headers.get('location') };
}
let base;
const srv = app.listen(0, async () => {
  base = 'http://127.0.0.1:' + srv.address().port;
  try {
    let r = await call('GET', '/api/auth/status'); assert.equal(r.json.setupNeeded, true, 'fresh install needs setup');
    r = await call('GET', '/'); assert.equal(r.status, 302, 'index redirects to login when signed out'); assert.equal(r.location, '/login');
    r = await call('GET', '/api/data'); assert.equal(r.status, 401);
    r = await call('POST', '/api/auth/setup', { username: 'kadyn', password: 'short' }); assert.equal(r.status, 400, 'rejects short password');
    r = await call('POST', '/api/auth/setup', { username: 'kadyn', password: 'correct horse battery' }); assert.equal(r.status, 200);
    r = await call('POST', '/api/auth/setup', { username: 'other', password: 'correct horse battery' }); assert.equal(r.status, 403, 'second account refused');
    r = await call('GET', '/api/me'); assert.equal(r.json.username, 'kadyn');
    r = await call('GET', '/'); assert.equal(r.status, 200); assert.ok(r.text.includes('Quote Cheat Sheet'));
    r = await call('GET', '/js/guides-data.js'); assert.equal(r.status, 200, 'guide data served when signed in');
    // data round trip
    r = await call('GET', '/api/data'); assert.deepEqual(r.json.clients, []);
    const d = r.json; d.clients.push({ id: 'c1', first: 'Jane', last: 'Doe', status: 'Client' }); d.payments = [];
    r = await call('PUT', '/api/data', d); assert.equal(r.status, 200);
    r = await call('GET', '/api/data'); assert.equal(r.json.clients[0].first, 'Jane');
    r = await call('PUT', '/api/data', { clients: 'nope' }); assert.equal(r.status, 400, 'validates shape');
    // bank import + matching
    r = await call('POST', '/api/bank/import', { rows: [
      { date: '09/28/2026', description: 'ACH DEPOSIT MUTUAL OF OMAHA COMM 123', amount: '832.50' },
      { date: '2026-09-30', description: 'AMERICO FIN LIFE ACH', amount: '$1,204.10' },
      { date: '2026-10-01', description: 'STARBUCKS', amount: '(5.25)' },
      { date: '2026-10-01', description: 'ZELLE FROM BOB', amount: '100' },
      { date: 'garbage', description: 'x', amount: '1' }
    ] });
    assert.equal(r.json.added, 4); assert.equal(r.json.invalid, 1);
    const tx = r.json.bank.transactions;
    assert.equal(tx.find(t => /OMAHA/.test(t.description)).carrier, 'Mutual of Omaha');
    assert.equal(tx.find(t => /AMERICO/.test(t.description)).carrier, 'Americo');
    assert.equal(tx.find(t => /STARBUCKS/.test(t.description)).amount, -5.25);
    assert.equal(tx.find(t => /ZELLE/.test(t.description)).carrier, '');
    r = await call('POST', '/api/bank/import', { rows: [{ date: '09/28/2026', description: 'ACH DEPOSIT MUTUAL OF OMAHA COMM 123', amount: '832.50' }] });
    assert.equal(r.json.added, 0); assert.equal(r.json.skipped, 1, 'duplicates skipped');
    // manual carrier + rule
    const z = tx.find(t => /ZELLE/.test(t.description));
    r = await call('POST', '/api/bank/transactions/' + z.id, { carrier: 'Ethos' }); assert.equal(r.json.transaction.manual, true);
    r = await call('PUT', '/api/bank/rules', { rules: [{ pattern: '[', carrier: 'Ethos' }] }); assert.equal(r.status, 400, 'bad regex rejected');
    // ledger
    const ids = r.json && r.json.bank ? [] : tx.filter(t => t.amount > 0 && t.carrier).map(t => t.id);
    r = await call('POST', '/api/bank/ledger', { ids: ids.concat([z.id]) });
    assert.equal(r.json.added, 3);
    assert.equal(r.json.data.payments.length, 3);
    assert.equal(r.json.data.payments.find(p => p.carrier === 'Mutual of Omaha').amount, 832.5);
    r = await call('POST', '/api/bank/ledger', { ids: ids }); assert.equal(r.json.added, 0, 'not ledgered twice');
    r = await call('GET', '/api/data'); assert.equal(r.json.payments.length, 3);
    // plaid not configured
    r = await call('POST', '/api/plaid/link-token'); assert.equal(r.status, 400); assert.ok(/not configured/.test(r.json.error));
    // password change + logout + lockout
    r = await call('POST', '/api/auth/password', { current: 'wrong', next: 'another long password' }); assert.equal(r.status, 400);
    r = await call('POST', '/api/auth/password', { current: 'correct horse battery', next: 'another long password' }); assert.equal(r.status, 200);
    r = await call('POST', '/api/auth/logout'); cookie = '';
    r = await call('GET', '/api/data'); assert.equal(r.status, 401, 'logged out');
    r = await call('POST', '/api/auth/login', { username: 'KADYN', password: 'another long password' }); assert.equal(r.status, 200, 'login with new password, case-insensitive user');
    cookie = '';
    for (let i = 0; i < 5; i++) r = await call('POST', '/api/auth/login', { username: 'kadyn', password: 'bad' });
    r = await call('POST', '/api/auth/login', { username: 'kadyn', password: 'another long password' }); assert.equal(r.status, 429, 'locked out after 5 failures');
    console.log('server tests passed');
    srv.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  } catch (e) { console.error('TEST FAILED', e); srv.close(); process.exit(1); }
});
