// Bank transactions: normalization, de-duplication and carrier matching rules.
const crypto = require('crypto');

// Default rules: a regex tried against the bank description (case-insensitive) → carrier name used in the CRM.
const DEFAULT_RULES = [
  { pattern: 'AMERICO', carrier: 'Americo' },
  { pattern: 'MUTUAL OF OMAHA|UNITED OF OMAHA|MUT(UAL)? ?OF ?OMAHA|MUTUALOFOMAHA', carrier: 'Mutual of Omaha' },
  { pattern: 'TRANSAMERICA|TRANS ?AMERICA', carrier: 'Transamerica' },
  { pattern: 'FIDELITY LIFE|FIDELITY SECURITY|FIDELITYLIFE', carrier: 'Fidelity Life' },
  { pattern: 'COREBRIDGE|AMERICAN GENERAL|AMER(ICAN)? GEN(ERAL)?|\\bAGL\\b|\\bAIG\\b', carrier: 'Corebridge / AGL' },
  { pattern: 'AETNA|ACCENDO|CONTINENTAL LIFE|\\bCVS\\b', carrier: 'Aetna / Accendo' },
  { pattern: 'FORESTERS', carrier: 'Foresters' },
  { pattern: 'PROSPERITY|S\\.? ?USA LIFE|SUSA LIFE', carrier: 'Prosperity' },
  { pattern: 'AMERICAN.?AMICABLE|AMER.?AMICABLE|OCCIDENTAL LIFE|PIONEER AMERICAN|PIONEER SECURITY', carrier: 'American-Amicable' },
  { pattern: 'ETHOS', carrier: 'Ethos' },
  { pattern: 'NATIONAL LIFE|\\bNLG\\b|LIFE INS(URANCE)? CO(MPANY)? OF THE SOUTHWEST|\\bLSW\\b', carrier: 'National Life Group' }
];

function compile(rules) {
  return (rules || []).map(r => {
    try { return { re: new RegExp(r.pattern, 'i'), carrier: r.carrier }; } catch (e) { return null; }
  }).filter(Boolean);
}

function matchCarrier(description, rules) {
  const d = String(description || '');
  for (const r of compile(rules)) if (r.re.test(d)) return r.carrier;
  return '';
}

function txId(t) {
  return crypto.createHash('sha1').update([t.date, String(t.description).trim().toLowerCase(), Number(t.amount).toFixed(2), t.account || ''].join('|')).digest('hex').slice(0, 16);
}

function normalizeDate(s) {
  s = String(s || '').trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if ((m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/.exec(s))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  const d = new Date(s); return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

function normalizeAmount(v) {
  if (typeof v === 'number') return v;
  let s = String(v || '').trim().replace(/[$,\s]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : (neg ? -n : n);
}

/** rows: [{date, description, amount, account?}] with amount > 0 meaning money INTO your account. */
function normalizeRows(rows, source) {
  const out = [];
  for (const r of rows || []) {
    const date = normalizeDate(r.date), amount = normalizeAmount(r.amount), description = String(r.description || '').trim();
    if (!date || isNaN(amount) || !description) continue;
    const t = { date, description, amount: Math.round(amount * 100) / 100, account: r.account || '', source: source || 'csv' };
    t.id = txId(t);
    out.push(t);
  }
  return out;
}

/** Merge new transactions into existing list; returns {added, skipped}. Applies rules to new ones. */
function mergeTransactions(existing, incoming, rules) {
  const seen = new Set(existing.map(t => t.id));
  let added = 0, skipped = 0;
  for (const t of incoming) {
    if (seen.has(t.id)) { skipped++; continue; }
    seen.add(t.id);
    t.carrier = matchCarrier(t.description, rules);
    t.auto = !!t.carrier;
    t.importedAt = new Date().toISOString();
    existing.push(t); added++;
  }
  return { added, skipped };
}

function rematch(transactions, rules) {
  let changed = 0;
  for (const t of transactions) {
    if (t.manual) continue;
    const c = matchCarrier(t.description, rules);
    if (c !== (t.carrier || '')) { t.carrier = c; t.auto = !!c; changed++; }
  }
  return changed;
}

module.exports = { DEFAULT_RULES, matchCarrier, normalizeRows, mergeTransactions, rematch, normalizeDate, normalizeAmount, txId };
