"""Fill missing parcel purpose using unambiguous uploaded building GIS records."""
import json
import struct
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

files = [Path('data/energy') / (code + '.json') for code in ('11350', '11740', '11305', '41360', '41460', '41310')]
datasets = {path: json.loads(path.read_text(encoding='utf-8')) for path in files}
def key(row):
    return row['sigunguCd'] + row['bjdongCd'] + str(int(row['platGbCd']) + 1) + row['bun'] + row['ji']
wanted = {key(row) for rows in datasets.values() for row in rows}
purposes = defaultdict(set)
for archive in sys.argv[1:]:
    with zipfile.ZipFile(archive) as z:
        for name in (n for n in z.namelist() if n.lower().endswith('.dbf')):
            with z.open(name) as f:
                header = f.read(32)
                header_size, row_size = struct.unpack('<HH', header[8:12])
                descriptors = f.read(header_size - 32)
                fields = [(descriptors[i:i+11].split(b'\0')[0].decode('ascii'), descriptors[i+16]) for i in range(0, len(descriptors)-32, 32)]
                offsets = {}; pos = 1
                for field, width in fields:
                    offsets[field] = (pos, pos + width); pos += width
                while row := f.read(row_size):
                    a, b = offsets['A2']; pnu = row[a:b].strip().decode('ascii', 'ignore')
                    if pnu not in wanted: continue
                    a, b = offsets['A9']; purpose = row[a:b].strip(b' \0').decode('euc-kr', 'replace').strip()
                    if purpose and '\ufffd' not in purpose: purposes[pnu].add(purpose)
for path, rows in datasets.items():
    matched = filled = ambiguous = 0
    for row in rows:
        values = purposes.get(key(row), set())
        if values: matched += 1
        if len(values) > 1: ambiguous += 1
        if len(values) == 1 and (not row.get('type') or row['type'] == '용도정보 없음'):
            row['type'] = next(iter(values)); filled += 1
    path.write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(path.name, 'matched', matched, 'filled', filled, 'ambiguous', ambiguous, flush=True)
