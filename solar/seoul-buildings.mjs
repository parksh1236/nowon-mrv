const directory = new URL('./data/seoul-buildings-20260715/', import.meta.url);
const tileCache = new Map();
let indexRequest;

async function readJson(url, fetcher) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error('서울 건물 GIS 자료 조회 실패');
  return response.json();
}

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
  }
  return inside;
}

function ringArea(ring) {
  const [x0, y0] = ring[0];
  return Math.abs(ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length];
    return sum + (x - x0) * (ny - y0) - (nx - x0) * (y - y0);
  }, 0));
}

export function matchSeoulBuilding(rows, { lon, lat }) {
  const x = lon * 1_000_000, y = lat * 1_000_000;
  let match, smallest = Infinity;
  for (const row of rows) {
    const rings = row[14].filter(ring => ringContains(ring, x, y));
    if (rings.length % 2 !== 1) continue;
    for (const ring of rings) {
      const area = ringArea(ring);
      if (area >= smallest) continue;
      match = { row, ring };
      smallest = area;
    }
  }
  if (!match) return null;
  const [id, pnu, name, dong, use, structure, height, above, below, area, total, approval, district, date] = match.row;
  return {
    type: 'Feature',
    properties: {
      bldrgst_pk: id, pnu, bld_nm: name, dong_nm: dong, main_purps_cd_nm: use, structure,
      height, grnd_flr: above, ugrnd_flr: below, area, total, approval, district, date,
      source: 'seoul-building-gis',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[...match.ring, match.ring[0]].map(([x, y]) => [x / 1_000_000, y / 1_000_000])],
    },
  };
}

export async function lookupSeoulBuilding(position, fetcher = fetch) {
  const tile = `${Math.floor(position.lon * 100)}-${Math.floor(position.lat * 100)}`;
  indexRequest ??= readJson(new URL('index.json', directory), fetcher)
    .then(keys => new Set(keys))
    .catch(error => { indexRequest = undefined; throw error; });
  if (!(await indexRequest).has(tile)) return null;
  if (!tileCache.has(tile)) {
    tileCache.set(tile, readJson(new URL(`${tile}.json`, directory), fetcher)
      .catch(error => { tileCache.delete(tile); throw error; }));
    if (tileCache.size > 12) tileCache.delete(tileCache.keys().next().value);
  }
  return matchSeoulBuilding(await tileCache.get(tile), position);
}
