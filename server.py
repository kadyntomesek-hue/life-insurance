#!/usr/bin/env python3
"""Life Insurance CRM server: single-owner login, server-side data, bank deposit tracking.

Standard library only. Run:  python server.py   then open http://localhost:3000
"""
import base64
import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------- .env
def load_env():
    try:
        with open(os.path.join(ROOT, '.env'), encoding='utf-8') as f:
            for line in f:
                m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$', line)
                if m and m.group(1) not in os.environ:
                    os.environ[m.group(1)] = m.group(2).strip('"\'')
    except OSError:
        pass


load_env()
PORT = int(os.environ.get('PORT') or 3000)
HOST = os.environ.get('HOST') or '0.0.0.0'
DATA_DIR = os.path.abspath(os.environ.get('DATA_DIR') or os.path.join(ROOT, 'data'))
SESSION_HOURS = float(os.environ.get('SESSION_HOURS') or 12)
COOKIE_SECURE = (os.environ.get('COOKIE_SECURE') or '').lower() == 'true'


# ---------------------------------------------------------------- store
_lock = threading.RLock()


def _file(name):
    return os.path.join(DATA_DIR, name + '.json')


def read(name, default):
    with _lock:
        try:
            with open(_file(name), encoding='utf-8') as f:
                return json.load(f)
        except (OSError, ValueError):
            return default() if callable(default) else default


def write(name, value):
    with _lock:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = _file(name) + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(value, f, indent=1)
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, _file(name))


def get_or_create_secret():
    if os.environ.get('SESSION_SECRET'):
        return os.environ['SESSION_SECRET'].encode()
    os.makedirs(DATA_DIR, exist_ok=True)
    p = os.path.join(DATA_DIR, 'secret.key')
    try:
        with open(p, encoding='utf-8') as f:
            return f.read().strip().encode()
    except OSError:
        s = secrets.token_urlsafe(48)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(s)
        try:
            os.chmod(p, 0o600)
        except OSError:
            pass
        return s.encode()


SECRET = get_or_create_secret()


def default_crm():
    return {'clients': [], 'policies': [], 'payments': [], 'activity': [],
            'settings': {'agentName': '', 'rates': {'Term Life': 80, 'IUL': 90, 'Whole Life': 100}, 'advance': 75, 'theme': 'auto'}}


def default_bank():
    return {'rules': [dict(r) for r in DEFAULT_RULES], 'transactions': [], 'items': []}


def crm():
    d = default_crm()
    d.update(read('crm', {}))
    return d


def bank_db():
    d = default_bank()
    d.update(read('bank', {}))
    return d


def users():
    return read('users', [])


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def uid():
    return format(int(time.time() * 1000), 'x') + secrets.token_hex(3)


# ---------------------------------------------------------------- passwords & sessions
def hash_password(pw):
    salt = secrets.token_bytes(16)
    h = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 600000)
    return 'pbkdf2$' + salt.hex() + '$' + h.hex()


def check_password(pw, stored):
    try:
        _, salt, h = stored.split('$')
        calc = hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt), 600000)
        return hmac.compare_digest(calc.hex(), h)
    except (ValueError, AttributeError):
        return False


def sign_session(payload):
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')
    sig = hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()
    return body + '.' + sig


def verify_session(token):
    try:
        body, sig = token.split('.')
        if not hmac.compare_digest(hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest(), sig):
            return None
        payload = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
        if payload.get('exp', 0) < time.time():
            return None
        return payload
    except (ValueError, TypeError):
        return None


_attempts = {}  # ip -> [count, locked_until]


# ---------------------------------------------------------------- bank matching
DEFAULT_RULES = [
    {'pattern': r'AMERICO', 'carrier': 'Americo'},
    {'pattern': r'MUTUAL OF OMAHA|UNITED OF OMAHA|MUT(UAL)? ?OF ?OMAHA|MUTUALOFOMAHA', 'carrier': 'Mutual of Omaha'},
    {'pattern': r'TRANSAMERICA|TRANS ?AMERICA', 'carrier': 'Transamerica'},
    {'pattern': r'FIDELITY LIFE|FIDELITY SECURITY|FIDELITYLIFE', 'carrier': 'Fidelity Life'},
    {'pattern': r'COREBRIDGE|AMERICAN GENERAL|AMER(ICAN)? GEN(ERAL)?|\bAGL\b|\bAIG\b', 'carrier': 'Corebridge / AGL'},
    {'pattern': r'AETNA|ACCENDO|CONTINENTAL LIFE|\bCVS\b', 'carrier': 'Aetna / Accendo'},
    {'pattern': r'FORESTERS', 'carrier': 'Foresters'},
    {'pattern': r'PROSPERITY|S\.? ?USA LIFE|SUSA LIFE', 'carrier': 'Prosperity'},
    {'pattern': r'AMERICAN.?AMICABLE|AMER.?AMICABLE|OCCIDENTAL LIFE|PIONEER AMERICAN|PIONEER SECURITY', 'carrier': 'American-Amicable'},
    {'pattern': r'ETHOS', 'carrier': 'Ethos'},
    {'pattern': r'NATIONAL LIFE|\bNLG\b|LIFE INS(URANCE)? CO(MPANY)? OF THE SOUTHWEST|\bLSW\b', 'carrier': 'National Life Group'},
]


def match_carrier(description, rules):
    d = str(description or '')
    for r in rules or []:
        try:
            if re.search(r['pattern'], d, re.I):
                return r['carrier']
        except re.error:
            continue
    return ''


def normalize_date(s):
    s = str(s or '').strip()
    m = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})', s)
    if m:
        return '%s-%02d-%02d' % (m.group(1), int(m.group(2)), int(m.group(3)))
    m = re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})', s)
    if m:
        y = m.group(3) if len(m.group(3)) == 4 else '20' + m.group(3)
        return '%s-%02d-%02d' % (y, int(m.group(1)), int(m.group(2)))
    for fmt in ('%d %b %Y', '%b %d, %Y', '%B %d, %Y', '%d-%b-%Y', '%Y%m%d'):
        try:
            return datetime.strptime(s, fmt).strftime('%Y-%m-%d')
        except ValueError:
            pass
    return ''


def normalize_amount(v):
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r'[$,\s]', '', str(v or ''))
    neg = False
    if s.startswith('(') and s.endswith(')'):
        neg, s = True, s[1:-1]
    if s.endswith('-'):
        neg, s = True, s[:-1]
    try:
        n = float(s)
    except ValueError:
        return None
    return -n if neg else n


def tx_id(t):
    key = '|'.join([t['date'], str(t['description']).strip().lower(), '%.2f' % t['amount'], t.get('account') or ''])
    return hashlib.sha1(key.encode()).hexdigest()[:16]


def normalize_rows(rows, source):
    out = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        date, amount, desc = normalize_date(r.get('date')), normalize_amount(r.get('amount')), str(r.get('description') or '').strip()
        if not date or amount is None or not desc:
            continue
        t = {'date': date, 'description': desc, 'amount': round(amount, 2), 'account': str(r.get('account') or ''), 'source': source}
        if r.get('plaidId'):
            t['plaidId'] = r['plaidId']
        t['id'] = tx_id(t)
        out.append(t)
    return out


def merge_transactions(existing, incoming, rules):
    seen = {t['id'] for t in existing}
    added = skipped = 0
    for t in incoming:
        if t['id'] in seen:
            skipped += 1
            continue
        seen.add(t['id'])
        t['carrier'] = match_carrier(t['description'], rules)
        t['auto'] = bool(t['carrier'])
        t['importedAt'] = now_iso()
        existing.append(t)
        added += 1
    return added, skipped


def rematch(transactions, rules):
    changed = 0
    for t in transactions:
        if t.get('manual'):
            continue
        c = match_carrier(t['description'], rules)
        if c != (t.get('carrier') or ''):
            t['carrier'], t['auto'] = c, bool(c)
            changed += 1
    return changed


# ---------------------------------------------------------------- plaid (REST, no SDK)
class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def plaid_configured():
    return bool(os.environ.get('PLAID_CLIENT_ID') and os.environ.get('PLAID_SECRET'))


def plaid_env():
    return (os.environ.get('PLAID_ENV') or 'sandbox').lower()


def plaid(path, body):
    if not plaid_configured():
        raise ApiError(400, 'Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET to .env')
    payload = dict(body, client_id=os.environ['PLAID_CLIENT_ID'], secret=os.environ['PLAID_SECRET'])
    req = urllib.request.Request('https://%s.plaid.com%s' % (plaid_env(), path), data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get('error_message') or str(e)
        except ValueError:
            msg = str(e)
        raise ApiError(502, 'Plaid: ' + msg)
    except urllib.error.URLError as e:
        raise ApiError(502, 'Could not reach Plaid: %s' % e.reason)


def plaid_sync(item):
    added, cursor, has_more = [], item.get('cursor') or None, True
    while has_more:
        body = {'access_token': item['token'], 'count': 500}
        if cursor:
            body['cursor'] = cursor
        r = plaid('/transactions/sync', body)
        for t in r.get('added', []):
            if t.get('pending'):
                continue
            # Plaid: positive = money leaving the account. Ours: positive = deposit.
            added.append({'date': t['date'], 'description': t.get('merchant_name') or t.get('name'), 'amount': -float(t['amount']),
                          'account': t.get('account_id'), 'plaidId': t.get('transaction_id')})
        has_more, cursor = r.get('has_more'), r.get('next_cursor')
    return added, cursor


def public_bank(b):
    txs = sorted(b['transactions'], key=lambda t: (t.get('date') or '', t.get('importedAt') or ''), reverse=True)
    return {'rules': b['rules'], 'transactions': txs,
            'plaid': {'configured': plaid_configured(), 'env': plaid_env(),
                      'items': [{'id': i['id'], 'institution': i.get('institution'), 'accounts': i.get('accounts', []),
                                 'lastSync': i.get('lastSync'), 'error': i.get('error')} for i in b['items']]}}


# ---------------------------------------------------------------- HTTP handler
class Handler(BaseHTTPRequestHandler):
    server_version = 'LifeCRM/1.0'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        if os.environ.get('LOG'):
            sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

    # --- helpers ---
    def _ip(self):
        fwd = self.headers.get('X-Forwarded-For')
        return (fwd.split(',')[0].strip() if fwd and os.environ.get('TRUST_PROXY') else self.client_address[0])

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 20 * 1024 * 1024:
            raise ApiError(413, 'Too large')
        raw = self.rfile.read(n) if n else b''
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except ValueError:
            raise ApiError(400, 'Bad JSON')

    def _send(self, status, body=b'', ctype='application/json', extra=None):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'same-origin')
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _json(self, obj, status=200, extra=None):
        self._send(status, json.dumps(obj).encode(), 'application/json', extra)

    def _redirect(self, to):
        self._send(302, b'', 'text/plain', [('Location', to)])

    def _file(self, rel):
        path = os.path.normpath(os.path.join(ROOT, rel))
        if not path.startswith(ROOT) or not os.path.isfile(path):
            return self._send(404, b'Not found', 'text/plain')
        with open(path, 'rb') as f:
            data = f.read()
        ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        if ctype.startswith('text/') or ctype.endswith('javascript'):
            ctype += '; charset=utf-8'
        self._send(200, data, ctype)

    def _cookie(self, value, max_age):
        c = 'licrm=%s; Path=/; HttpOnly; SameSite=Lax; Max-Age=%d' % (value, max_age)
        if COOKIE_SECURE:
            c += '; Secure'
        return ('Set-Cookie', c)

    def _session(self):
        raw = self.headers.get('Cookie')
        if not raw:
            return None
        c = cookies.SimpleCookie()
        try:
            c.load(raw)
        except cookies.CookieError:
            return None
        if 'licrm' not in c:
            return None
        s = verify_session(c['licrm'].value)
        if not s or not any(u['id'] == s.get('uid') for u in users()):
            return None
        return s

    def _login_cookie(self, user):
        return self._cookie(sign_session({'uid': user['id'], 'exp': time.time() + SESSION_HOURS * 3600}), int(SESSION_HOURS * 3600))

    # --- dispatch ---
    def do_GET(self):
        self._route('GET')

    def do_POST(self):
        self._route('POST')

    def do_PUT(self):
        self._route('PUT')

    def do_DELETE(self):
        self._route('DELETE')

    def do_HEAD(self):
        self._route('GET')

    def _route(self, method):
        path = urlparse(self.path).path
        try:
            self._handle(method, path)
        except ApiError as e:
            self._json({'error': str(e)}, e.status)
        except Exception as e:  # noqa
            sys.stderr.write('ERROR %s %s: %r\n' % (method, path, e))
            self._json({'error': 'Server error'}, 500)

    def _handle(self, method, path):
        # ---- public ----
        if path == '/api/auth/status' and method == 'GET':
            s, u = self._session(), users()
            name = next((x['username'] for x in u if s and x['id'] == s['uid']), None)
            return self._json({'setupNeeded': not u, 'loggedIn': bool(s), 'username': name})
        if path == '/api/auth/setup' and method == 'POST':
            if users():
                raise ApiError(403, 'An account already exists. Sign in instead.')
            b = self._body()
            username, password = str(b.get('username') or '').strip(), str(b.get('password') or '')
            if len(username) < 3:
                raise ApiError(400, 'Username must be at least 3 characters')
            if len(password) < 10:
                raise ApiError(400, 'Password must be at least 10 characters')
            u = {'id': uid(), 'username': username, 'hash': hash_password(password), 'createdAt': now_iso()}
            write('users', [u])
            return self._json({'ok': True, 'username': username}, 200, [self._login_cookie(u)])
        if path == '/api/auth/login' and method == 'POST':
            ip = self._ip()
            a = _attempts.get(ip)
            if a and a[1] > time.time():
                raise ApiError(429, 'Too many attempts. Try again in %d min.' % max(1, int((a[1] - time.time()) / 60 + 0.999)))
            b = self._body()
            username, password = str(b.get('username') or '').strip().lower(), str(b.get('password') or '')
            u = next((x for x in users() if x['username'].lower() == username), None)
            if not u or not check_password(password, u['hash']):
                a = _attempts.setdefault(ip, [0, 0])
                a[0] += 1
                if a[0] >= 5:
                    a[0], a[1] = 0, time.time() + 15 * 60
                raise ApiError(401, 'Wrong username or password')
            _attempts.pop(ip, None)
            return self._json({'ok': True, 'username': u['username']}, 200, [self._login_cookie(u)])
        if path == '/api/auth/logout' and method == 'POST':
            return self._json({'ok': True}, 200, [self._cookie('', 0)])
        if path == '/login' and method == 'GET':
            return self._file('login.html')
        if path.startswith('/css/') and method == 'GET':
            return self._file(path.lstrip('/'))

        # ---- everything below needs a login ----
        s = self._session()
        if not s:
            if path.startswith('/api/') or path.startswith('/js/'):
                raise ApiError(401, 'Please sign in')
            return self._redirect('/login')
        me = next(x for x in users() if x['id'] == s['uid'])

        if path in ('/', '/index.html') and method == 'GET':
            return self._file('index.html')
        if path.startswith('/js/') and method == 'GET':
            return self._file(path.lstrip('/'))
        if path == '/api/me' and method == 'GET':
            return self._json({'server': True, 'username': me['username'], 'plaid': plaid_configured()})
        if path == '/api/auth/password' and method == 'POST':
            b = self._body()
            if not check_password(str(b.get('current') or ''), me['hash']):
                raise ApiError(400, 'Current password is wrong')
            if len(str(b.get('next') or '')) < 10:
                raise ApiError(400, 'New password must be at least 10 characters')
            lst = users()
            next(x for x in lst if x['id'] == me['id'])['hash'] = hash_password(str(b['next']))
            write('users', lst)
            return self._json({'ok': True})

        # ---- CRM data ----
        if path == '/api/data' and method == 'GET':
            return self._json(crm())
        if path == '/api/data' and method == 'PUT':
            d = self._body()
            for k in ('clients', 'policies', 'payments', 'activity'):
                if not isinstance(d.get(k), list):
                    raise ApiError(400, '%s must be an array' % k)
            if not isinstance(d.get('settings'), dict):
                raise ApiError(400, 'settings missing')
            clean = {k: d[k] for k in ('clients', 'policies', 'payments', 'settings')}
            clean['activity'] = d['activity'][:300]
            clean['savedAt'] = now_iso()
            write('crm', clean)
            return self._json({'ok': True, 'savedAt': clean['savedAt']})

        # ---- bank ----
        if path == '/api/bank' and method == 'GET':
            return self._json(public_bank(bank_db()))
        if path == '/api/bank/rules' and method == 'PUT':
            rules = [{'pattern': str(r['pattern']), 'carrier': str(r['carrier'])} for r in self._body().get('rules', []) if isinstance(r, dict) and r.get('pattern') and r.get('carrier')]
            for r in rules:
                try:
                    re.compile(r['pattern'], re.I)
                except re.error:
                    raise ApiError(400, 'Bad pattern: ' + r['pattern'])
            b = bank_db()
            b['rules'] = rules
            n = rematch(b['transactions'], rules)
            write('bank', b)
            return self._json({'ok': True, 'rematched': n, 'bank': public_bank(b)})
        if path == '/api/bank/import' and method == 'POST':
            raw = self._body().get('rows') or []
            rows = normalize_rows(raw, 'csv')
            b = bank_db()
            added, skipped = merge_transactions(b['transactions'], rows, b['rules'])
            write('bank', b)
            return self._json({'ok': True, 'added': added, 'skipped': skipped, 'invalid': len(raw) - len(rows), 'bank': public_bank(b)})
        m = re.match(r'^/api/bank/transactions/([A-Za-z0-9]+)$', path)
        if m and method in ('POST', 'DELETE'):
            b = bank_db()
            t = next((x for x in b['transactions'] if x['id'] == m.group(1)), None)
            if method == 'DELETE':
                b['transactions'] = [x for x in b['transactions'] if x['id'] != m.group(1)]
                write('bank', b)
                return self._json({'ok': True})
            if not t:
                raise ApiError(404, 'Not found')
            body = self._body()
            if 'carrier' in body:
                t['carrier'], t['manual'], t['auto'] = str(body.get('carrier') or ''), True, False
            if 'ignored' in body:
                t['ignored'] = bool(body['ignored'])
            write('bank', b)
            return self._json({'ok': True, 'transaction': t})
        if path == '/api/bank/clear' and method == 'POST':
            b = bank_db()
            n = len(b['transactions'])
            b['transactions'] = [t for t in b['transactions'] if t.get('paymentId')]
            write('bank', b)
            return self._json({'ok': True, 'removed': n - len(b['transactions'])})
        if path == '/api/bank/ledger' and method == 'POST':
            body = self._body()
            ids = set(body.get('ids') or [])
            b, c, added = bank_db(), crm(), 0
            for t in b['transactions']:
                if t['id'] not in ids or t.get('paymentId') or t.get('ignored'):
                    continue
                p = {'id': uid(), 'date': t['date'], 'amount': t['amount'],
                     'type': 'Chargeback' if t['amount'] < 0 else (body.get('type') or 'Commission advance'),
                     'carrier': t.get('carrier') or 'Other', 'policyId': '', 'note': 'Bank: ' + t['description'], 'bankTxId': t['id']}
                c['payments'].append(p)
                t['paymentId'] = p['id']
                added += 1
                c['activity'].insert(0, {'t': now_iso(), 'text': 'Logged %s$%.2f %s from %s (bank import)' % ('-' if p['amount'] < 0 else '', abs(p['amount']), p['type'], p['carrier'])})
            c['activity'] = c['activity'][:300]
            write('bank', b)
            write('crm', c)
            return self._json({'ok': True, 'added': added, 'data': c, 'bank': public_bank(b)})

        # ---- plaid ----
        if path == '/api/plaid/status' and method == 'GET':
            return self._json({'configured': plaid_configured(), 'env': plaid_env()})
        if path == '/api/plaid/link-token' and method == 'POST':
            body = {'user': {'client_user_id': me['id']}, 'client_name': 'Life Insurance CRM', 'products': ['transactions'],
                    'transactions': {'days_requested': 365}, 'country_codes': [os.environ.get('PLAID_COUNTRY') or 'US'], 'language': 'en'}
            if os.environ.get('PLAID_REDIRECT_URI'):
                body['redirect_uri'] = os.environ['PLAID_REDIRECT_URI']
            return self._json({'link_token': plaid('/link/token/create', body)['link_token']})
        if path == '/api/plaid/exchange' and method == 'POST':
            body = self._body()
            r = plaid('/item/public_token/exchange', {'public_token': body.get('public_token')})
            accts = plaid('/accounts/get', {'access_token': r['access_token']})['accounts']
            b = bank_db()
            b['items'].append({'id': r['item_id'], 'institution': body.get('institution') or 'Bank', 'token': r['access_token'],
                               'accounts': [{'id': a['account_id'], 'name': a.get('name'), 'mask': a.get('mask'), 'type': a.get('subtype') or a.get('type')} for a in accts],
                               'cursor': '', 'lastSync': None, 'addedAt': now_iso()})
            write('bank', b)
            return self._json({'ok': True, 'bank': public_bank(b)})
        if path == '/api/plaid/sync' and method == 'POST':
            b, added, skipped = bank_db(), 0, 0
            for item in b['items']:
                try:
                    rows, cursor = plaid_sync(item)
                    names = {a['id']: '%s ••%s' % (a.get('name'), a.get('mask') or '') for a in item.get('accounts', [])}
                    for r in rows:
                        r['account'] = names.get(r['account'], r['account'])
                    a, s_ = merge_transactions(b['transactions'], normalize_rows(rows, 'plaid'), b['rules'])
                    added, skipped = added + a, skipped + s_
                    item['cursor'], item['lastSync'], item['error'] = cursor, now_iso(), None
                except ApiError as e:
                    item['error'] = str(e)
            write('bank', b)
            return self._json({'ok': True, 'added': added, 'skipped': skipped, 'bank': public_bank(b)})
        m = re.match(r'^/api/plaid/items/([^/]+)$', path)
        if m and method == 'DELETE':
            b = bank_db()
            item = next((i for i in b['items'] if i['id'] == m.group(1)), None)
            if item:
                try:
                    plaid('/item/remove', {'access_token': item['token']})
                except ApiError:
                    pass
                b['items'] = [i for i in b['items'] if i is not item]
                write('bank', b)
            return self._json({'ok': True, 'bank': public_bank(b)})

        raise ApiError(404, 'Not found')


def serve(host=HOST, port=PORT):
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    return httpd


if __name__ == '__main__':
    httpd = serve()
    shown = 'localhost' if HOST in ('0.0.0.0', '') else HOST
    print('Life Insurance CRM running at http://%s:%d   (data in %s, Plaid %s)' % (shown, httpd.server_address[1], DATA_DIR, plaid_env() if plaid_configured() else 'not configured'))
    if not users():
        print('No login yet - open the address above to create yours.')
    print('Press Ctrl+C to stop.')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
