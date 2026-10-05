#!/usr/bin/env python3
"""Parse the two underwriting-guide PDFs (bbox html + rasters) into JSON."""
import re, json, sys, os, html, math
from collections import defaultdict

S = os.path.dirname(os.path.abspath(__file__))
SCALE = 1.0  # pdf points -> pixels at 72 dpi

def load_pages(path):
    txt = open(path, encoding='utf-8').read()
    pages = []
    for pm in re.finditer(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', txt, re.S):
        words, blocks = [], []
        for bm in re.finditer(r'<block xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</block>', pm.group(3), re.S):
            lines = []
            for lm in re.finditer(r'<line[^>]*>(.*?)</line>', bm.group(5), re.S):
                lw = []
                for wm in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>', lm.group(1), re.S):
                    w = dict(x0=float(wm.group(1)), y0=float(wm.group(2)), x1=float(wm.group(3)), y1=float(wm.group(4)), t=html.unescape(wm.group(5)))
                    words.append(w); lw.append(w['t'])
                lines.append(' '.join(lw))
            blocks.append(dict(x0=float(bm.group(1)), y0=float(bm.group(2)), x1=float(bm.group(3)), y1=float(bm.group(4)), text=' '.join(lines), lines=lines))
        pages.append(dict(words=words, blocks=blocks))
    return pages

def load_ppm(path):
    data = open(path, 'rb').read()
    parts = data.split(b'\n', 3)
    w, h = map(int, parts[1].split())
    return w, h, parts[3]

def sample(ppm, x, y):
    w, h, pix = ppm
    px = min(w - 1, max(0, int(x * SCALE)))
    py = min(h - 1, max(0, int(y * SCALE)))
    i = (py * w + px) * 3
    return tuple(pix[i:i + 3])

LEGEND_KEYS = ['green', 'blue', 'orange', 'yellow', 'purple', 'red']
LEGEND_WORDS = ['Level', 'Modified', 'GI', 'Check', 'See', 'DECLINE']

def legend_colors(page, ppm):
    cols = {}
    for b in page['blocks']:
        if 85 < b['y0'] < 110:
            first = b['text'].split()[0]
            if first in LEGEND_WORDS:
                cols[LEGEND_KEYS[LEGEND_WORDS.index(first)]] = sample(ppm, b['x0'] - 9, (b['y0'] + b['y1']) / 2)
    return cols

def nearest(c, legend):
    best, bd = None, 1e9
    for k, v in legend.items():
        d = sum((a - b) ** 2 for a, b in zip(c, v))
        if d < bd:
            best, bd = k, d
    return best, math.sqrt(bd)

def cell_color(ppm, legend, x, y, cell_left):
    """Sample just left of / above the first word (inside the cell padding); take the first confident hit."""
    cands = [(x - 4, y + 5), (x - 3, y + 9), (x + 2, y - 2), (x - 5, y + 2), (x - 2, y + 12)]
    results = []
    for cx, cy in cands:
        k, d = nearest(sample(ppm, cx, cy), legend)
        if d < 25:
            return k, d
        results.append((d, k))
    results.sort()
    return results[0][1], results[0][0]

def cluster(vals, tol=12):
    vals = sorted(vals)
    groups = []
    for v in vals:
        if groups and v - groups[-1][-1] <= tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    return [min(g) for g in groups]

def words_to_text(ws):
    """Order words into lines by y then x and join."""
    ws = sorted(ws, key=lambda w: (round(w['y0']), w['x0']))
    lines, cur, cy = [], [], None
    for w in ws:
        if cy is None or abs(w['y0'] - cy) > 3:
            if cur: lines.append(cur)
            cur, cy = [w], w['y0']
        else:
            cur.append(w)
    if cur: lines.append(cur)
    out = []
    for ln in lines:
        s = ' '.join(w['t'] for w in sorted(ln, key=lambda w: w['x0']))
        if out and out[-1].endswith('-') and not out[-1].endswith(' -'):
            out[-1] = out[-1] + s   # rejoin hyphenated wraps: "day-" + "one" -> "day-one", "fully-" + "UW" -> "fully-UW"
        else:
            out.append(s)
    return ' '.join(out)

def parse_guide(prefix, grid_pages, products):
    pages = load_pages(os.path.join(S, prefix + '.html'))
    ppms = {i: load_ppm(os.path.join(S, '%s-%02d.ppm' % (prefix, i + 1))) for i in range(len(pages))}
    legend = legend_colors(pages[0], ppms[0])
    print(prefix, 'legend', legend, file=sys.stderr)
    carriers = None
    rows = []
    for pi in grid_pages:
        page, ppm = pages[pi], ppms[pi]
        blocks, words = page['blocks'], page['words']
        hdr = [b for b in blocks if b['text'].startswith('ILLNESS')]
        if not hdr:
            continue
        hy0, hy1 = hdr[0]['y0'], hdr[0]['y1']
        header_blocks = sorted([b for b in blocks if abs(b['y0'] - hy0) < 4 and b is not hdr[0]], key=lambda b: b['x0'])
        if carriers is None:
            names = [b['lines'][0] for b in header_blocks]
            carriers = [dict(name=n, product=p) for n, p in zip(names, products)]
        end_y = min([b['y0'] for b in blocks if b['text'].startswith('BUILD / HEIGHT')] + [1e9])
        body = [w for w in words if w['y0'] > hy1 + 2 and w['y0'] < end_y]
        cc = [(b['x0'] + b['x1']) / 2 for b in header_blocks]
        W = sorted(cc[i + 1] - cc[i] for i in range(len(cc) - 1))[len(cc) // 2]
        bounds = [cc[0] - W / 2] + [(cc[i] + cc[i + 1]) / 2 for i in range(len(cc) - 1)]
        edges = [hdr[0]['x0'] - 5] + bounds
        ncol = len(carriers) + 1
        def col_of(x):
            return sum(1 for b in bounds if x >= b)
        # condition words = column 0; group into rows by y gaps
        cw = sorted([w for w in body if col_of(w['x0']) == 0], key=lambda w: w['y0'])
        conds = []
        for w in cw:
            if conds and w['y0'] - conds[-1]['y1'] < 8:
                conds[-1]['words'].append(w); conds[-1]['y1'] = max(conds[-1]['y1'], w['y1'])
            else:
                conds.append(dict(y0=w['y0'], y1=w['y1'], words=[w]))
        for ci, c in enumerate(conds):
            y_top = c['y0'] - 3
            y_bot = conds[ci + 1]['y0'] - 3 if ci + 1 < len(conds) else end_y
            cells = defaultdict(list)
            for w in body:
                col = col_of(w['x0'])
                if col and y_top <= w['y0'] < y_bot:
                    cells[col].append(w)
            row = dict(condition=words_to_text(c['words']), cells=[])
            for col in range(1, ncol):
                ws = cells.get(col, [])
                text = words_to_text(ws) if ws else ''
                first = min(ws, key=lambda w: (round(w['y0']), w['x0'])) if ws else None
                px, py = (first['x0'], first['y0']) if first else (edges[col] + 6, c['y0'])
                color, dist = cell_color(ppm, legend, px, py, edges[col])
                if dist > 60:
                    print('low confidence color', row['condition'], col, color, dist, file=sys.stderr)
                row['cells'].append(dict(text=text, color=color))
            rows.append(row)
    return carriers, rows, pages

def top_cards(pages):
    page = pages[0]
    blocks = page['blocks']
    hdr = [b for b in blocks if b['text'].startswith('ILLNESS')][0]
    cand = [b for b in blocks if 110 < b['y0'] < hdr['y0']]
    abbrs = [b for b in cand if re.fullmatch(r'[A-Z]{2,4}', b['text'])]
    cards = []
    for a in abbrs:
        items = [b for b in cand if b is not a and a['y0'] - 8 <= b['y0'] <= a['y0'] + 70 and a['x0'] <= b['x0'] <= a['x0'] + 380]
        lines = []
        for b in sorted(items, key=lambda b: (b['y0'], b['x0'])):
            lines.extend(b['lines'])
        cards.append(dict(abbr=a['text'], name=lines[0], product=lines[1], notes=lines[2:]))
    return cards

def is_title(l):
    return bool(re.match(r'^\s*[A-Z]{2,4} [A-Z]', l)) and not l.strip().startswith('NO HEIGHT')

def build_charts(txt_path):
    lines = open(txt_path, encoding='utf-8').read().replace('\f', '').split('\n')
    start = next(i for i, l in enumerate(lines) if l.startswith('BUILD / HEIGHT'))
    end = next(i for i, l in enumerate(lines) if l.startswith('PRODUCT NOTES'))
    seg = lines[start + 1:end]
    charts = []
    i = 0
    while i < len(seg):
        l = seg[i]
        if is_title(l):
            titles = [(m.start(), m.group().strip()) for m in re.finditer(r'\S.*?(?=\s{6,}|$)', l)]
            note_line = seg[i + 1] if i + 1 < len(seg) else ''
            j = i + 2
            while j < len(seg) and 'Ht' not in seg[j]:
                j += 1
            header_line = seg[j]
            k = j + 1
            data = []
            while k < len(seg) and not is_title(seg[k]):
                if seg[k].strip():
                    data.append(seg[k])
                elif data and k + 1 < len(seg) and not seg[k + 1].strip():
                    break
                k += 1
            starts = [t[0] for t in titles] + [10 ** 6]
            for ti, (st, title) in enumerate(titles):
                a, b = st, starts[ti + 1]
                def sub(line):
                    return line[max(0, a - 2):b - 2] if len(line) > a - 2 else ''
                note = sub(note_line).strip()
                hdr = [h for h in re.split(r'\s{2,}', sub(header_line).strip()) if h]
                rows = []
                for d in data:
                    s = [h for h in re.split(r'\s{2,}', sub(d).strip()) if h]
                    if s and (re.match(r"^\d'\d+\"$", s[0]) or s[0] in ('Prime', 'Spectrum', 'Select', 'DECLINE')):
                        rows.append(s)
                if not rows:
                    extra = ' '.join(sub(d).strip() for d in data if sub(d).strip())
                    note = (note + ' ' + extra).strip()
                    hdr = []
                abbr, name = title.split(' ', 1)
                charts.append(dict(abbr=abbr, title=name, note=note, headers=hdr, rows=rows))
            i = k
        else:
            i += 1
    return charts

def product_notes(pages):
    notes = []
    started = False
    for page in pages:
        for b in page['blocks']:
            t = b['text'].strip()
            if t.startswith('PRODUCT NOTES'):
                started = True; continue
            if not started or not t:
                continue
            m = re.match(r'^([^:]{3,70}):\s+(.*)$', t, re.S)
            if m and not notes or (m and b['x0'] < 60 and m.group(1)[0].isupper()):
                notes.append(dict(title=m.group(1).strip(), text=m.group(2).strip()))
            elif notes:
                notes[-1]['text'] += ' ' + t
    return notes

WL_PRODUCTS = ['Eagle Select', 'Living Promise', 'FE Express Solution', 'RAPIDecision FE', 'SimpliNow Legacy', 'Final Expense', 'PlanRight', 'New Vista', 'Senior Choice']
TERM_PRODUCTS = ['HMS / Instant Decision Term', 'TLE / GULE / IULE', 'FFIUL II Express (IUL)', 'TruStage Term', 'Family Freedom Term', 'Term Made Simple', 'Intelligent Choice (IUL)', 'RapidProtect (IUL)']

def main():
    out = {}
    for prefix, grid_pages, label, products in [('wl', range(0, 10), 'whole', WL_PRODUCTS), ('term', range(0, 7), 'term', TERM_PRODUCTS)]:
        carriers, rows, pages = parse_guide(prefix, grid_pages, products)
        cards = top_cards(pages)
        charts = build_charts(os.path.join(S, prefix + '.txt'))
        notes = product_notes(pages)
        title = pages[0]['blocks'][0]['text']
        subtitle = pages[0]['blocks'][1]['text']
        out[label] = dict(title=title, subtitle=subtitle, carriers=carriers, cards=cards, rows=rows, charts=charts, notes=notes)
        print(label, len(carriers), 'carriers', len(rows), 'rows', len(cards), 'cards', len(charts), 'charts', len(notes), 'notes', file=sys.stderr)
    json.dump(out, open(os.path.join(S, 'guides.json'), 'w'), indent=1, ensure_ascii=False)

if __name__ == '__main__':
    main()
