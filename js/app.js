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
  const LEAD_TYPES = {
    finalexpense: { label: 'Final Expense / Whole Life' },
    term: { label: 'Term / Family Protection' },
    iul: { label: 'IUL / Cash Value' },
    quoted: { label: 'Quoted - needs a decision' },
    general: { label: 'General inquiry' }
  };
  const TEMPLATE_FIELDS = '{first} {last} {name} {agent} {phone}';
  const DEFAULT_TEMPLATES = {
    finalexpense: {
      subject: '{first}, a quick note about final expense coverage',
      body: 'Hi {first},\n\nThanks for your interest in life insurance. For folks at your stage, the most common goal is making sure funeral costs and any leftover bills never land on family. A small whole life policy does exactly that: the premium never goes up, the coverage never expires, and most people qualify with a few health questions and no exam.\n\nI work with several carriers, so I can match the plan to your health history rather than the other way around.\n\nWould a 10-minute call this week work? Reply with a good time, or call or text me at the number below.\n\n{agent}\n{phone}'
    },
    term: {
      subject: '{first}, protecting your family for less than you might think',
      body: 'Hi {first},\n\nThanks for reaching out about life insurance. For most families the goal is simple: if something happened to you, the mortgage gets paid and the people who depend on you are taken care of. Term life does that for a fixed monthly cost, often about what a couple of takeout dinners run.\n\nI shop a group of carriers, so I can find the one that treats your health and build the most fairly. Many approve quickly without a medical exam.\n\nCan I run numbers for you? A 10-minute call is all it takes. Reply with a good time, or call or text me at the number below.\n\n{agent}\n{phone}'
    },
    iul: {
      subject: '{first}, life insurance that also builds cash value',
      body: 'Hi {first},\n\nThanks for your interest. Since you are thinking about the long term, an indexed universal life policy may be worth a look: it protects your family today and builds cash value tied to a market index, with a floor so a bad year does not take your balance backwards. That cash value can later be used tax-advantaged for retirement income or big expenses.\n\nIt is not right for everyone, so I would like to show you how the numbers look for your situation specifically.\n\nWould a short call this week work? Reply with a good time, or call or text me at the number below.\n\n{agent}\n{phone}'
    },
    quoted: {
      subject: '{first}, any questions on your quote?',
      body: 'Hi {first},\n\nI wanted to follow up on the quote I put together for you. Rates are based on your age at application, so locking it in sooner keeps the price where it is.\n\nIf anything about the coverage amount, the carrier or the monthly cost is not quite right, tell me and I will adjust it. If it looks good, the application takes about 15 minutes and I can walk you through it over the phone.\n\nWhat works better for you, a quick call or a few questions by reply?\n\n{agent}\n{phone}'
    },
    general: {
      subject: '{first}, quick follow-up on life insurance',
      body: 'Hi {first},\n\nThanks for your interest in life insurance. To point you toward the right kind of coverage, I just need a couple of things: roughly what you want the policy to cover (family income, a mortgage, final expenses, or savings), and any health conditions or medications I should plan around.\n\nReply with a line or two, or if it is easier, call or text me at the number below and we can sort it out in 10 minutes.\n\n{agent}\n{phone}'
    }
  };
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
  let db = defaults();
  let remote = false, me = null, saveTimer = null;   // remote = served by server/index.js with a login
  let ui = { clientSel: null, product: null, cheatSearch: '', showAllCols: false, moneyYear: new Date().getFullYear(), bankFilter: 'deposits' };

  function defaults() {
    return {
      clients: [], policies: [], payments: [], activity: [],
      settings: { agentName: '', agentPhone: '', rates: { 'Term Life': 80, 'IUL': 90, 'Whole Life': 100 }, advance: 75, theme: 'auto', emailTemplates: {} }
    };
  }
  function merge(d) { return Object.assign(defaults(), d, { settings: Object.assign(defaults().settings, (d && d.settings) || {}) }); }
  function loadLocal() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) return merge(JSON.parse(raw)); } catch (e) { console.warn('load failed', e); }
    return defaults();
  }
  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' }, credentials: 'same-origin' }, opts || {}));
    if (r.status === 401) { location.href = '/login'; throw new Error('signed out'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }
  function save() {
    if (!remote) { try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { toast('Could not save (storage blocked?)'); } return; }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api('/api/data', { method: 'PUT', body: JSON.stringify(db) }).catch(e => toast('Save failed: ' + e.message)), 300);
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

  // ---------- lead analysis ----------
  // Rule-based: works offline. The optional AI pass (server + ANTHROPIC_API_KEY) refines it and writes a personal draft.
  const aiDrafts = {};   // clientId -> { type, temperature, summary, subject, body } for this session only
  function daysSince(s) { if (!s) return null; const d = new Date(s.length === 10 ? s + 'T00:00:00' : s); return isNaN(d) ? null : Math.floor((Date.now() - d) / 86400000); }
  function bmi(c) { const h = Number(c.height), w = Number(c.weight); return h && w ? Math.round(703 * w / (h * h)) : null; }
  function leadType(c) {
    const age = Number(ageFromDob(c.dob)) || null, text = `${c.health || ''} ${c.notes || ''}`.toLowerCase(), why = [], flags = [];
    const has = re => re.test(text);
    let key;
    if (c.status === 'Quoted') { key = 'quoted'; why.push('already quoted'); }
    else if (has(/final expense|burial|funeral|cremation|casket/)) { key = 'finalexpense'; why.push('asked about final expense / burial'); }
    else if (has(/retire|cash value|savings|invest|iul|tax[- ]free|college fund|wealth/)) { key = 'iul'; why.push('mentions savings / retirement'); }
    else if (has(/mortgage|house|home loan|kids|children|baby|newborn|married|wife|husband|family|income replacement|spouse/)) { key = 'term'; why.push('mentions family / mortgage / income'); }
    else if (age !== null && age >= 60) { key = 'finalexpense'; why.push(`age ${age}`); }
    else if (age !== null) { key = 'term'; why.push(`age ${age}`); }
    else if (!text.trim()) { key = 'general'; why.push('no DOB or notes yet'); }
    else { key = 'term'; why.push('default fit'); }
    const serious = has(/diabet|insulin|copd|oxygen|heart|stroke|cancer|dialysis|kidney|hepat|hiv|afib|congestive|bipolar|schizo|alzheim|dementia|parkinson/);
    const b = bmi(c);
    if (serious) { flags.push('health conditions noted'); if (key === 'term' && age !== null && age >= 50) { key = 'finalexpense'; why.push('health + age favors simplified whole life'); } }
    if (b && b >= 38) flags.push(`build (BMI ~${b}) may need graded / GI carriers`);
    if (c.tobacco === 'Yes') flags.push('tobacco rates');
    // temperature
    let temp = 'Warm';
    const dueDays = c.followUp ? daysSince(c.followUp) : null, ageDays = daysSince(c.createdAt);
    if (c.status === 'Quoted' || (dueDays !== null && dueDays >= 0) || ['Referral', 'Walk-in'].includes(c.source) || has(/call me|asap|urgent|interested|ready/)) { temp = 'Hot'; why.push(c.status === 'Quoted' ? 'waiting on a decision' : dueDays !== null && dueDays >= 0 ? 'follow-up due' : ['Referral', 'Walk-in'].includes(c.source) ? `${c.source.toLowerCase()} lead` : 'asked to be contacted'); }
    else if (ageDays !== null && ageDays > 30 && !c.followUp) { temp = 'Cold'; why.push(`added ${ageDays} days ago, no follow-up set`); }
    else if (c.source) why.push(`${c.source.toLowerCase()} lead`);
    const ai = aiDrafts[c.id];
    if (ai) return { key: ai.type in LEAD_TYPES ? ai.type : key, label: LEAD_TYPES[ai.type in LEAD_TYPES ? ai.type : key].label, temp: ai.temperature || temp, why, flags, ai, ruleKey: key, ruleTemp: temp };
    return { key, label: LEAD_TYPES[key].label, temp, why, flags, ruleKey: key, ruleTemp: temp };
  }
  function tpl(key) { return Object.assign({}, DEFAULT_TEMPLATES[key] || DEFAULT_TEMPLATES.general, (db.settings.emailTemplates || {})[key] || {}); }
  function fillTemplate(text, c) {
    const first = (c.first || '').trim(), last = (c.last || '').trim();
    const f = { first: first || 'there', last, name: [first, last].filter(Boolean).join(' ') || 'there', agent: db.settings.agentName || '', phone: db.settings.agentPhone || '' };
    return String(text || '').replace(/\{(first|last|name|agent|phone)\}/gi, (m, k) => f[k.toLowerCase()]);
  }
  function draftFor(c, overrides) {
    const o = (overrides || {})[c.id]; if (o) return o;
    const a = aiDrafts[c.id]; if (a && a.subject && a.body) return { subject: a.subject, body: a.body };
    return tpl(leadType(c).key);
  }
  function typePill(t) { return `<span class="pill s-${esc(t.key)}">${esc(t.label)}</span>`; }
  function emailable(c) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((c.email || '').trim()); }

  // ---------- email leads ----------
  function openEmailLeads(onlyIds) {
    const overrides = {}, checked = new Set();
    let sel = null, statusFilter = onlyIds ? '' : 'leads', dueOnly = false, sending = false;
    const pool = () => onlyIds ? db.clients.filter(c => onlyIds.includes(c.id)) : db.clients;
    const visible = () => pool().filter(c => {
      if (statusFilter === 'leads' && !['Lead', 'Quoted'].includes(c.status)) return false;
      if (statusFilter && statusFilter !== 'leads' && c.status !== statusFilter) return false;
      if (dueOnly && !(c.followUp && c.followUp <= today())) return false;
      return true;
    }).sort((a, b) => ({ Hot: 0, Warm: 1, Cold: 2 }[leadType(a).temp] - { Hot: 0, Warm: 1, Cold: 2 }[leadType(b).temp]) || clientName(a).localeCompare(clientName(b)));
    visible().filter(emailable).forEach(c => checked.add(c.id));
    const canSend = remote && me && me.email, canAi = remote && me && me.ai;
    openModal(onlyIds && onlyIds.length === 1 ? `Email ${clientName(clientById(onlyIds[0]))}` : 'Email leads', `
      <div class="email-tools">
        ${onlyIds ? '' : `<label>Show <select id="em-status"><option value="leads">Leads &amp; Quoted</option><option value="Lead">Leads only</option><option value="Quoted">Quoted only</option><option value="">Everyone</option></select></label>
        <label><input type="checkbox" id="em-due"> follow-up due only</label>`}
        <span class="muted grow" id="em-count"></span>
        ${canAi ? `<button class="btn btn-sm" id="em-ai" title="Have Claude read each lead's notes, confirm the lead type and write a personal draft">&#10024; Analyze with AI</button>` : ''}
        <button class="btn btn-sm" id="em-templates">Templates</button>
      </div>
      <div class="table-scroll email-table"><table class="data"><thead><tr><th><input type="checkbox" id="em-all" checked></th><th>Lead</th><th>Type</th><th>Heat</th><th class="why">Why</th></tr></thead><tbody id="em-rows"></tbody></table></div>
      <div id="em-preview" class="email-preview"></div>
      ${canSend ? '' : `<div class="email-note">${remote ? 'Sending from the app is not set up yet: add <code>SMTP_HOST</code>, <code>SMTP_USER</code>, <code>SMTP_PASS</code> and <code>SMTP_FROM</code> to <code>.env</code> and restart (see README). Until then, use <b>Open in mail app</b> on each lead, or copy the addresses.' : 'The quick (no-login) version cannot send email itself. Use <b>Open in mail app</b> on each lead, or run the portal server with SMTP settings to send to everyone in one click.'}</div>`}
      <div class="form-actions">
        <label class="muted" style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="em-followup" checked> set a follow-up 3 days out for everyone emailed</label>
        <div class="right">
          ${canSend ? '' : '<button type="button" class="btn" id="em-copy">Copy addresses</button>'}
          <button type="button" class="btn" data-cancel>Close</button>
          ${canSend ? '<button type="button" class="btn btn-primary" id="em-send">Send</button>' : '<button type="button" class="btn btn-primary" id="em-open">Open in mail app</button>'}
        </div>
      </div>`, body => {
      const rowsEl = $('#em-rows'), prev = $('#em-preview');
      function renderRows() {
        const list = visible();
        if (!list.length) { rowsEl.innerHTML = `<tr><td colspan="5" class="empty">No leads match. ${db.clients.length ? 'Change the filter above.' : 'Add a client first.'}</td></tr>`; }
        else rowsEl.innerHTML = list.map(c => { const t = leadType(c), ok = emailable(c); return `<tr data-id="${c.id}" class="${c.id === sel ? 'selected' : ''} ${ok ? '' : 'noemail'}">
          <td><input type="checkbox" data-check="${c.id}" ${ok ? '' : 'disabled title="No email address"'} ${checked.has(c.id) ? 'checked' : ''}></td>
          <td><b>${esc(clientName(c))}</b><br><span class="muted">${ok ? esc(c.email) : 'no email address'}${c.lastEmailed ? ` · emailed ${fmtDate(c.lastEmailed)}` : ''}</span></td>
          <td>${typePill(t)}${t.ai ? '<br><span class="muted">AI</span>' : ''}</td>
          <td>${pill(t.temp)}</td>
          <td class="why">${esc([...t.why, ...t.flags].join(' · '))}${t.ai ? `<div class="ai-summary">${esc(t.ai.summary)}</div>` : ''}</td></tr>`; }).join('');
        const n = list.filter(c => checked.has(c.id)).length, noMail = list.filter(c => !emailable(c)).length;
        $('#em-count').textContent = `${n} selected of ${list.length}${noMail ? ` · ${noMail} without an email address` : ''}`;
        const sendBtn = $('#em-send'); if (sendBtn) { sendBtn.textContent = n === 1 ? 'Send 1 email' : `Send ${n} emails`; sendBtn.disabled = !n || sending; }
        const openBtn = $('#em-open'); if (openBtn) { openBtn.disabled = !sel || !emailable(clientById(sel)); }
        $('#em-all').checked = n > 0 && n === list.filter(emailable).length;
        if (!sel || !list.find(c => c.id === sel)) sel = (list.find(c => checked.has(c.id)) || list[0] || {}).id || null;
        renderPreview();
      }
      function renderPreview() {
        const c = clientById(sel);
        if (!c) { prev.innerHTML = '<div class="muted">Select a lead to preview their email.</div>'; return; }
        const d = draftFor(c, overrides), t = leadType(c);
        prev.innerHTML = `<div class="card-head" style="margin-bottom:6px"><b>Preview: ${esc(clientName(c))}</b><span class="muted">${t.ai ? 'AI draft' : `${esc(t.label)} template`} · edits here apply to this lead only · fields: ${TEMPLATE_FIELDS}</span></div>
          <div class="field"><label>Subject</label><input id="em-subj" value="${esc(d.subject)}"></div>
          <div class="field"><label>Message</label><textarea id="em-body">${esc(d.body)}</textarea></div>
          <div class="email-note">Sends as: <b>${esc(fillTemplate(d.subject, c))}</b></div>`;
        const store = () => { overrides[c.id] = { subject: $('#em-subj').value, body: $('#em-body').value }; $('.email-note b', prev).textContent = fillTemplate($('#em-subj').value, c); };
        $('#em-subj').addEventListener('input', store); $('#em-body').addEventListener('input', store);
      }
      rowsEl.addEventListener('click', e => {
        const cb = e.target.closest('[data-check]');
        if (cb) { cb.checked ? checked.add(cb.dataset.check) : checked.delete(cb.dataset.check); sel = cb.dataset.check; renderRows(); return; }
        const tr = e.target.closest('tr[data-id]'); if (tr) { sel = tr.dataset.id; renderRows(); }
      });
      $('#em-all').addEventListener('change', e => { visible().filter(emailable).forEach(c => e.target.checked ? checked.add(c.id) : checked.delete(c.id)); renderRows(); });
      if ($('#em-status')) $('#em-status').addEventListener('change', e => { statusFilter = e.target.value; visible().filter(emailable).forEach(c => checked.add(c.id)); renderRows(); });
      if ($('#em-due')) $('#em-due').addEventListener('change', e => { dueOnly = e.target.checked; renderRows(); });
      $('#em-templates').addEventListener('click', () => openTemplates(() => openEmailLeads(onlyIds)));
      $('[data-cancel]', body).addEventListener('click', closeModal);
      if ($('#em-copy')) $('#em-copy').addEventListener('click', () => {
        const addrs = visible().filter(c => checked.has(c.id)).map(c => c.email.trim());
        navigator.clipboard.writeText(addrs.join(', ')).then(() => toast(`Copied ${addrs.length} addresses`), () => prompt('Copy these addresses:', addrs.join(', ')));
      });
      if ($('#em-open')) $('#em-open').addEventListener('click', () => {
        const c = clientById(sel); if (!c || !emailable(c)) return;
        const d = draftFor(c, overrides);
        location.href = `mailto:${encodeURIComponent(c.email.trim())}?subject=${encodeURIComponent(fillTemplate(d.subject, c))}&body=${encodeURIComponent(fillTemplate(d.body, c))}`;
        markEmailed([c], $('#em-followup').checked, leadType(c).label); renderRows();
      });
      if ($('#em-ai')) $('#em-ai').addEventListener('click', async () => {
        const list = visible().filter(c => checked.has(c.id)); if (!list.length) return toast('Select the leads to analyze first');
        const btn = $('#em-ai'); btn.disabled = true; btn.textContent = `Analyzing ${list.length}…`;
        try {
          const payload = list.map(c => { const t = leadType(c); return { id: c.id, first: c.first, age: ageFromDob(c.dob), state: c.state, tobacco: c.tobacco, heightIn: c.height, weightLb: c.weight, health: c.health, notes: c.notes, source: c.source, status: c.status, followUp: c.followUp, createdAt: c.createdAt,
            policies: db.policies.filter(p => p.clientId === c.id).map(p => `${p.carrier} ${p.productType} ${money(p.face)} ${p.status}`), ruleType: t.ruleKey, ruleTemperature: t.ruleTemp }; });
          const templates = {}; Object.keys(LEAD_TYPES).forEach(k => templates[k] = tpl(k));
          const r = await api('/api/leads/analyze', { method: 'POST', body: JSON.stringify({ leads: payload, agent: db.settings.agentName, phone: db.settings.agentPhone, templates }) });
          r.results.forEach(x => { aiDrafts[x.id] = x; const c = clientById(x.id); if (c) { c.leadSummary = x.summary; delete overrides[x.id]; } });
          save(); toast(`Analyzed ${r.results.length} leads with ${r.model}`);
        } catch (e) { toast(e.message); }
        btn.disabled = false; btn.textContent = '✨ Analyze with AI'; renderRows();
      });
      if ($('#em-send')) $('#em-send').addEventListener('click', async () => {
        const list = visible().filter(c => checked.has(c.id) && emailable(c)); if (!list.length) return;
        if (list.length > 50 && !confirm(`Send ${list.length} emails now? Personal Gmail/Outlook accounts can flag large batches as spam; 50 or fewer per day is safer.`)) return;
        if (!confirm(`Send ${list.length === 1 ? 'this email' : list.length + ' personalized emails'} now?`)) return;
        sending = true; const btn = $('#em-send'); btn.disabled = true; btn.textContent = 'Sending…';
        try {
          const recipients = list.map(c => { const d = draftFor(c, overrides); return { id: c.id, email: c.email.trim(), first: c.first, last: c.last, subject: d.subject, body: d.body }; });
          const r = await api('/api/email/send', { method: 'POST', body: JSON.stringify({ recipients, agent: db.settings.agentName, phone: db.settings.agentPhone }) });
          const okIds = new Set(r.results.filter(x => x.ok).map(x => x.id));
          markEmailed(list.filter(c => okIds.has(c.id)), $('#em-followup').checked);
          const failed = r.results.filter(x => !x.ok);
          toast(failed.length ? `Sent ${r.sent}, ${failed.length} failed (${failed[0].error})` : `Sent ${r.sent} email${r.sent === 1 ? '' : 's'}`);
          if (!failed.length) { closeModal(); renderAll(); return; }
          failed.forEach(x => { const c = clientById(x.id); if (c) c.lastEmailError = x.error; });
        } catch (e) { toast(e.message); }
        sending = false; renderRows(); renderAll();
      });
      renderRows();
    });
  }
  function markEmailed(list, setFollowUp, labelOverride) {
    const d = new Date(); d.setDate(d.getDate() + 3); const fu = d.toISOString().slice(0, 10);
    list.forEach(c => {
      const t = leadType(c);
      c.lastEmailed = today(); c.lastEmailType = labelOverride || t.label; delete c.lastEmailError;
      if (setFollowUp && (!c.followUp || c.followUp < today())) c.followUp = fu;
      logActivity(`Emailed ${clientName(c)} (${t.label}, ${t.temp})`);
    });
    if (list.length) save();
  }
  function openTemplates(back) {
    const keys = Object.keys(LEAD_TYPES);
    openModal('Email templates', `
      <p class="muted">One template per lead type. Fields you can use: <code>${TEMPLATE_FIELDS}</code>. Your name and phone come from Settings. Leave a template as is to keep the built-in wording.</p>
      <form id="tpl-form">
        ${keys.map(k => { const t = tpl(k); return `<div class="field full" style="margin-bottom:12px"><label>${esc(LEAD_TYPES[k].label)}</label><input name="${k}_subject" value="${esc(t.subject)}" placeholder="Subject"><textarea name="${k}_body" style="margin-top:6px;min-height:120px">${esc(t.body)}</textarea></div>`; }).join('')}
        <div class="form-actions"><button type="button" class="btn btn-ghost btn-danger" id="tpl-reset">Reset all to built-in</button><div class="right"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn btn-primary">Save templates</button></div></div>
      </form>`, body => {
      const form = $('#tpl-form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form).entries()), out = {};
        keys.forEach(k => { const subject = d[k + '_subject'].trim(), bodyText = d[k + '_body'].trim(); if (subject !== DEFAULT_TEMPLATES[k].subject || bodyText !== DEFAULT_TEMPLATES[k].body) out[k] = { subject, body: bodyText }; });
        db.settings.emailTemplates = out; save(); toast('Templates saved'); closeModal(); if (back) back();
      });
      $('[data-cancel]', body).addEventListener('click', () => { closeModal(); if (back) back(); });
      $('#tpl-reset').addEventListener('click', () => { if (confirm('Reset every template to the built-in wording?')) { db.settings.emailTemplates = {}; save(); closeModal(); openTemplates(back); } });
    });
  }

  // ---------- navigation ----------
  function showTab(name) {
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    render(name);
    location.hash = name;
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) showTab(b.dataset.tab); });

  function render(name) {
    ({ dashboard: renderDashboard, clients: renderClients, policies: renderPolicies, money: renderMoney, bank: renderBank, cheatsheet: renderCheat }[name] || (() => {}))();
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
        <div class="field"><label>Your name (emails are signed with it)</label><input name="agentName" value="${esc(s.agentName)}"></div>
        <div class="field"><label>Your phone (goes under your name in emails)</label><input name="agentPhone" value="${esc(s.agentPhone)}" type="tel"></div>
        <div class="field full" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button type="button" class="btn btn-sm" data-action="email-templates">Edit email templates</button>
          <span class="muted">${remote ? `Sending: ${me.email ? 'ready (SMTP)' : 'not set up, add SMTP_* to .env'} · AI lead analysis: ${me.ai ? 'ready (' + esc(me.aiModel) + ')' : 'not set up, add ANTHROPIC_API_KEY to .env'}` : 'Run the portal server to send email from the app.'}</span></div>
        <div class="field"><label>Default commission % — Term Life</label><input name="r_term" type="number" step="0.5" value="${esc(s.rates['Term Life'])}"></div>
        <div class="field"><label>Default commission % — IUL</label><input name="r_iul" type="number" step="0.5" value="${esc(s.rates['IUL'])}"></div>
        <div class="field"><label>Default commission % — Whole Life</label><input name="r_whole" type="number" step="0.5" value="${esc(s.rates['Whole Life'])}"></div>
        <div class="field"><label>Default advance %</label><input name="advance" type="number" step="1" value="${esc(s.advance)}"></div>
        <div class="field"><label>Theme</label><select name="theme">${opts(['auto', 'light', 'dark'], s.theme || 'auto')}</select></div>
        <div class="field"><label>Danger zone</label><button type="button" class="btn btn-danger" id="wipe">Erase all data</button></div>
        ${remote ? `<div class="full" style="border-top:1px solid var(--border);padding-top:10px"><b>Change password</b> (signed in as ${esc(me.username)})</div>
        <div class="field"><label>Current password</label><input name="pw_cur" type="password" autocomplete="current-password"></div>
        <div class="field"><label>New password (10+ characters)</label><input name="pw_new" type="password" autocomplete="new-password"></div>` : ''}
        <div class="form-actions full"><div class="muted">Data is stored only in this browser. Use Backup regularly.</div><div class="right"><button type="button" class="btn" data-cancel>Cancel</button><button class="btn btn-primary">Save</button></div></div>
      </form>`, body => {
      const form = $('#settings-form');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form).entries());
        s.agentName = d.agentName; s.agentPhone = d.agentPhone || ''; s.rates = { 'Term Life': +d.r_term || 0, 'IUL': +d.r_iul || 0, 'Whole Life': +d.r_whole || 0 }; s.advance = +d.advance || 0; s.theme = d.theme;
        if (remote && d.pw_new) {
          try { await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ current: d.pw_cur, next: d.pw_new }) }); toast('Password changed'); }
          catch (err) { toast(err.message); return; }
        }
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
    if (a === 'email-leads') openEmailLeads(b.dataset.id ? [b.dataset.id] : null);
    if (a === 'email-templates') openTemplates();
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
    const h = c.height ? `${Math.floor(c.height / 12)}'${c.height % 12}"` : '', lt = leadType(c);
    el.innerHTML = `
      <div class="detail-head"><div><h2>${esc(clientName(c))}</h2>${pill(c.status)} <span class="muted">added ${fmtDate(c.createdAt)}</span></div>
        <div><button class="btn btn-sm" data-action="edit-client" data-id="${c.id}">Edit</button> <button class="btn btn-sm" data-action="email-leads" data-id="${c.id}" ${c.email ? '' : 'disabled title="No email address"'}>&#9993; Email</button> <button class="btn btn-sm btn-primary" data-action="quote-client" data-id="${c.id}">Quote</button></div></div>
      <dl class="kv">
        <dt>Lead type</dt><dd>${typePill(lt)} ${pill(lt.temp)}<br><span class="muted">${esc([...lt.why, ...lt.flags].join(' · '))}</span>${c.leadSummary ? `<div class="ai-summary">${esc(c.leadSummary)}</div>` : ''}</dd>
        <dt>Last emailed</dt><dd>${c.lastEmailed ? `${fmtDate(c.lastEmailed)}${c.lastEmailType ? ` <span class="muted">(${esc(c.lastEmailType)})</span>` : ''}` : '—'}${c.lastEmailError ? `<br><span style="color:var(--bad)">Last send failed: ${esc(c.lastEmailError)}</span>` : ''}</dd>
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
  (async function boot() {
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' });
      if (r.status === 401) { location.href = '/login'; return; }
      if (r.ok) { me = await r.json(); if (me.server) { remote = true; db = merge(await (await fetch('/api/data', { credentials: 'same-origin' })).json()); } }
    } catch (e) { /* opened as a plain file or static site: local mode */ }
    if (!remote) db = loadLocal();
    $('#tab-bank').hidden = !remote; $('#btn-logout').hidden = !remote;
    applyTheme();
    const start = (location.hash || '#dashboard').slice(1);
    showTab(['dashboard', 'clients', 'policies', 'money', 'bank', 'cheatsheet'].includes(start) ? start : 'dashboard');
  })();
  $('#btn-logout').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); location.href = '/login'; });

  // ---------- BANK (server mode only) ----------
  let bankData = null;
  async function renderBank() {
    if (!remote) { $('#bank-table').innerHTML = '<div class="empty">Bank tracking needs the server version (see README).</div>'; return; }
    try { bankData = await api('/api/bank'); } catch (e) { $('#bank-table').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    renderBankPlaid(); renderBankCsv(); renderBankTable(); renderBankRules();
  }
  function renderBankPlaid() {
    const p = bankData.plaid, el = $('#bank-plaid');
    if (!p.configured) {
      el.innerHTML = `<div class="card-head"><h2>Connect your bank automatically</h2></div>
        <p>Automatic bank sync uses <b>Plaid</b>, the same service most budgeting apps use. It is not set up yet.</p>
        <ol class="muted" style="padding-left:18px">
          <li>Create a free account at dashboard.plaid.com and copy your <b>client_id</b> and <b>sandbox secret</b>.</li>
          <li>Put them in the server's <code>.env</code> file as <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code>, then restart the server.</li>
          <li>Sandbox lets you test with a fake bank. Real banks need Plaid to approve your production access (they ask what the app is for).</li>
        </ol>
        <p class="muted">Until then, use the statement import on the right. It does the same matching.</p>`;
      return;
    }
    el.innerHTML = `<div class="card-head"><h2>Connected banks <span class="pill">${esc(p.env)}</span></h2><div><button class="btn btn-sm" id="plaid-sync" ${p.items.length ? '' : 'disabled'}>Sync now</button> <button class="btn btn-sm btn-primary" id="plaid-link">+ Connect a bank</button></div></div>
      ${p.items.length ? `<ul class="mini-list">${p.items.map(i => `<li><span><b>${esc(i.institution)}</b><br><span class="muted">${(i.accounts || []).map(a => esc(a.name) + ' ••' + esc(a.mask || '')).join(', ')}</span>${i.error ? `<br><span style="color:var(--bad)">${esc(i.error)}</span>` : ''}</span><span style="text-align:right"><span class="muted">${i.lastSync ? 'synced ' + fmtDate(i.lastSync.slice(0, 10)) : 'never synced'}</span><br><button class="btn btn-sm btn-ghost btn-danger" data-unlink="${esc(i.id)}">Remove</button></span></li>`).join('')}</ul>` : '<div class="muted">No bank connected yet. Click + Connect a bank.</div>'}`;
    $('#plaid-link').addEventListener('click', plaidLink);
    $('#plaid-sync').addEventListener('click', async () => { $('#plaid-sync').disabled = true; try { const r = await api('/api/plaid/sync', { method: 'POST' }); toast(`Synced: ${r.added} new, ${r.skipped} already known`); bankData = r.bank; renderBankPlaid(); renderBankTable(); } catch (e) { toast(e.message); $('#plaid-sync').disabled = false; } });
    $$('[data-unlink]', el).forEach(b => b.addEventListener('click', async () => { if (!confirm('Remove this bank connection? Imported transactions stay.')) return; const r = await api('/api/plaid/items/' + b.dataset.unlink, { method: 'DELETE' }); bankData = r.bank; renderBankPlaid(); }));
  }
  function plaidLink() {
    const go = async () => {
      try {
        const { link_token } = await api('/api/plaid/link-token', { method: 'POST' });
        const handler = window.Plaid.create({ token: link_token, onSuccess: async (public_token, meta) => {
          try { const r = await api('/api/plaid/exchange', { method: 'POST', body: JSON.stringify({ public_token, institution: meta.institution && meta.institution.name }) }); bankData = r.bank; renderBankPlaid(); toast('Bank connected — syncing…'); $('#plaid-sync').click(); } catch (e) { toast(e.message); }
        }, onExit: (err) => { if (err) toast(err.display_message || err.error_message || 'Plaid closed'); } });
        handler.open();
      } catch (e) { toast(e.message); }
    };
    if (window.Plaid) return go();
    const s = document.createElement('script'); s.src = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'; s.onload = go; s.onerror = () => toast('Could not load Plaid'); document.head.appendChild(s);
  }
  function renderBankCsv() {
    $('#bank-csv').innerHTML = `<div class="card-head"><h2>Import a bank statement (CSV)</h2></div>
      <p class="muted">Download transactions from your bank's website as CSV and drop the file here. Columns for date, description and amount are detected automatically; deposits should be positive numbers (or in a Credit column).</p>
      <input type="file" id="csv-file" accept=".csv,text/csv,.txt">
      <div id="csv-preview" style="margin-top:10px"></div>`;
    $('#csv-file').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const text = await f.text(); const rows = parseBankCsv(text);
      const el = $('#csv-preview');
      if (!rows.length) { el.innerHTML = '<div style="color:var(--bad)">Could not find date / description / amount columns in that file.</div>'; return; }
      const dep = rows.filter(r => r.amount > 0).length;
      el.innerHTML = `<div><b>${rows.length}</b> rows found, <b>${dep}</b> deposits. First rows:</div>
        <div class="table-scroll"><table class="data"><thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${rows.slice(0, 5).map(r => `<tr><td>${esc(r.date)}</td><td>${esc(r.description)}</td><td class="num">${money2(r.amount)}</td></tr>`).join('')}</tbody></table></div>
        <div style="margin-top:8px"><button class="btn btn-primary" id="csv-go">Import ${rows.length} rows</button> <span class="muted">Rows already imported are skipped.</span></div>`;
      $('#csv-go').addEventListener('click', async () => {
        try { const r = await api('/api/bank/import', { method: 'POST', body: JSON.stringify({ rows }) }); toast(`Imported ${r.added} new (${r.skipped} already known${r.invalid ? ', ' + r.invalid + ' unreadable' : ''})`); bankData = r.bank; el.innerHTML = ''; e.target.value = ''; renderBankTable(); }
        catch (err) { toast(err.message); }
      });
    });
  }
  // CSV parser that copes with quoted fields and the usual bank column names.
  function parseBankCsv(text) {
    const lines = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); if (row.some(x => x.trim())) lines.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field || row.length) { row.push(field); if (row.some(x => x.trim())) lines.push(row); }
    if (!lines.length) return [];
    const hdr = lines[0].map(h => h.trim().toLowerCase());
    const find = re => hdr.findIndex(h => re.test(h));
    let iDate = find(/^(posted |transaction |trans |post )?date$|date/), iDesc = find(/description|memo|payee|narrative|details|name|transaction$/), iAmt = find(/^amount$|amount/), iCr = find(/credit|deposit/), iDb = find(/debit|withdraw/), iAcct = find(/account/);
    const looksHeader = iDate >= 0 && (iAmt >= 0 || iCr >= 0 || iDb >= 0);
    let body = lines;
    if (looksHeader) body = lines.slice(1); else { iDate = 0; iDesc = 1; iAmt = 2; iCr = iDb = iAcct = -1; }
    if (iDesc < 0) iDesc = hdr.findIndex((h, i) => i !== iDate && i !== iAmt && i !== iCr && i !== iDb);
    const out = [];
    for (const r of body) {
      let amount = NaN;
      if (iAmt >= 0 && r[iAmt] !== undefined && r[iAmt].trim() !== '') amount = toNum(r[iAmt]);
      if (isNaN(amount) && (iCr >= 0 || iDb >= 0)) { const cr = iCr >= 0 ? toNum(r[iCr]) : NaN, db = iDb >= 0 ? toNum(r[iDb]) : NaN; amount = !isNaN(cr) && cr !== 0 ? Math.abs(cr) : !isNaN(db) ? -Math.abs(db) : NaN; }
      if (!isNaN(amount) && iAmt >= 0 && iDb >= 0 && iDb === iAmt) amount = -Math.abs(amount);
      out.push({ date: (r[iDate] || '').trim(), description: (r[iDesc] || '').trim(), amount, account: iAcct >= 0 ? (r[iAcct] || '').trim() : '' });
    }
    return out.filter(r => r.date && r.description && !isNaN(r.amount));
  }
  function toNum(s) { if (s == null) return NaN; s = String(s).trim().replace(/[$,\s]/g, ''); let neg = false; if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); } const n = parseFloat(s); return isNaN(n) ? NaN : (neg ? -n : n); }

  function renderBankTable() {
    const f = ui.bankFilter, el = $('#bank-table');
    $('#bank-filter').value = f;
    const all = bankData.transactions;
    const list = all.filter(t => f === 'all' ? true : f === 'ledgered' ? !!t.paymentId : f === 'unmatched' ? (t.amount > 0 && !t.carrier && !t.paymentId && !t.ignored) : (t.amount > 0 && t.carrier && !t.paymentId && !t.ignored));
    const matched = all.filter(t => t.amount > 0 && t.carrier && !t.paymentId && !t.ignored);
    $('#bank-add-all').disabled = !matched.length; $('#bank-add-all').textContent = `Add ${matched.length} matched deposit${matched.length === 1 ? '' : 's'} to ledger (${money(matched.reduce((s, t) => s + t.amount, 0))})`;
    if (!all.length) { el.innerHTML = '<div class="empty">Nothing imported yet. Connect a bank or import a CSV statement above.</div>'; return; }
    if (!list.length) { el.innerHTML = '<div class="empty">Nothing in this view.</div>'; return; }
    el.innerHTML = `<div class="table-scroll"><table class="data"><thead><tr><th>Date</th><th>Description</th><th>Account</th><th class="num">Amount</th><th>Carrier</th><th></th></tr></thead><tbody>${list.map(t => `<tr data-id="${esc(t.id)}" style="cursor:default">
      <td>${fmtDate(t.date)}</td><td>${esc(t.description)}<br><span class="muted">${esc(t.source)}${t.ignored ? ' · ignored' : ''}</span></td><td>${esc(t.account || '')}</td><td class="num" style="color:${t.amount < 0 ? 'var(--bad)' : 'inherit'}">${money2(t.amount)}</td>
      <td>${t.paymentId ? pill(t.carrier || 'Other') : `<select data-carrier>${opts(CARRIERS, t.carrier, '— no match —')}</select>${t.auto ? '<br><span class="muted">auto-matched</span>' : ''}`}</td>
      <td style="white-space:nowrap">${t.paymentId ? '<span class="pill s-paid">in ledger</span>' : `<button class="btn btn-sm btn-primary" data-ledger ${t.carrier ? '' : 'disabled title="Pick a carrier first"'}>Add to ledger</button> <button class="btn btn-sm btn-ghost" data-ignore>${t.ignored ? 'Unignore' : 'Ignore'}</button>`}</td></tr>`).join('')}</tbody></table></div>`;
    $$('tr[data-id]', el).forEach(tr => {
      const id = tr.dataset.id;
      const sel = $('[data-carrier]', tr); if (sel) sel.addEventListener('change', async () => { const r = await api('/api/bank/transactions/' + id, { method: 'POST', body: JSON.stringify({ carrier: sel.value }) }); Object.assign(bankData.transactions.find(t => t.id === id), r.transaction); renderBankTable(); });
      const lg = $('[data-ledger]', tr); if (lg) lg.addEventListener('click', () => addToLedger([id]));
      const ig = $('[data-ignore]', tr); if (ig) ig.addEventListener('click', async () => { const t = bankData.transactions.find(x => x.id === id); const r = await api('/api/bank/transactions/' + id, { method: 'POST', body: JSON.stringify({ ignored: !t.ignored }) }); Object.assign(t, r.transaction); renderBankTable(); });
    });
  }
  async function addToLedger(ids) {
    try {
      const r = await api('/api/bank/ledger', { method: 'POST', body: JSON.stringify({ ids }) });
      db = merge(r.data); bankData = r.bank; renderBankTable(); toast(`Added ${r.added} payment${r.added === 1 ? '' : 's'} to the Money ledger`);
    } catch (e) { toast(e.message); }
  }
  $('#bank-filter').addEventListener('change', e => { ui.bankFilter = e.target.value; renderBankTable(); });
  $('#bank-add-all').addEventListener('click', () => addToLedger(bankData.transactions.filter(t => t.amount > 0 && t.carrier && !t.paymentId && !t.ignored).map(t => t.id)));
  function renderBankRules() {
    const el = $('#bank-rules');
    const rows = bankData.rules.map((r, i) => `<tr><td><input data-pat value="${esc(r.pattern)}" style="width:100%;font-family:monospace"></td><td><select data-car>${opts(CARRIERS, r.carrier)}</select></td><td><button class="btn btn-sm btn-ghost btn-danger" data-rm="${i}">✕</button></td></tr>`).join('');
    el.innerHTML = `<div class="table-scroll"><table class="data" id="rules-table"><thead><tr><th>Pattern (matches bank description)</th><th>Carrier</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="rule-add">+ Rule</button><button class="btn btn-primary" id="rule-save">Save rules & re-match</button></div>`;
    $$('[data-rm]', el).forEach(b => b.addEventListener('click', () => { bankData.rules.splice(+b.dataset.rm, 1); renderBankRules(); }));
    $('#rule-add').addEventListener('click', () => { bankData.rules.push({ pattern: '', carrier: 'Other' }); renderBankRules(); });
    $('#rule-save').addEventListener('click', async () => {
      const rules = $$('#rules-table tbody tr').map(tr => ({ pattern: $('[data-pat]', tr).value.trim(), carrier: $('[data-car]', tr).value })).filter(r => r.pattern);
      try { const r = await api('/api/bank/rules', { method: 'PUT', body: JSON.stringify({ rules }) }); bankData = r.bank; toast(`Rules saved, ${r.rematched} transaction${r.rematched === 1 ? '' : 's'} re-matched`); renderBankRules(); renderBankTable(); } catch (e) { toast(e.message); }
    });
  }
})();
