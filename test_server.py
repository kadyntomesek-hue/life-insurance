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

# ---- email + lead analysis ----
s, j, _, _ = call('GET', '/api/me'); check(j['email'] is False and j['ai'] is False, 'email/ai off by default')
s, j, _, _ = call('POST', '/api/email/send', {'recipients': [{'id': 'c1', 'email': 'a@b.co'}], 'subject': 'x', 'body': 'y'}); check(s == 400 and 'not set up' in j['error'], 'smtp unconfigured message')
s, j, _, _ = call('POST', '/api/leads/analyze', {'leads': [{'id': 'c1'}]}); check(s == 400 and 'ANTHROPIC_API_KEY' in j['error'], 'ai unconfigured message')
check(server.fill_template('Hi {first} {Name}, - {agent} {phone}', server.recipient_fields({'first': 'Jane', 'last': 'Doe'}, 'Kadyn', '555')) == 'Hi Jane Jane Doe, - Kadyn 555', 'template fill')
check(server.fill_template('Hi {first}', server.recipient_fields({}, 'K', '')) == 'Hi there', 'template fallback name')

sent = []


class FakeSMTP:
    def __init__(self, host, port, timeout=None):
        sent.append(('connect', host, port))
    def starttls(self): sent.append(('starttls',))
    def login(self, u, p): sent.append(('login', u, p))
    def send_message(self, msg):
        if msg['To'].endswith('refuse.me>') or msg['To'].endswith('refuse.me'):
            raise server.smtplib.SMTPRecipientsRefused({})
        sent.append(('send', msg['To'], msg['Subject'], msg.get_content()))
    def quit(self): sent.append(('quit',))


os.environ.update({'SMTP_HOST': 'smtp.test', 'SMTP_PORT': '587', 'SMTP_USER': 'me@test.com', 'SMTP_PASS': 'pw', 'SMTP_FROM': 'me@test.com', 'SMTP_FROM_NAME': 'Kadyn'})
real_smtp = server.smtplib.SMTP
server.smtplib.SMTP = FakeSMTP
try:
    s, j, _, _ = call('GET', '/api/me'); check(j['email'] is True, 'email on when configured')
    s, j, _, _ = call('POST', '/api/email/send', {'recipients': [], 'subject': 'x', 'body': 'y'}); check(s == 400, 'needs recipients')
    s, j, _, _ = call('POST', '/api/email/send', {'recipients': [{'id': 'c1', 'email': 'a@b.co'}], 'subject': '', 'body': 'y'}); check(s == 400, 'needs subject')
    s, j, _, _ = call('POST', '/api/email/send', {'agent': 'Kadyn', 'phone': '555-1234', 'subject': 'Hi {first}', 'body': 'Dear {name},\n{agent}\n{phone}', 'recipients': [
        {'id': 'c1', 'email': 'jane@example.com', 'first': 'Jane', 'last': 'Doe'},
        {'id': 'c2', 'email': 'bob@example.com', 'first': 'Bob', 'subject': 'Own subject {first}', 'body': 'Own body for {first}'},
        {'id': 'c3', 'email': 'not-an-email'},
        {'id': 'c4', 'email': 'x@refuse.me', 'first': 'X'}]})
    check(s == 200 and j['sent'] == 2 and j['failed'] == 2, 'send counts %r' % j)
    res = {r['id']: r for r in j['results']}
    check(res['c3']['error'] == 'Invalid email address' and 'refused' in res['c4']['error'], 'per-recipient errors')
    sends = [x for x in sent if x[0] == 'send']
    check(sends[0][1] == 'Jane Doe <jane@example.com>' and sends[0][2] == 'Hi Jane' and sends[0][3].strip() == 'Dear Jane Doe,\nKadyn\n555-1234', 'personalised message %r' % (sends[0],))
    check(sends[1][2] == 'Own subject Bob' and sends[1][3].strip() == 'Own body for Bob', 'per-recipient subject/body')
    check(sent.count(('connect', 'smtp.test', 587)) == 1 and ('starttls',) in sent and ('login', 'me@test.com', 'pw') in sent and ('quit',) in sent, 'one connection, starttls, login, quit')
    s, j, _, _ = call('POST', '/api/email/test', {}); check(s == 200 and j['to'] == 'me@test.com', 'test email to self')
finally:
    server.smtplib.SMTP = real_smtp

# AI analysis with a fake Claude API
captured = []


def fake_ai_messages(payload):
    captured.append(payload)
    leads = json.loads(payload['messages'][0]['content'].split('\n\n', 1)[1])['leads']
    return {'model': payload['model'], 'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': json.dumps({'leads': [
        {'id': l['id'], 'type': 'finalexpense' if (l.get('age') or 0) >= 60 else 'term', 'temperature': 'Hot', 'summary': 'sum ' + l['id'], 'subject': 'S {first}', 'body': 'B {first} {agent} {phone}'} for l in leads]})}]}


os.environ['ANTHROPIC_API_KEY'] = 'sk-test'
real_ai = server.ai_messages
server.ai_messages = fake_ai_messages
try:
    s, j, _, _ = call('GET', '/api/me'); check(j['ai'] is True and j['aiModel'] == 'claude-opus-5-5', 'ai on when configured')
    leads = [{'id': 'c%d' % i, 'first': 'P%d' % i, 'age': 70 if i % 2 else 35, 'notes': 'n', 'health': ''} for i in range(15)]
    s, j, _, _ = call('POST', '/api/leads/analyze', {'leads': leads, 'agent': 'Kadyn', 'phone': '555', 'templates': {'term': {'subject': 'a', 'body': 'b'}}})
    check(s == 200 and len(j['results']) == 15 and j['model'] == 'claude-opus-5-5', 'analyze result %r' % (j if s != 200 else len(j['results'])))
    check(len(captured) == 2, 'batched into 2 requests, got %d' % len(captured))
    check(captured[0]['output_config']['format']['type'] == 'json_schema' and captured[0]['fallbacks'] == 'default' and 'thinking' not in captured[0], 'request shape')
    check(j['results'][1]['type'] == 'finalexpense' and j['results'][0]['type'] == 'term' and j['results'][0]['id'] == 'c0', 'results aligned by id')
    server.ai_messages = lambda payload: {'stop_reason': 'refusal', 'stop_details': {'explanation': 'nope'}, 'content': []}
    s, j, _, _ = call('POST', '/api/leads/analyze', {'leads': leads[:1]}); check(s == 502 and 'declined' in j['error'], 'refusal surfaced')
finally:
    server.ai_messages = real_ai
    del os.environ['ANTHROPIC_API_KEY']

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
