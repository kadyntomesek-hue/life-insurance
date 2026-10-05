/* Life Insurance CRM — single-file app, data lives in this browser's localStorage. */
(function () {
  'use strict';

  // ---------- constants ----------
  const STORE_KEY = 'lifecrm.v1';
  const CLIENT_STATUSES = ['Lead', 'Quoted', 'Applied', 'Client', 'Lost'];
  const POLICY_STATUSES = ['Submitted', 'Pending', 'Approved', 'Issued', 'Paid', 'Declined', 'Lapsed', 'Chargeback'];
  const PRODUCT_TYPES = ['Term Life', 'IUL', 'Whole Life'];
  const PAYMENT_TYPES = ['Commission advance', 'As-earned commission', 'Renewal', 'Bonus', 'Chargeback', 'Other'];
  const LEAD_SOURCES = ['Referral', 'Purchased lead', 'Facebook', 'Door knock', 'Mailer', 'Cold call', 'Walk-in', 'Other'];
  const US_STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
  const CARRIERS = ['Americo', 'Mutual of Omaha', 'Transamerica', 'Fidelity Life', 'Corebridge / AGL', 'Aetna / Accendo', 'Foresters', 'Prosperity', 'American-Amicable', 'Ethos', 'National Life Group', 'Other'];

  // Which carrier columns of each guide belong to each product button.
  const PRODUCT_VIEWS = {
    term: { guide: 'term', label: 'Term Life', cols: [0, 1, 3, 4, 5], blurb: 'Simplified-issue term carriers from the IUL & Term grid.' },
    iul: { guide: 'term', label: 'IUL', cols: [1, 2, 6, 7], blurb: 'Indexed universal life carriers from the IUL & Term grid.' },
    whole: { guide: 'whole', label: 'Whole Life', cols: [0, 1, 2, 3, 4, 5, 6, 7, 8], blurb: 'Final expense & whole life carriers.' }
  };
  const COLOR_LEGEND = [
    ['green', 'Level / Day-1 / Select / OK / Standard'], ['blue', 'Modified / Graded / ROP / Basic'], ['orange', 'GI Route / Guaranteed Issue'],
    ['yellow', 'Check Meds / See Condition'], ['purple', 'See Other Section (cross-ref)'], ['red', 'DECLINE / Ineligible']
  ];

  // ---------- state ----------
  let db = load();
  let ui = { clientSel: null, product: null, cheatSearch: '', showAllCols: false, moneyYear: new Date().getFullYear() };

  function defaults() {
    return {
      clients: [], policies: [], payments: [], activity: [],
      settings: { agentName: '', rates: { 'Term Life': 80, 'IUL': 90, 'Whole Life': 100 }, advance: 75, theme: 'auto' }
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { const d = JSON.parse(raw); return Object.assign(defaults(), d, { settings: Object.assign(defaults().settings, d.settings || {}) }); }
    } catch (e) { console.warn('load failed', e); }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { toast('Could not save (storage blocked?)'); }
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function logActivity(text) { db.activity.unshift({ t: new Date().toISOString(), text }); db.activity = db.activity.slice(0, 200); }

  // ---------- helpers ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function money(n) { n = Number(n) || 0; return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
  function money2(n) { n = Number(n) || 0; return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDate(s) { if (!s) return ''; const d = new Date(s + (s.length === 10 ? 'T00:00:00' : '')); return isNaN(d) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function ageFromDob(dob) { if (!dob) return ''; const d = new Date(dob + 'T00:00:00'), n = new Date(); let a = n.getFullYear() - d.getFullYear(); if (n < new Date(n.getFullYear(), d.getMonth(), d.getDate())) a--; return isNaN(a) ? '' : a; }
  function clientName(c) { return c ? [c.first, c.last].filter(Boolean).join(' ') || '(no name)' : '(deleted client)'; }
  function clientById(id) { return db.clients.find(c => c.id === id); }
  function policyById(id) { return db.policies.find(p => p.id === id); }
  function pill(s) { return `<span class="pill s-${esc(String(s).toLowerCase().replace(/[^a-z]/g, ''))}">${esc(s)}</span>`; }
  function opts(list, sel, blank) { return (blank ? `<option value="">${esc(blank)}</option>` : '') + list.map(v => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join(''); }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2200); }
  function annualPremium(p) { const m = { Monthly: 12, Quarterly: 4, 'Semi-annual': 2, Annual: 1 }[p.mode || 'Monthly'] || 12; return (Number(p.premium) || 0) * m; }
  function expectedTotal(p) { return annualPremium(p) * (Number(p.commRate) || 0) / 100; }
  function expectedAdvance(p) { return expectedTotal(p) * (Number(p.advance) || 0) / 100; }
  function receivedFor(policyId) { return db.payments.filter(x => x.policyId === policyId).reduce((s, x) => s + Number(x.amount || 0), 0); }
  function monthKey(s) { return (s || '').slice(0, 7); }

  // ---------- navigation ----------
  function showTab(name) {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    render(name);
    location.hash = name;
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) showTab(b.dataset.tab); });

  function render(name) {
    ({ dashboard: renderDashboard, clients: renderClients, policies: renderPolicies, money: renderMoney, cheatsheet: renderCheat }[name] || (() => {}))();
  }
  function renderAll() { const active = $('.tab.active').dataset.tab; render(active); }

  // ---------- modal ----------
  function openModal(title, bodyHtml, onMount) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = bodyHtml;
    $('#modal').hidden = false;
    if (onMount) onMount($('#modal-body'));
    const f = $('#modal-body input, #modal-body select'); if (f) f.focus();
  }
  function closeModal() { $('#modal').hidden = true; $('#modal-body').innerHTML = ''; }
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

  // ---------- client form ----------
  function clientForm(c) {
    c = c || {};
    return `
      <form id="client-form" class="form-grid">
        <div class="field"><label>First name</label><input name="first" value="${esc(c.first)}" required></div>
        <div class="field"><label>Last name</label><input name="last" value="${esc(c.last)}"></div>
        <div class="field"><label>Phone</label><input name="phone" value="${esc(c.phone)}" type="tel"></div>
        <div class="field"><label>Email</label><input name="email" value="${esc(c.email)}" type="email"></div>
        <div class="field"><label>Date of birth</label><input name="dob" value="${esc(c.dob)}" type="date"></div>
        <div class="field"><label>State</label><select name="state">${opts(US_STATES, c.state, '—')}</select></div>
        <div class="field"><label>Height (in)</label><input name="height" value="${esc(c.height)}" type="number" min="36" max="96" placeholder="e.g. 68"></div>
        <div class="field"><label>Weight (lb)</label><input name="weight" value="${esc(c.weight)}" type="number" min="50" max="700"></div>
        <div class="field"><label>Tobacco</label><select name="tobacco">${opts(['No', 'Yes'], c.tobacco || 'No')}</select></div>
        <div class="field"><label>Lead source</label><select name="source">${opts(LEAD_SOURCES, c.source, '—')}</select></div>
        <div class="field"><label>Status</label><select name="status">${opts(CLIENT_STATUSES, c.status || 'Lead')}</select></div>
        <div class="field"><label>Follow-up date</label><input name="followUp" value="${esc(c.followUp)}" type="date"></div>
        <div class="field full"><label>Health / medications (for quoting)</label><textarea name="health">${esc(c.health)}</textarea></div>
        <div class="field full"><label>Notes</label><textarea name="notes">${esc(c.notes)}</textarea></div>
        <div class="form-actions full">
          <div>${c.id ? '<button type="button" class="btn btn-ghost btn-danger" data-del>Delete client</button>' : ''}</div>
          <div class="right"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn btn-primary">Save</button></div>
        </div>
      </form>`;
  }
  function openClientForm(id, after) {
    const c = id ? clientById(id) : null;
    openModal(c ? 'Edit client' : 'New client', clientForm(c), body => {
      const form = $('#client-form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        if (c) { Object.assign(c, data); logActivity(`Updated client ${clientName(c)}`); }
        else { const n = Object.assign({ id: uid(), createdAt: today() }, data); db.clients.push(n); ui.clientSel = n.id; logActivity(`Added client ${clientName(n)}`); }
        save(); closeModal(); renderAll(); toast('Client saved'); if (after) after();
      });
      $('[data-cancel]', body).addEventListener('click', closeModal);
      const del = $('[data-del]', body);
      if (del) del.addEventListener('click', () => {
        if (!confirm(`Delete ${clientName(c)} and their ${db.policies.filter(p => p.clientId === c.id).length} policies? This cannot be undone.`)) return;
        db.policies = db.policies.filter(p => p.clientId !== c.id);
        db.clients = db.clients.filter(x => x.id !== c.id);
        if (ui.clientSel === c.id) ui.clientSel = null;
        logActivity(`Deleted client ${clientName(c)}`); save(); closeModal(); renderAll(); toast('Client deleted');
      });
    });
  }

  // ---------- policy form ----------
  function policyForm(p) {
    p = p || {};
    const rate = p.commRate != null ? p.commRate : (db.settings.rates[p.productType || 'Term Life'] || 0);
    const adv = p.advance != null ? p.advance : db.settings.advance;
    const clientOpts = db.clients.slice().sort((a, b) => clientName(a).localeCompare(clientName(b))).map(c => `<option value="${c.id}" ${c.id === p.clientId ? 'selected' : ''}>${esc(clientName(c))}</option>`).join('');
    return `
      <form id="policy-form" class="form-grid">
        <div class="field full"><label>Client</label><select name="clientId" required><option value="">Select a client…</option>${clientOpts}</select></div>
        <div class="field"><label>Product type</label><select name="productType">${opts(PRODUCT_TYPES, p.productType || 'Term Life')}</select></div>
        <div class="field"><label>Carrier</label><select name="carrier">${opts(CARRIERS, p.carrier || 'Americo')}</select></div>
        <div class="field"><label>Product / plan name</label><input name="product" value="${esc(p.product)}" placeholder="e.g. Eagle Select, FFIUL II"></div>
        <div class="field"><label>Policy #</label><input name="policyNo" value="${esc(p.policyNo)}"></div>
        <div class="field"><label>Face amount ($)</label><input name="face" value="${esc(p.face)}" type="number" min="0" step="1000"></div>
        <div class="field"><label>Premium ($)</label><input name="premium" value="${esc(p.premium)}" type="number" min="0" step="0.01" required></div>
        <div class="field"><label>Payment mode</label><select name="mode">${opts(['Monthly', 'Quarterly', 'Semi-annual', 'Annual'], p.mode || 'Monthly')}</select></div>
        <div class="field"><label>Status</label><select name="status">${opts(POLICY_STATUSES, p.status || 'Submitted')}</select></div>
        <div class="field"><label>Commission rate (% of annual premium)</label><input name="commRate" value="${esc(rate)}" type="number" min="0" max="200" step="0.5"></div>
        <div class="field"><label>Advance (% paid up front)</label><input name="advance" value="${esc(adv)}" type="number" min="0" max="100" step="1"></div>
        <div class="field"><label>Submitted</label><input name="submittedDate" value="${esc(p.submittedDate || today())}" type="date"></div>
        <div class="field"><label>Issued / effective</label><input name="issuedDate" value="${esc(p.issuedDate)}" type="date"></div>
        <div class="full calc-box" id="policy-calc"></div>
        <div class="field full"><label>Notes</label><textarea name="notes">${esc(p.notes)}</textarea></div>
        <div class="form-actions full">
          <div>${p.id ? '<button type="button" class="btn btn-ghost btn-danger" data-del>Delete policy</button>' : ''}</div>
          <div class="right"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn btn-primary">Save</button></div>
        </div>
      </form>`;
  }
  function openPolicyForm(id, presetClient) {
    const p = id ? policyById(id) : (presetClient ? { clientId: presetClient } : null);
    if (!db.clients.length) { toast('Add a client first'); return openClientForm(); }
    openModal(id ? 'Edit policy' : 'New policy', policyForm(p), body => {
      const form = $('#policy-form');
      const calc = () => {
        const d = Object.fromEntries(new FormData(form).entries());
        const ap = annualPremium(d), tot = expectedTotal(d), adv = expectedAdvance(d);
        $('#policy-calc').innerHTML = `<div>Annual premium<b>${money2(ap)}</b></div><div>Total commission (first year)<b>${money2(tot)}</b></div><div>Advance you should see<b>${money2(adv)}</b></div>`;
      };
      form.addEventListener('input', calc); calc();
      form.productType.addEventListener('change', () => { if (!id) { form.commRate.value = db.settings.rates[form.productType.value] || 0; calc(); } });
      form.addEventListener('submit', e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        ['face', 'premium', 'commRate', 'advance'].forEach(k => data[k] = Number(data[k]) || 0);
        const cl = clientById(data.clientId);
        if (id) { Object.assign(p, data); logActivity(`Updated policy for ${clientName(cl)} (${data.carrier}, ${data.status})`); }
        else {
          const n = Object.assign({ id: uid(), createdAt: today() }, data); db.policies.push(n);
          logActivity(`Added ${data.productType} policy for ${clientName(cl)} — ${data.carrier}, ${money(annualPremium(n))} AP`);
          if (cl && (cl.status === 'Lead' || cl.status === 'Quoted')) cl.status = 'Applied';
        }
        if (cl && ['Issued', 'Paid'].includes(data.status) && cl.status !== 'Client') cl.status = 'Client';
        save(); closeModal(); renderAll(); toast('Policy saved');
      });
      $('[data-cancel]', body).addEventListener('click', closeModal);
      const del = $('[data-del]', body);
      if (del) del.addEventListener('click', () => {
        if (!confirm('Delete this policy? Payments logged against it will be kept but unlinked.')) return;
        db.payments.forEach(x => { if (x.policyId === p.id) x.policyId = ''; });
        db.policies = db.policies.filter(x => x.id !== p.id);
        logActivity('Deleted a policy'); save(); closeModal(); renderAll(); toast('Policy deleted');
      });
    });
  }

  // ---------- payment form ----------
  function paymentForm(x) {
    x = x || {};
    const polOpts = db.policies.slice().sort((a, b) => (b.submittedDate || '').localeCompare(a.submittedDate || '')).map(p => `<option value="${p.id}" ${p.id === x.policyId ? 'selected' : ''}>${esc(clientName(clientById(p.clientId)))} — ${esc(p.carrier)} ${esc(p.product || '')} (${money(annualPremium(p))} AP)</option>`).join('');
    return `
      <form id="payment-form" class="form-grid">
        <div class="field"><label>Date</label><input name="date" type="date" value="${esc(x.date || today())}" required></div>
        <div class="field"><label>Amount ($, negative for chargeback)</label><input name="amount" type="number" step="0.01" value="${esc(x.amount)}" required></div>
        <div class="field"><label>Type</label><select name="type">${opts(PAYMENT_TYPES, x.type || 'Commission advance')}</select></div>
        <div class="field"><label>Carrier</label><select name="carrier">${opts(CARRIERS, x.carrier || 'Americo')}</select></div>
        <div class="field full"><label>Linked policy (optional)</label><select name="policyId"><option value="">— none —</option>${polOpts}</select></div>
        <div class="field full"><label>Note</label><input name="note" value="${esc(x.note)}" placeholder="Statement #, period, etc."></div>
        <div class="form-actions full">
          <div>${x.id ? '<button type="button" class="btn btn-ghost btn-danger" data-del>Delete</button>' : ''}</div>
          <div class="right"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn btn-primary">Save</button></div>
        </div>
      </form>`;
  }
  function openPaymentForm(id, presetPolicy) {
    const x = id ? db.payments.find(p => p.id === id) : (presetPolicy ? { policyId: presetPolicy.id, carrier: presetPolicy.carrier, amount: expectedAdvance(presetPolicy).toFixed(2) } : null);
    openModal(id ? 'Edit payment' : 'Log a payment', paymentForm(x), body => {
      const form = $('#payment-form');
      form.policyId.addEventListener('change', () => { const p = policyById(form.policyId.value); if (p) { form.carrier.value = p.carrier; if (!form.amount.value) form.amount.value = expectedAdvance(p).toFixed(2); } });
      form.type.addEventListener('change', () => { const v = Number(form.amount.value); if (form.type.value === 'Chargeback' && v > 0) form.amount.value = -v; });
      form.addEventListener('submit', e => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries()); data.amount = Number(data.amount) || 0;
        if (id) Object.assign(x, data); else db.payments.push(Object.assign({ id: uid() }, data));
        const p = policyById(data.policyId);
        if (p && data.amount > 0 && ['Submitted', 'Pending', 'Approved', 'Issued'].includes(p.status)) p.status = 'Paid';
        if (p && data.type === 'Chargeback') p.status = 'Chargeback';
        logActivity(`${id ? 'Updated' : 'Logged'} ${money2(data.amount)} ${data.type} from ${data.carrier}`);
        save(); closeModal(); renderAll(); toast('Payment saved');
      });
      $('[data-cancel]', body).addEventListener('click', closeModal);
      const del = $('[data-del]', body);
      if (del) del.addEventListener('click', () => { if (!confirm('Delete this payment?')) return; db.payments = db.payments.filter(p => p.id !== x.id); save(); closeModal(); renderAll(); });
    });
  }

  // ---------- settings ----------
  function openSettings() {
    const s = db.settings;
    openModal('Settings', `
      <form id="settings-form" class="form-grid">
        <div class="field full"><label>Your name (shown on backups)</label><input name="agentName" value="${esc(s.agentName)}"></div>
        <div class="field"><label>Default commission % — Term Life</label><input name="r_term" type="number" step="0.5" value="${esc(s.rates['Term Life'])}"></div>
        <div class="field"><label>Default commission % — IUL</label><input name="r_iul" type="number" step="0.5" value="${esc(s.rates['IUL'])}"></div>
        <div class="field"><label>Default commission % — Whole Life</label><input name="r_whole" type="number" step="0.5" value="${esc(s.rates['Whole Life'])}"></div>
        <div class="field"><label>Default advance %</label><input name="advance" type="number" step="1" value="${esc(s.advance)}"></div>
        <div class="field"><label>Theme</label><select name="theme">${opts(['auto', 'light', 'dark'], s.theme || 'auto')}</select></div>
        <div class="field"><label>Danger zone</label><button type="button" class="btn btn-danger" id="wipe">Erase all data</button></div>
        <div class="form-actions full"><div class="muted">Data is stored only in this browser. Use Backup regularly.</div><div class="right"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn btn-primary">Save</button></div></div>
      </form>`, body => {
      const form = $('#settings-form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form).entries());
        s.agentName = d.agentName; s.rates = { 'Term Life': +d.r_term || 0, 'IUL': +d.r_iul || 0, 'Whole Life': +d.r_whole || 0 }; s.advance = +d.advance || 0; s.theme = d.theme;
        applyTheme(); save(); closeModal(); renderAll(); toast('Settings saved');
      });
      $('[data-cancel]', body).addEventListener('click', closeModal);
      $('#wipe').addEventListener('click', () => { if (prompt('Type ERASE to delete every client, policy and payment.') === 'ERASE') { db = defaults(); save(); closeModal(); renderAll(); toast('All data erased'); } });
    });
  }
  function applyTheme() { const t = db.settings.theme; if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }
  $('#btn-settings').addEventListener('click', openSettings);

  // ---------- backup / restore ----------
  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Object.assign({ exportedAt: new Date().toISOString() }, db), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `life-crm-backup-${today()}.json`; a.click(); URL.revokeObjectURL(a.href);
  });
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d.clients || !d.policies) throw new Error('not a backup');
        if (!confirm(`Restore ${d.clients.length} clients, ${d.policies.length} policies and ${(d.payments || []).length} payments? This replaces what is here now.`)) return;
        db = Object.assign(defaults(), d, { settings: Object.assign(defaults().settings, d.settings || {}) }); save(); applyTheme(); renderAll(); toast('Backup restored');
      } catch (err) { toast('That file is not a valid backup'); }
      e.target.value = '';
    };
    r.readAsText(f);
  });

  // ---------- global action buttons ----------
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]'); if (!b) return;
    const a = b.dataset.action;
    if (a === 'new-client') openClientForm();
    if (a === 'new-policy') openPolicyForm(null, b.dataset.client || null);
    if (a === 'new-payment') openPaymentForm(null, b.dataset.policy ? policyById(b.dataset.policy) : null);
    if (a === 'edit-client') openClientForm(b.dataset.id);
    if (a === 'edit-policy') openPolicyForm(b.dataset.id);
    if (a === 'edit-payment') openPaymentForm(b.dataset.id);
    if (a === 'goto-client') { ui.clientSel = b.dataset.id; showTab('clients'); }
    if (a === 'quote-client') { const c = clientById(b.dataset.id); showTab('cheatsheet'); if (c && c.height && c.weight) { ui.buildPreset = { h: c.height, w: c.weight }; } }
  });

  // ---------- DASHBOARD ----------
  function renderDashboard() {
    const now = new Date(), ym = now.toISOString().slice(0, 7), yr = String(now.getFullYear());
    const live = db.policies.filter(p => !['Declined', 'Lapsed', 'Chargeback'].includes(p.status));
    const sumAP = arr => arr.reduce((s, p) => s + annualPremium(p), 0);
    const mPol = live.filter(p => monthKey(p.submittedDate) === ym), yPol = live.filter(p => (p.submittedDate || '').startsWith(yr));
    const recYTD = db.payments.filter(x => (x.date || '').startsWith(yr)).reduce((s, x) => s + Number(x.amount || 0), 0);
    const openExp = live.filter(p => ['Submitted', 'Pending', 'Approved', 'Issued'].includes(p.status)).reduce((s, p) => s + expectedAdvance(p) - receivedFor(p.id), 0);
    const due = db.clients.filter(c => c.followUp && c.followUp <= today()).length;
    const tiles = [
      ['AP written this month', money(sumAP(mPol)), `${mPol.length} polic${mPol.length === 1 ? 'y' : 'ies'}`],
      ['AP written YTD', money(sumAP(yPol)), `${yPol.length} policies`],
      ['Commission received YTD', money(recYTD), 'from the payment ledger', recYTD >= 0 ? 'good' : 'bad'],
      ['Commission in the pipeline', money(openExp), 'expected advance not yet received'],
      ['Clients', db.clients.length, `${db.clients.filter(c => c.status === 'Client').length} active clients`],
      ['Follow-ups due', due, due ? 'overdue or due today' : 'nothing due', due ? 'bad' : '']
    ];
    $('#dash-tiles').innerHTML = tiles.map(t => `<div class="tile ${t[3] || ''}"><div class="label">${esc(t[0])}</div><div class="value">${esc(t[1])}</div><div class="sub">${esc(t[2])}</div></div>`).join('');

    // monthly chart: last 12 months of AP written
    const months = []; for (let i = 11; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(d.toISOString().slice(0, 7)); }
    const series = months.map(m => ({ key: m, label: new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short' }), value: sumAP(live.filter(p => monthKey(p.submittedDate) === m)) }));
    $('#dash-chart-sub').textContent = 'last 12 months · excludes declined/lapsed';
    barChart($('#dash-chart'), series);

    // pipeline
    const counts = POLICY_STATUSES.map(s => [s, db.policies.filter(p => p.status === s)]).filter(x => x[1].length);
    $('#dash-pipeline').innerHTML = counts.length ? `<ul class="bars-list">${counts.map(([s, arr]) => `<li><span>${pill(s)}</span><div class="track"><div class="fill" style="width:${Math.round(100 * arr.length / db.policies.length)}%"></div></div><span class="amt">${arr.length} · ${money(sumAP(arr))}</span></li>`).join('')}</ul>` : '<div class="empty">No policies yet. Add one from the Policies tab.</div>';

    // follow-ups
    const fu = db.clients.filter(c => c.followUp).sort((a, b) => a.followUp.localeCompare(b.followUp)).slice(0, 10);
    $('#dash-followups').innerHTML = fu.length ? `<ul class="mini-list">${fu.map(c => `<li><span><b>${esc(clientName(c))}</b> ${pill(c.status)}<br><span class="muted">${esc(c.phone || '')}</span></span><span style="text-align:right"><span class="${c.followUp <= today() ? 'pill s-lost' : 'pill'}">${fmtDate(c.followUp)}</span><br><button class="btn btn-sm" data-action="goto-client" data-id="${c.id}">Open</button></span></li>`).join('')}</ul>` : '<div class="empty">No follow-ups scheduled. Set a follow-up date on a client.</div>';

    $('#dash-recent').innerHTML = db.activity.length ? `<ul class="activity">${db.activity.slice(0, 12).map(a => `<li><time>${fmtDate(a.t.slice(0, 10))}</time>${esc(a.text)}</li>`).join('')}</ul>` : '<div class="empty">Activity will show up here as you add clients, policies and payments.</div>';
  }

  // single-series SVG bar chart with hover tooltip
  function barChart(el, series, fmt) {
    fmt = fmt || money;
    const W = 600, H = 220, padL = 44, padB = 26, padT = 12, padR = 8;
    const max = Math.max(1, ...series.map(s => s.value));
    const iw = (W - padL - padR) / series.length, bw = Math.min(28, iw * 0.6);
    const y = v => padT + (H - padT - padB) * (1 - v / max);
    const ticks = [0, 0.5, 1].map(f => Math.round(max * f));
    let svg = `<svg viewBox="0 0 ${W} ${H}">`;
    ticks.forEach(t => { svg += `<line class="axis" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text class="lbl" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${fmt(t).replace('.00', '')}</text>`; });
    series.forEach((s, i) => {
      const x = padL + i * iw + (iw - bw) / 2, h = Math.max(0, y(0) - y(s.value));
      svg += `<rect class="bar" x="${x}" y="${y(s.value)}" width="${bw}" height="${h}" rx="4" data-i="${i}"><title>${esc(s.label)}: ${esc(fmt(s.value))}</title></rect>`;
      svg += `<text class="lbl" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(s.label)}</text>`;
    });
    svg += '</svg>';
    el.innerHTML = svg;
  }

  // ---------- CLIENTS ----------
  function renderClients() {
    const sf = $('#client-status-filter'); if (sf.options.length === 1) sf.innerHTML += opts(CLIENT_STATUSES);
    const q = ($('#client-search').value || '').toLowerCase(), st = sf.value;
    let list = db.clients.filter(c => (!st || c.status === st) && (!q || [c.first, c.last, c.phone, c.email, c.notes, c.health, c.source].join(' ').toLowerCase().includes(q)));
    list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || clientName(a).localeCompare(clientName(b)));
    const rows = list.map(c => {
      const pols = db.policies.filter(p => p.clientId === c.id);
      const ap = pols.filter(p => !['Declined', 'Lapsed', 'Chargeback'].includes(p.status)).reduce((s, p) => s + annualPremium(p), 0);
      return `<tr data-id="${c.id}" class="${c.id === ui.clientSel ? 'selected' : ''}"><td><b>${esc(clientName(c))}</b><br><span class="muted">${esc(c.phone || c.email || '')}</span></td><td>${pill(c.status)}</td><td>${esc(ageFromDob(c.dob) || '')}</td><td>${esc(c.state || '')}</td><td class="num">${pols.length}</td><td class="num">${money(ap)}</td><td>${c.followUp ? `<span class="${c.followUp <= today() ? 'pill s-lost' : 'pill'}">${fmtDate(c.followUp)}</span>` : ''}</td></tr>`;
    }).join('');
    $('#client-table-wrap').innerHTML = list.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>Client</th><th>Status</th><th>Age</th><th>St</th><th class="num">Policies</th><th class="num">AP</th><th>Follow-up</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${db.clients.length ? 'No clients match.' : 'No clients yet — click + Client to add your first one.'}</div>`;
    $$('#client-table-wrap tbody tr').forEach(tr => tr.addEventListener('click', () => { ui.clientSel = tr.dataset.id; renderClients(); }));
    renderClientDetail();
  }
  function renderClientDetail() {
    const c = clientById(ui.clientSel), el = $('#client-detail');
    if (!c) { el.innerHTML = '<div class="empty">Select a client to see details.</div>'; return; }
    const pols = db.policies.filter(p => p.clientId === c.id).sort((a, b) => (b.submittedDate || '').localeCompare(a.submittedDate || ''));
    const h = c.height ? `${Math.floor(c.height / 12)}'${c.height % 12}"` : '';
    el.innerHTML = `
      <div class="detail-head"><div><h2>${esc(clientName(c))}</h2>${pill(c.status)} <span class="muted">added ${fmtDate(c.createdAt)}</span></div>
        <div><button class="btn btn-sm" data-action="edit-client" data-id="${c.id}">Edit</button> <button class="btn btn-sm btn-primary" data-action="quote-client" data-id="${c.id}">Quote</button></div></div>
      <dl class="kv">
        <dt>Phone</dt><dd>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '—'}</dd>
        <dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</dd>
        <dt>DOB / age</dt><dd>${c.dob ? `${fmtDate(c.dob)} (${ageFromDob(c.dob)})` : '—'}</dd>
        <dt>State</dt><dd>${esc(c.state || '—')}</dd>
        <dt>Build</dt><dd>${h || c.weight ? `${h} ${c.weight ? c.weight + ' lb' : ''}` : '—'}${c.tobacco === 'Yes' ? ' · <b>Tobacco</b>' : ''}</dd>
        <dt>Source</dt><dd>${esc(c.source || '—')}</dd>
        <dt>Follow-up</dt><dd>${c.followUp ? fmtDate(c.followUp) : '—'}</dd>
      </dl>
      ${c.health ? `<h3>Health / meds</h3><div class="notes-pre">${esc(c.health)}</div><br>` : ''}
      ${c.notes ? `<h3>Notes</h3><div class="notes-pre">${esc(c.notes)}</div><br>` : ''}
      <div class="card-head"><h3>Policies (${pols.length})</h3><button class="btn btn-sm" data-action="new-policy" data-client="${c.id}">+ Policy</button></div>
      ${pols.length ? `<ul class="mini-list">${pols.map(p => `<li><span><b>${esc(p.carrier)}</b> ${esc(p.product || '')}<br><span class="muted">${esc(p.productType)} · ${money(p.face)} face · ${money2(p.premium)}/${esc({ Monthly: 'mo', Quarterly: 'qtr', 'Semi-annual': '6 mo', Annual: 'yr' }[p.mode || 'Monthly'] || 'mo')}</span></span><span style="text-align:right">${pill(p.status)}<br><button class="btn btn-sm" data-action="edit-policy" data-id="${p.id}">Edit</button></span></li>`).join('')}</ul>` : '<div class="muted">No policies yet.</div>'}`;
  }
  $('#client-search').addEventListener('input', renderClients);
  $('#client-status-filter').addEventListener('change', renderClients);

  // ---------- POLICIES ----------
  function renderPolicies() {
    const sf = $('#policy-status-filter'), tf = $('#policy-type-filter');
    if (sf.options.length === 1) sf.innerHTML += opts(POLICY_STATUSES);
    if (tf.options.length === 1) tf.innerHTML += opts(PRODUCT_TYPES);
    const q = ($('#policy-search').value || '').toLowerCase();
    let list = db.policies.filter(p => (!sf.value || p.status === sf.value) && (!tf.value || p.productType === tf.value) && (!q || [clientName(clientById(p.clientId)), p.carrier, p.product, p.policyNo, p.notes].join(' ').toLowerCase().includes(q)));
    list.sort((a, b) => (b.submittedDate || '').localeCompare(a.submittedDate || ''));
    const live = list.filter(p => !['Declined', 'Lapsed', 'Chargeback'].includes(p.status));
    const t = [
      ['Policies shown', list.length, `${live.length} active`],
      ['Annual premium', money(live.reduce((s, p) => s + annualPremium(p), 0)), 'active policies'],
      ['Face amount', money(live.reduce((s, p) => s + Number(p.face || 0), 0)), 'active policies'],
      ['Expected first-year commission', money(live.reduce((s, p) => s + expectedTotal(p), 0)), 'at your rates']
    ];
    $('#policy-tiles').innerHTML = t.map(x => `<div class="tile"><div class="label">${esc(x[0])}</div><div class="value">${esc(x[1])}</div><div class="sub">${esc(x[2])}</div></div>`).join('');
    const rows = list.map(p => `<tr data-id="${p.id}"><td><b>${esc(clientName(clientById(p.clientId)))}</b></td><td>${esc(p.carrier)}<br><span class="muted">${esc(p.product || '')} ${p.policyNo ? '#' + esc(p.policyNo) : ''}</span></td><td>${esc(p.productType)}</td><td>${pill(p.status)}</td><td class="num">${money(p.face)}</td><td class="num">${money2(p.premium)}<br><span class="muted">${esc(p.mode || 'Monthly')}</span></td><td class="num">${money(annualPremium(p))}</td><td class="num">${money(expectedAdvance(p))}<br><span class="muted">${p.commRate}% · ${p.advance}% adv</span></td><td class="num">${money(receivedFor(p.id))}</td><td>${fmtDate(p.submittedDate)}</td></tr>`).join('');
    $('#policy-table-wrap').innerHTML = list.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>Client</th><th>Carrier</th><th>Type</th><th>Status</th><th class="num">Face</th><th class="num">Premium</th><th class="num">AP</th><th class="num">Advance due</th><th class="num">Received</th><th>Submitted</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">${db.policies.length ? 'No policies match.' : 'No policies yet — click + Policy.'}</div>`;
    $$('#policy-table-wrap tbody tr').forEach(tr => tr.addEventListener('click', () => openPolicyForm(tr.dataset.id)));
  }
  ['#policy-search', '#policy-status-filter', '#policy-type-filter'].forEach(s => $(s).addEventListener('input', renderPolicies));

  // ---------- MONEY ----------
  function renderMoney() {
    const ys = $('#money-year');
    const years = Array.from(new Set([new Date().getFullYear(), ...db.payments.map(x => +(x.date || '').slice(0, 4)).filter(Boolean), ...db.policies.map(p => +(p.submittedDate || '').slice(0, 4)).filter(Boolean)])).sort((a, b) => b - a);
    ys.innerHTML = years.map(y => `<option value="${y}" ${y === ui.moneyYear ? 'selected' : ''}>${y}</option>`).join('');
    const yr = String(ui.moneyYear);
    const pays = db.payments.filter(x => (x.date || '').startsWith(yr));
    const sum = arr => arr.reduce((s, x) => s + Number(x.amount || 0), 0);
    const pos = sum(pays.filter(x => x.amount > 0)), neg = sum(pays.filter(x => x.amount < 0));
    const live = db.policies.filter(p => (p.submittedDate || '').startsWith(yr) && !['Declined', 'Lapsed', 'Chargeback'].includes(p.status));
    const expTot = live.reduce((s, p) => s + expectedTotal(p), 0);
    const owedRows = db.policies.filter(p => ['Approved', 'Issued', 'Paid'].includes(p.status)).map(p => ({ p, owed: expectedAdvance(p) - receivedFor(p.id) })).filter(r => r.owed > 0.5).sort((a, b) => b.owed - a.owed);
    const owed = owedRows.reduce((s, r) => s + r.owed, 0);
    const tiles = [
      ['Received in ' + yr, money(pos + neg), `${pays.length} payments`, 'good'],
      ['Chargebacks in ' + yr, money(neg), 'negative payments', neg ? 'bad' : ''],
      ['Expected first-year commission', money(expTot), `policies submitted in ${yr}`],
      ['Still owed to you', money(owed), `${owedRows.length} issued/paid policies`]
    ];
    $('#money-tiles').innerHTML = tiles.map(t => `<div class="tile ${t[3] || ''}"><div class="label">${esc(t[0])}</div><div class="value">${esc(t[1])}</div><div class="sub">${esc(t[2])}</div></div>`).join('');
    const series = []; for (let m = 0; m < 12; m++) { const k = `${yr}-${String(m + 1).padStart(2, '0')}`; series.push({ key: k, label: new Date(k + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short' }), value: sum(pays.filter(x => monthKey(x.date) === k)) }); }
    barChart($('#money-chart'), series);
    const byCar = {}; pays.forEach(x => { byCar[x.carrier || 'Other'] = (byCar[x.carrier || 'Other'] || 0) + Number(x.amount || 0); });
    const carRows = Object.entries(byCar).sort((a, b) => b[1] - a[1]); const cmax = Math.max(1, ...carRows.map(r => Math.abs(r[1])));
    $('#money-carrier').innerHTML = carRows.length ? `<ul class="bars-list">${carRows.map(([c, v]) => `<li><span>${esc(c)}</span><div class="track"><div class="fill" style="width:${Math.round(100 * Math.abs(v) / cmax)}%"></div></div><span class="amt">${money(v)}</span></li>`).join('')}</ul>` : '<div class="empty">No payments logged for this year.</div>';
    $('#money-owed').innerHTML = owedRows.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>Client</th><th>Carrier</th><th>Status</th><th class="num">Advance due</th><th class="num">Received</th><th class="num">Owed</th><th></th></tr></thead><tbody>${owedRows.map(({ p, owed }) => `<tr><td>${esc(clientName(clientById(p.clientId)))}</td><td>${esc(p.carrier)} ${esc(p.product || '')}</td><td>${pill(p.status)}</td><td class="num">${money2(expectedAdvance(p))}</td><td class="num">${money2(receivedFor(p.id))}</td><td class="num"><b>${money2(owed)}</b></td><td><button class="btn btn-sm" data-action="new-payment" data-policy="${p.id}">Log payment</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nothing outstanding. Policies marked Approved, Issued or Paid show here until their advance is logged.</div>';
    const prow = pays.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(x => { const p = policyById(x.policyId); return `<tr data-id="${x.id}"><td>${fmtDate(x.date)}</td><td>${esc(x.type)}</td><td>${esc(x.carrier)}</td><td>${p ? esc(clientName(clientById(p.clientId))) + ' · ' + esc(p.product || '') : '<span class="muted">—</span>'}</td><td>${esc(x.note || '')}</td><td class="num" style="color:${x.amount < 0 ? 'var(--bad)' : 'inherit'}">${money2(x.amount)}</td></tr>`; }).join('');
    $('#payment-table-wrap').innerHTML = pays.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>Date</th><th>Type</th><th>Carrier</th><th>Policy</th><th>Note</th><th class="num">Amount</th></tr></thead><tbody>${prow}</tbody></table></div>` : '<div class="empty">No payments yet — log commission statements as they come in.</div>';
    $$('#payment-table-wrap tbody tr').forEach(tr => tr.addEventListener('click', () => openPaymentForm(tr.dataset.id)));
  }
  $('#money-year').addEventListener('change', e => { ui.moneyYear = +e.target.value; renderMoney(); });

  // ---------- CHEAT SHEET ----------
  $$('.pick').forEach(b => b.addEventListener('click', () => { ui.product = b.dataset.product; ui.cheatSearch = ''; renderCheat(); window.scrollTo({ top: $('#cheat-body').offsetTop - 70, behavior: 'smooth' }); }));

  function renderCheat() {
    $$('.pick').forEach(b => b.classList.toggle('active', b.dataset.product === ui.product));
    const body = $('#cheat-body');
    if (!ui.product) { body.innerHTML = '<div class="card intro">👆 Click <b>Term Life</b>, <b>IUL</b> or <b>Whole Life</b> above to load that product\'s carrier cheat sheet.</div>'; return; }
    const view = PRODUCT_VIEWS[ui.product], G = window.UW_GUIDES[view.guide];
    const cols = ui.showAllCols ? G.carriers.map((_, i) => i) : view.cols;
    const q = ui.cheatSearch.trim().toLowerCase();
    const rows = G.rows.filter(r => !q || r.condition.toLowerCase().includes(q) || cols.some(i => r.cells[i].text.toLowerCase().includes(q)));
    const hl = s => q ? esc(s).replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), m => `<span class="hit">${m}</span>`) : esc(s);

    const cards = cols.map(i => G.carriers[i]).map(c => `<div class="carrier-card"><div class="abbr">${esc(c.abbr)}</div><div class="name">${esc(c.name)}</div><div class="prod">${esc(c.product)}</div><ul>${c.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`).join('');
    const legend = `<div class="legend">${COLOR_LEGEND.map(([k, l]) => `<span><i style="background:var(--uw-${k})"></i>${esc(l)}</span>`).join('')}</div>`;
    const thead = `<tr><th>Illness / Condition</th>${cols.map(i => `<th><span class="cn">${esc(G.carriers[i].name)}</span><span class="cp">${esc(G.carriers[i].product)}</span></th>`).join('')}</tr>`;
    const tbody = rows.map(r => `<tr><td>${hl(r.condition)}</td>${cols.map(i => `<td class="c-${r.cells[i].color}">${hl(r.cells[i].text)}</td>`).join('')}</tr>`).join('');
    const abbrs = cols.map(i => G.carriers[i].abbr);
    const charts = G.charts.filter(c => abbrs.includes(c.abbr));

    body.innerHTML = `
      <div class="card">
        <div class="card-head"><div><h2>${esc(view.label)} — ${esc(G.title)}</h2><div class="muted">${esc(G.subtitle)} · ${esc(view.blurb)}</div></div>
          <label class="muted"><input type="checkbox" id="cheat-allcols" ${ui.showAllCols ? 'checked' : ''}> show every carrier in this guide</label></div>
        <div class="carrier-cards">${cards}</div>
        <div class="cheat-toolbar">
          <input type="search" id="cheat-search" placeholder="Search a condition or keyword (e.g. diabetes, COPD, insulin, DUI)…" value="${esc(ui.cheatSearch)}">
          <span class="muted">${rows.length} of ${G.rows.length} conditions</span>
          <button class="btn btn-sm" onclick="window.print()">Print</button>
        </div>
        ${legend}
        <div class="uw-wrap"><table class="uw"><thead>${thead}</thead><tbody>${tbody || `<tr><td colspan="${cols.length + 1}" style="padding:20px;color:#9fb3c8">No condition matches "${esc(q)}".</td></tr>`}</tbody></table></div>
      </div>
      <details class="section card" open>
        <summary>Build / height–weight check</summary>
        <div class="build-tool">
          <div class="field"><label>Height (ft)</label><input id="b-ft" type="number" min="3" max="7" value="${ui.buildPreset ? Math.floor(ui.buildPreset.h / 12) : 5}"></div>
          <div class="field"><label>Height (in)</label><input id="b-in" type="number" min="0" max="11" value="${ui.buildPreset ? ui.buildPreset.h % 12 : 8}"></div>
          <div class="field"><label>Weight (lb)</label><input id="b-wt" type="number" min="50" max="700" value="${ui.buildPreset ? ui.buildPreset.w : ''}" placeholder="lbs"></div>
          <button class="btn btn-primary" id="b-go">Check build</button>
          <span class="muted" id="b-bmi"></span>
        </div>
        <div class="build-results" id="build-results"></div>
        <div class="charts">${charts.map(c => chartCard(c)).join('')}</div>
      </details>
      <details class="section card">
        <summary>Product notes & key reminders</summary>
        <div class="notes-list">${G.notes.map(n => `<div class="note"><b>${esc(n.title)}:</b> ${esc(n.text)}</div>`).join('')}</div>
      </details>`;

    const si = $('#cheat-search');
    si.addEventListener('input', () => { ui.cheatSearch = si.value; const pos = si.selectionStart; renderCheat(); const n = $('#cheat-search'); n.focus(); n.setSelectionRange(pos, pos); });
    $('#cheat-allcols').addEventListener('change', e => { ui.showAllCols = e.target.checked; renderCheat(); });
    $('#b-go').addEventListener('click', () => runBuild(charts));
    ['#b-ft', '#b-in', '#b-wt'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') runBuild(charts); }));
    if (ui.buildPreset) { runBuild(charts); ui.buildPreset = null; }
  }

  function chartCard(c) {
    const head = c.headers.length ? `<tr>${c.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>` : '';
    const rows = c.rows.map(r => `<tr data-h="${esc(r[0])}">${r.map(v => `<td>${esc(v)}</td>`).join('')}</tr>`).join('');
    return `<div class="chart-card" data-abbr="${esc(c.abbr)}"><h3>${esc(c.abbr)} · ${esc(c.title)}</h3><div class="muted" style="margin-bottom:6px">${esc(c.note)}</div>${c.rows.length ? `<table><thead>${head}</thead><tbody>${rows}</tbody></table>` : ''}</div>`;
  }
  function inches(s) { const m = /(\d+)'(\d+)/.exec(s); return m ? +m[1] * 12 + +m[2] : null; }
  function runBuild(charts) {
    const ft = +$('#b-ft').value || 0, inn = +$('#b-in').value || 0, wt = +$('#b-wt').value || 0, h = ft * 12 + inn;
    if (!h || !wt) { $('#build-results').innerHTML = '<div class="muted">Enter height and weight.</div>'; return; }
    const bmi = 703 * wt / (h * h);
    $('#b-bmi').textContent = `${ft}'${inn}" · ${wt} lb · BMI ${bmi.toFixed(1)}`;
    $$('.chart-card tr.hl').forEach(tr => tr.classList.remove('hl'));
    const out = charts.map(c => {
      let verdict = '', cls = 'mid', detail = c.note;
      if (!c.rows.length) { verdict = c.abbr === 'AE' ? 'No height/weight chart — any build accepted' : 'See chart note'; cls = c.abbr === 'AE' ? 'ok' : 'mid'; }
      else if (c.headers[0] === 'Tier') {
        // BMI band chart (Ethos)
        const band = c.rows.find(r => { const m = /([\d.]+)\s*-\s*([\d.]+)/.exec(r[1]); return m && bmi >= +m[1] && bmi <= +m[2]; });
        if (band) { verdict = `${band[0]} (BMI ${band[1]}) · max face ${band[2]}`; cls = band[0] === 'Prime' ? 'ok' : 'mid'; highlight(c.abbr, band[0]); }
        else { verdict = 'DECLINE — BMI outside every band'; cls = 'no'; }
      } else {
        // pick exact height row or the nearest row at or below
        let row = null, rh = -1;
        c.rows.forEach(r => { const ri = inches(r[0]); if (ri != null && ri <= h && ri > rh) { rh = ri; row = r; } });
        if (!row) { row = c.rows[0]; rh = inches(row[0]); }
        highlight(c.abbr, row[0]);
        const approx = rh !== h ? ` (using ${row[0]} row)` : '';
        const mins = [], maxes = [];
        c.headers.forEach((hd, i) => { if (i === 0) return; const v = +row[i]; if (isNaN(v)) return; (/min/i.test(hd) ? mins : maxes).push([hd, v]); });
        const under = mins.length && wt < Math.min(...mins.map(m => m[1]));
        if (under) { verdict = `Under minimum weight (${mins.map(m => m[0] + ' ' + m[1]).join(', ')})`; cls = 'no'; }
        else {
          const hit = maxes.find(m => wt <= m[1]);
          if (hit) { verdict = `${hit[0]} (up to ${hit[1]} lb)${approx}`; cls = maxes.indexOf(hit) === 0 ? 'ok' : 'mid'; }
          else { verdict = `Over max (${maxes[maxes.length - 1][0]} ${maxes[maxes.length - 1][1]} lb)${approx}`; cls = 'no'; }
        }
        detail = `${row[0]}: ${c.headers.slice(1).map((hd, i) => hd + ' ' + row[i + 1]).join(' · ')}`;
      }
      return `<div class="build-result ${cls}"><b>${esc(c.abbr)} · ${esc(c.title)}</b><div class="verdict">${esc(verdict)}</div><div class="muted">${esc(detail)}</div></div>`;
    });
    $('#build-results').innerHTML = out.join('');
  }
  function highlight(abbr, key) { const tr = $(`.chart-card[data-abbr="${abbr}"] tr[data-h="${CSS.escape(key)}"]`); if (tr) tr.classList.add('hl'); }

  // ---------- boot ----------
  applyTheme();
  const start = (location.hash || '#dashboard').slice(1);
  showTab(['dashboard', 'clients', 'policies', 'money', 'cheatsheet'].includes(start) ? start : 'dashboard');
})();
