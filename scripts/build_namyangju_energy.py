"""Join Gyeonggi building geometry and EAIS usage by exact parcel identifier."""
import argparse
import csv
import json
from pathlib import Path
from struct import unpack, unpack_from
from pyproj import Transformer

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--usage', type=Path, required=True)
    parser.add_argument('--electricity', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    payload = json.loads(args.usage.read_text())
    usage = {tuple(r[:4]): r[4:] for r in payload['rows']}
    names = {}
    with args.electricity.open(encoding='utf-8-sig', newline='') as f:
        for row in csv.reader(f, delimiter='|'):
            if len(row) >= 10 and row[2] == '41360':
                names[row[3]] = row[6]
    transform = Transformer.from_crs(5186, 4326, always_xy=True)
    selected = {}
    for dbf_path in sorted(args.source.glob('*.dbf')):
        with dbf_path.open('rb') as dbf, dbf_path.with_suffix('.shp').open('rb') as shp, dbf_path.with_suffix('.shx').open('rb') as shx:
            count, header, size = unpack_from('<IHH', dbf.read(32), 4)
            dbf.seek(header); shx.seek(100)
            for _ in range(count):
                row = dbf.read(size); index = shx.read(8)
                pnu = row[38:57].decode('ascii', 'ignore')
                if not pnu.startswith('41360') or len(pnu) != 19 or not pnu.isdigit() or pnu[10] not in '12': continue
                key = (pnu[5:10], str(int(pnu[10])-1), pnu[11:15], pnu[15:19])
                if key not in usage or row.startswith(b'*'): continue
                offset, words = unpack('>2i', index)
                shp.seek(offset*2+8); shape=shp.read(words*2)
                if len(shape)<44 or unpack_from('<i',shape)[0] not in (5,15,25): continue
                x1,y1,x2,y2=unpack_from('<4d',shape,4)
                lng,lat=transform.transform((x1+x2)/2,(y1+y2)/2)
                if not (126.95 < lng < 127.55 and 37.45 < lat < 37.90): continue
                area=(x2-x1)*(y2-y1)
                if key not in selected or area>selected[key][0]: selected[key]=(area,lat,lng)
    rows=[]
    for key, (_,lat,lng) in sorted(selected.items()):
        dong, mountain, bun, ji=key
        number=('산' if mountain=='1' else '')+str(int(bun))+(('-'+str(int(ji))) if int(ji) else '')
        rows.append({'addr':f"경기도 남양주시 {names.get(dong,'')} {number}", 'lat':lat,'lng':lng,'type':'건물','etc':'', 'elec':usage[key][0], 'gas':usage[key][1], 'ym':payload['ym'], 'sigunguCd':'41360','bjdongCd':dong,'platGbCd':mountain,'bun':bun,'ji':ji})
    args.output.write_text(json.dumps(rows,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'source':len(usage),'mapped':len(rows),'unmapped':len(usage)-len(rows),'elec':sum(r['elec'] is not None for r in rows),'gas':sum(r['gas'] is not None for r in rows)},ensure_ascii=False))

if __name__ == '__main__': main()
