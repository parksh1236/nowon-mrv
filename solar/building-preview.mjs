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

export function createBuildingDesign() {
  return { masses: [], window: { widthM: 1.5, heightM: 1.4 }, door: { widthM: 1.1, heightM: 2.1 } };
}

export function addBuildingMass(design, values = {}) {
  const mass = {
    id: `mass-${Date.now()}-${design.masses.length + 1}`,
    xM: Number(values.xM) || 0, yM: Number(values.yM) || 0,
    widthM: Math.max(.5, Number(values.widthM) || 8), depthM: Math.max(.5, Number(values.depthM) || 8),
    baseM: Math.max(0, Number(values.baseM) || 0), heightM: Math.max(.5, Number(values.heightM) || 3),
  };
  design.masses.push(mass);
  return mass;
}

export function updateBuildingMass(design, id, values = {}) {
  const mass = design.masses.find(item => item.id === id);
  if (!mass) return false;
  Object.assign(mass, {
    xM: Number(values.xM) || 0, yM: Number(values.yM) || 0,
    widthM: Math.max(.5, Number(values.widthM) || .5), depthM: Math.max(.5, Number(values.depthM) || .5),
    baseM: Math.max(0, Number(values.baseM) || 0), heightM: Math.max(.5, Number(values.heightM) || .5),
  });
  return true;
}

// Project the building's extruded footprint into a rotatable, standalone SVG.
export function drawBuildingPreview(svg, footprint, height, floorCount, angle, design = createBuildingDesign()) {
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
  const massGeometry = design.masses.map(mass => {
    const halfW = mass.widthM / 2, halfD = mass.depthM / 2;
    const corners = [
      [mass.xM - halfW, mass.yM - halfD], [mass.xM + halfW, mass.yM - halfD],
      [mass.xM + halfW, mass.yM + halfD], [mass.xM - halfW, mass.yM + halfD],
    ];
    return { mass, lower: corners.map(point => project(point, mass.baseM)), upper: corners.map(point => project(point, mass.baseM + mass.heightM)) };
  });
  const bounds = [...base, ...roof, ...massGeometry.flatMap(({ lower, upper }) => [...lower, ...upper])];
  const xs = bounds.map(point => point[0]), ys = bounds.map(point => point[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  const scale = Math.min(340 / (Math.max(...xs) - left), 172 / (Math.max(...ys) - top));
  const originX = 190 - (Math.max(...xs) - left) * scale / 2;
  const originY = 106 - (Math.max(...ys) - top) * scale / 2;
  function shape(vertices, fill, stroke, layer = 'wall', objectId = 'base') {
    const node = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    node.setAttribute('points', vertices.map(([x, y]) =>
      `${originX + (x - left) * scale},${originY + (y - top) * scale}`).join(' '));
    node.setAttribute('fill', fill);
    if (stroke) node.setAttribute('stroke', stroke);
    node.setAttribute('data-layer', layer);
    node.setAttribute('data-object-id', objectId);
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
    shape([base[i], base[next], roof[next], roof[i]], i % 2 ? '#b9c9ba' : '#e1e9dc', '#758a7c', 'wall');
    if (width < 1) continue;
    const face = (t, z) => project([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], z);
    const panel = (from, to, bottom, upper, color, stroke, layer = 'wall') =>
      shape([face(from, bottom), face(to, bottom), face(to, upper), face(from, upper)], color, stroke, layer);
    const columns = Math.min(24, Math.max(1, Math.floor(width / (wall === entrance ? 2.8 : 3.5))));
    const doorColumn = Math.floor(columns / 2);
    const bay = (column, offset) => (column + offset) / columns;
    const glazed = (from, to, bottom, upper, color, dividerHeight) => {
      panel(from, to, bottom, upper, color, '#344f58', 'window');
      const middle = (from + to) / 2;
      const frame = (to - from) * 0.025;
      panel(middle - frame, middle + frame, bottom, upper, '#b7c8cc', null, 'window');
      if (dividerHeight) {
        const trim = (upper - bottom) * 0.02;
        panel(from, to, dividerHeight - trim, dividerHeight + trim, '#b7c8cc', null, 'window');
      }
    };
    for (let floor = 0; floor < floors; floor += 1) {
      const level = story * floor;
      if (floor) panel(0, 1, level, level + story * 0.04, '#9baca0');
      for (let column = 0; column < columns; column += 1) {
        if (wall === entrance && floor === 0 && column === doorColumn) {
          const doorWidth = Math.min(.9, design.door.widthM / Math.max(width / columns, .1));
          const doorInset = (1 - doorWidth) / 2;
          const doorTop = Math.min(story * .95, design.door.heightM);
          panel(bay(column, doorInset), bay(column, 1 - doorInset), 0, doorTop, '#324d46', '#344f58', 'door');
        } else {
          const windowWidth = Math.min(.88, design.window.widthM / Math.max(width / columns, .1));
          const inset = (1 - windowWidth) / 2;
          const openingHeight = Math.min(story * .72, design.window.heightM);
          const bottom = level + Math.max(story * .12, (story - openingHeight) / 2);
          const top = bottom + openingHeight;
          glazed(bay(column, inset), bay(column, 1 - inset), bottom, top, '#45748a', top - openingHeight * .22);
          panel(bay(column, inset - 0.04), bay(column, 1 - inset + 0.04), bottom - story * 0.04, bottom, '#edf3ee');
        }
      }
    }
  }
  shape(roof, '#dcebdd', '#758a7c', 'roof');
  for (const { mass, lower, upper } of massGeometry) {
    for (let i = 0; i < 4; i += 1) {
      const next = (i + 1) % 4;
      if (lower[next][0] <= lower[i][0]) continue;
      shape([lower[i], lower[next], upper[next], upper[i]], '#c9d8c8', '#526d5b', 'wall', mass.id);
    }
    shape(upper, '#b8cdb8', '#526d5b', 'roof', mass.id);
  }
  return heading;
}
