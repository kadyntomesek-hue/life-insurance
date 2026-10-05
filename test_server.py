#!/usr/bin/env python3
"""Smoke test for server.py: setup -> login -> data -> bank import -> ledger -> logout.  Run: python test_server.py"""
import json
import os
import sys
import tempfile
import threading
import urllib.error
import urllib.request

os.environ['DATA_DIR'] = tempfile.mkdtemp(prefix='licrm-test-')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server  # noqa: E402

httpd = server.serve('127.0.0.1', 0)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % httpd.server_address[1]
cookie = ''


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


opener = urllib.request.build_opener(NoRedirect)


def call(method, path, body=None):
    global cookie
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={'Content-Type': 'application/json', 'Cookie': cookie})
    try:
        r = opener.open(req)
    except urllib.error.HTTPError as e:
        r = e
    sc = r.headers.get('Set-Cookie')
    if sc:
        cookie = sc.split(';')[0]
    raw = r.read()
    try:
        j = json.loads(raw)
    except ValueError:
        j = None
    return r.status if hasattr(r, 'status') else r.code, j, raw, r.headers.get('Location')


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


s, j, _, _ = call('GET', '/api/auth/status'); check(j['setupNeeded'], 'fresh install needs setup')
s, _, _, loc = call('GET', '/'); check(s == 302 and loc == '/login', 'index redirects to login when signed out')
s, _, _, _ = call('GET', '/api/data'); check(s == 401, 'api locked when signed out')
s, _, _, _ = call('GET', '/js/guides-data.js'); check(s == 401, 'guide data locked when signed out')
s, _, _, _ = call('POST', '/api/auth/setup', {'username': 'kadyn', 'password': 'short'}); check(s == 400, 'rejects short password')
s, _, _, _ = call('POST', '/api/auth/setup', {'username': 'kadyn', 'password': 'correct horse battery'}); check(s == 200, 'setup ok')
s, _, _, _ = call('POST', '/api/auth/setup', {'username': 'other', 'password': 'correct horse battery'}); check(s == 403, 'second account refused')
s, j, _, _ = call('GET', '/api/me'); check(j['username'] == 'kadyn', 'me')
s, _, raw, _ = call('GET', '/'); check(s == 200 and b'Quote Cheat Sheet' in raw, 'index served when signed in')
s, _, _, _ = call('GET', '/js/guides-data.js'); check(s == 200, 'guide data served when signed in')
s, _, _, _ = call('GET', '/../server.py'); check(s in (404, 401, 302), 'no path traversal')

s, d, _, _ = call('GET', '/api/data'); check(d['clients'] == [], 'empty data')
d['clients'].append({'id': 'c1', 'first': 'Jane', 'status': 'Client'})
s, _, _, _ = call('PUT', '/api/data', d); check(s == 200, 'save data')
s, d, _, _ = call('GET', '/api/data'); check(d['clients'][0]['first'] == 'Jane', 'data persisted')
s, _, _, _ = call('PUT', '/api/data', {'clients': 'nope'}); check(s == 400, 'validates shape')

s, j, _, _ = call('POST', '/api/bank/import', {'rows': [
    {'date': '09/28/2026', 'description': 'ACH DEPOSIT MUTUAL OF OMAHA COMM 123', 'amount': '832.50'},
    {'date': '2026-09-30', 'description': 'AMERICO FIN LIFE ACH', 'amount': '$1,204.10'},
    {'date': '2026-10-01', 'description': 'STARBUCKS', 'amount': '(5.25)'},
    {'date': '2026-10-01', 'description': 'ZELLE FROM BOB', 'amount': '100'},
    {'date': 'garbage', 'description': 'x', 'amount': '1'}]})
check(j['added'] == 4 and j['invalid'] == 1, 'import counts %r' % j)
tx = j['bank']['transactions']
by = lambda word: next(t for t in tx if word in t['description'])  # noqa: E731
check(by('OMAHA')['carrier'] == 'Mutual of Omaha', 'omaha matched')
check(by('AMERICO')['carrier'] == 'Americo', 'americo matched')
check(by('STARBUCKS')['amount'] == -5.25, 'parenthesis negative')
check(by('ZELLE')['carrier'] == '', 'zelle unmatched')
s, j, _, _ = call('POST', '/api/bank/import', {'rows': [{'date': '09/28/2026', 'description': 'ACH DEPOSIT MUTUAL OF OMAHA COMM 123', 'amount': '832.50'}]})
check(j['added'] == 0 and j['skipped'] == 1, 'duplicates skipped')
z = by('ZELLE')
s, j, _, _ = call('POST', '/api/bank/transactions/' + z['id'], {'carrier': 'Ethos'}); check(j['transaction']['manual'], 'manual carrier')
s, _, _, _ = call('PUT', '/api/bank/rules', {'rules': [{'pattern': '[', 'carrier': 'Ethos'}]}); check(s == 400, 'bad regex rejected')
s, j, _, _ = call('PUT', '/api/bank/rules', {'rules': server.DEFAULT_RULES + [{'pattern': 'ZELLE', 'carrier': 'Other'}]}); check(s == 200 and j['rematched'] == 0, 'manual carrier kept on rematch')
ids = [t['id'] for t in tx if t['amount'] > 0 and t['carrier']] + [z['id']]
s, j, _, _ = call('POST', '/api/bank/ledger', {'ids': ids}); check(j['added'] == 3, 'ledgered 3, got %r' % j['added'])
check(next(p for p in j['data']['payments'] if p['carrier'] == 'Mutual of Omaha')['amount'] == 832.5, 'payment amount')
s, j, _, _ = call('POST', '/api/bank/ledger', {'ids': ids}); check(j['added'] == 0, 'not ledgered twice')
s, d, _, _ = call('GET', '/api/data'); check(len(d['payments']) == 3, 'payments in crm data')
s, j, _, _ = call('POST', '/api/plaid/link-token'); check(s == 400 and 'not configured' in j['error'], 'plaid unconfigured message')

s, _, _, _ = call('POST', '/api/auth/password', {'current': 'wrong', 'next': 'another long password'}); check(s == 400, 'wrong current pw')
s, _, _, _ = call('POST', '/api/auth/password', {'current': 'correct horse battery', 'next': 'another long password'}); check(s == 200, 'password changed')
call('POST', '/api/auth/logout'); cookie = ''
s, _, _, _ = call('GET', '/api/data'); check(s == 401, 'logged out')
s, _, _, _ = call('POST', '/api/auth/login', {'username': 'KADYN', 'password': 'another long password'}); check(s == 200, 'login new password, case-insensitive')
cookie = ''
for _ in range(5):
    call('POST', '/api/auth/login', {'username': 'kadyn', 'password': 'bad'})
s, _, _, _ = call('POST', '/api/auth/login', {'username': 'kadyn', 'password': 'another long password'}); check(s == 429, 'locked out after 5 failures')

httpd.shutdown()
print('server tests passed')
