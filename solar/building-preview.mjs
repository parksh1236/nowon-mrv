import { normalizeParcel } from '../usage-details.mjs';
import { localOffset } from './solar-core.mjs';

const titleEndpoint = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo';

export function buildingParcel(properties = {}) {
  for (const value of [properties.bldg_pnu, properties.pnu, properties.bd_mgt_sn]) {
    const id = String(value ?? '').trim();
    if (!/^\d{10}[12]\d{8}(?:\d{6})?$/.test(id)) continue;
    const parcel = normalizeParcel({
      sigunguCd: id.slice(0, 5), bjdongCd: id.slice(5, 10),
      platGbCd: id[10] === '2' ? '1' : '0', bun: id.slice(11, 15), ji: id.slice(15, 19),
    });
    if (parcel) return parcel;
  }
  return null;
}

export async function lookupBuildingTitle(parcel, properties, key, fetcher = fetch) {
  const url = new URL(titleEndpoint);
  url.search = new URLSearchParams({ ...parcel, serviceKey: key, _type: 'json', numOfRows: '100', pageNo: '1' });
  const res = await fetcher(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('건축물대장 조회 실패');
  const { header, body } = (await res.json()).response ?? {};
  if (!['0', '00'].includes(String(header?.resultCode)) || !body) throw new Error('건축물대장 응답 오류');
  const total = Number(body.totalCount);
  if (total === 0) return { status: '자료 없음' };
  const raw = body.items?.item;
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!rows.length) throw new Error('건축물대장 응답 오류');
  const pk = String(properties.bldrgst_pk ?? '').trim();
  const dong = String(properties.dong_nm ?? '').replace(/\s/g, '');
  const byPk = pk && rows.find(row => String(row.mgmBldrgstPk ?? '').trim() === pk);
  if (byPk) return { row: byPk, status: '건축물대장 표제부' };
  if (total === 1 && rows.length === 1) return { row: rows[0], status: '건축물대장 표제부' };
  const byDong = dong ? rows.filter(row => String(row.dongNm ?? '').replace(/\s/g, '') === dong) : [];
  const row = total === rows.length && byDong.length === 1 ? byDong[0] : null;
  return row ? { row, status: '건축물대장 표제부' } : { status: '같은 필지의 여러 동 중 일치하는 표제부를 확인하지 못했습니다.' };
}

export function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// Project the building's extruded footprint into a rotatable, standalone SVG.
export function drawBuildingPreview(svg, footprint, height, floorCount, angle) {
  const points = footprint.map(point => {
    const { east, north } = localOffset(footprint[0], point);
    return [east, north];
  });
  const area = points.reduce((sum, [x, y], i) => {
    const [nextX, nextY] = points[(i + 1) % points.length];
    return sum + x * nextY - y * nextX;
  }, 0);
  if (area < 0) points.reverse();

  const edges = points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    return { a, b, i, width: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
  const entrance = edges.reduce((best, wall) => wall.width > best.width ? wall : best);
  const heading = Math.atan2(entrance.b[1] - entrance.a[1], entrance.a[0] - entrance.b[0]) + 0.55 + angle;
  const c = Math.cos(heading), s = Math.sin(heading);
  const depth = ([x, y]) => x * s + y * c;
  // The camera faces back toward the footprint from the positive depth axis.
  const project = ([x, y], z) => [y * s - x * c, depth([x, y]) * 0.46 - z * 0.89];
  const base = points.map(point => project(point, 0));
  const roof = points.map(point => project(point, height));
  const bounds = [...base, ...roof];
  const xs = bounds.map(point => point[0]), ys = bounds.map(point => point[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  const scale = Math.min(340 / (Math.max(...xs) - left), 172 / (Math.max(...ys) - top));
  const originX = 190 - (Math.max(...xs) - left) * scale / 2;
  const originY = 106 - (Math.max(...ys) - top) * scale / 2;
  function shape(vertices, fill, stroke) {
    const node = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    node.setAttribute('points', vertices.map(([x, y]) =>
      `${originX + (x - left) * scale},${originY + (y - top) * scale}`).join(' '));
    node.setAttribute('fill', fill);
    if (stroke) node.setAttribute('stroke', stroke);
    svg.append(node);
  }

  svg.replaceChildren();
  const walls = edges.filter(({ i }) => base[(i + 1) % points.length][0] > base[i][0])
    .sort((a, b) => depth(a.a) + depth(a.b) - depth(b.a) - depth(b.b));
  const floors = Math.min(60, Math.max(1, Math.round(floorCount || height / 3)));
  const story = height / floors;
  for (const wall of walls) {
    const { a, b, i, width } = wall;
    const next = (i + 1) % points.length;
    shape([base[i], base[next], roof[next], roof[i]], i % 2 ? '#b9c9ba' : '#e1e9dc', '#758a7c');
    if (width < 1) continue;
    const face = (t, z) => project([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], z);
    const panel = (from, to, bottom, upper, color, stroke) =>
      shape([face(from, bottom), face(to, bottom), face(to, upper), face(from, upper)], color, stroke);
    const columns = Math.min(24, Math.max(1, Math.floor(width / (wall === entrance ? 2.8 : 3.5))));
    const doorColumn = Math.floor(columns / 2);
    const bay = (column, offset) => (column + offset) / columns;
    const glazed = (from, to, bottom, upper, color, dividerHeight) => {
      panel(from, to, bottom, upper, color, '#344f58');
      const middle = (from + to) / 2;
      const frame = (to - from) * 0.025;
      panel(middle - frame, middle + frame, bottom, upper, '#b7c8cc');
      if (dividerHeight) {
        const trim = (upper - bottom) * 0.02;
        panel(from, to, dividerHeight - trim, dividerHeight + trim, '#b7c8cc');
      }
    };
    for (let floor = 0; floor < floors; floor += 1) {
      const level = story * floor;
      if (floor) panel(0, 1, level, level + story * 0.04, '#9baca0');
      for (let column = 0; column < columns; column += 1) {
        if (wall === entrance && floor === 0 && column === doorColumn) {
          panel(bay(column, 0.1), bay(column, 0.9), 0, story * 0.91, '#758a7c');
          glazed(bay(column, 0.19), bay(column, 0.81), 0, story * 0.84, '#324d46', story * 0.65);
        } else {
          const inset = wall === entrance ? 0.16 : 0.27;
          const bottom = level + story * 0.31;
          const top = level + story * 0.8;
          glazed(bay(column, inset), bay(column, 1 - inset), bottom, top, '#45748a', top - story * 0.11);
          panel(bay(column, inset - 0.04), bay(column, 1 - inset + 0.04), bottom - story * 0.04, bottom, '#edf3ee');
        }
      }
    }
  }
  shape(roof, '#dcebdd', '#758a7c');
  return heading;
}
