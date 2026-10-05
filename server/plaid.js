// Plaid integration (optional). Set PLAID_CLIENT_ID, PLAID_SECRET and PLAID_ENV in .env to enable it.
let client = null;

function configured() { return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET); }
function env() { return (process.env.PLAID_ENV || 'sandbox').toLowerCase(); }

function getClient() {
  if (!configured()) throw Object.assign(new Error('Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to .env'), { status: 400 });
  if (client) return client;
  const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
  const cfg = new Configuration({
    basePath: PlaidEnvironments[env()] || PlaidEnvironments.sandbox,
    baseOptions: { headers: { 'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID, 'PLAID-SECRET': process.env.PLAID_SECRET } }
  });
  client = new PlaidApi(cfg);
  return client;
}

async function createLinkToken(userId) {
  const r = await getClient().linkTokenCreate({
    user: { client_user_id: String(userId) },
    client_name: 'Life Insurance CRM',
    products: ['transactions'],
    transactions: { days_requested: 365 },
    country_codes: [(process.env.PLAID_COUNTRY || 'US')],
    language: 'en',
    ...(process.env.PLAID_REDIRECT_URI ? { redirect_uri: process.env.PLAID_REDIRECT_URI } : {})
  });
  return r.data.link_token;
}

async function exchangePublicToken(publicToken) {
  const r = await getClient().itemPublicTokenExchange({ public_token: publicToken });
  return { accessToken: r.data.access_token, itemId: r.data.item_id };
}

async function getAccounts(accessToken) {
  const r = await getClient().accountsGet({ access_token: accessToken });
  return r.data.accounts.map(a => ({ id: a.account_id, name: a.name, mask: a.mask, type: a.subtype || a.type }));
}

/** Pull everything new since `cursor`. Returns {added:[{date,description,amount,account,source}], cursor}. */
async function syncTransactions(accessToken, cursor) {
  const added = [];
  let hasMore = true, next = cursor || undefined;
  while (hasMore) {
    const r = await getClient().transactionsSync({ access_token: accessToken, cursor: next, count: 500 });
    for (const t of r.data.added) {
      if (t.pending) continue;
      // Plaid: positive = money leaving the account. Our convention: positive = deposit.
      added.push({ date: t.date, description: t.merchant_name || t.name, amount: -t.amount, account: t.account_id, source: 'plaid', plaidId: t.transaction_id });
    }
    hasMore = r.data.has_more; next = r.data.next_cursor;
  }
  return { added, cursor: next };
}

async function removeItem(accessToken) {
  try { await getClient().itemRemove({ access_token: accessToken }); } catch (e) { /* already gone */ }
}

module.exports = { configured, env, createLinkToken, exchangePublicToken, getAccounts, syncTransactions, removeItem };
