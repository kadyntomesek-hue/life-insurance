// AES-256-GCM for secrets we must keep at rest (Plaid access tokens).
const crypto = require('crypto');

function key(secret) { return crypto.createHash('sha256').update('licrm-plaid:' + secret).digest(); }

function encrypt(secret, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(secret), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

function decrypt(secret, blob) {
  const [iv, tag, enc] = String(blob).split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(secret), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
