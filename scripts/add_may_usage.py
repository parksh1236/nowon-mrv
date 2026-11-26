"""Attach May usage to the six existing regional map datasets by exact parcel."""
import json
import sys
from collections import defaultdict
from pathlib import Path

files = [Path('data/energy') / (code + '.json') for code in
         ('11350', '11740', '11305', '41460', '41310', '41360')]
datasets = {p: json.loads(p.read_text(encoding='utf8')) for p in files}

def key(r):
    return (r['sigunguCd'], r['bjdongCd'], r['platGbCd'], r['bun'], r['ji'])

wanted = {key(r) for rows in datasets.values() for r in rows}
series = []
for filename in sys.argv[1:]:
    totals = defaultdict(int)
    with open(filename, encoding='utf-8-sig') as f:
        for line in f:
            a = line.rstrip('\r\n').split('|')
            if len(a) < 17 or a[0] != '202605':
                continue
            k = (a[2], a[3], a[7], a[8].zfill(4), a[9].zfill(4))
            if k in wanted and a[16].strip().isdigit():
                totals[k] += int(a[16])
    if not totals:
        raise ValueError('No matching May rows: ' + filename)
    series.append(totals)
elec, gas = series
for path, rows in datasets.items():
    count = 0
    for r in rows:
        k = key(r)
        count += k in elec or k in gas
        rest = [h for h in r.get('history', []) if h['ym'] != '202605']
        r['history'] = rest + [dict(ym='202605', elec=elec.get(k), gas=gas.get(k))]
    print(path.stem, count, '/', len(rows))
    path.write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
