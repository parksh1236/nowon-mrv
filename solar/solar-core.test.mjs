import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCsv, calculateDetailed, calculateRough, currentAnalysisResult, deserializeProject, filterInstallableSamples, isInsideNowon, isValidPolygon, isValidProject, polygonMetrics, readStoredProject, removeStoredProject, samplePolygon, serializeProject, sunPosition, validateInputs,
} from './solar-core.mjs';

const validInput = (overrides = {}) => ({
  roofAreaM2: 120, exclusionAreaM2: 20, perimeterM: 0, edgeSetbackM: 0,
  layoutRatio: 0.8, panelAreaM2: 2, panelPowerKw: 0.45,
  moduleEfficiency: 0.2, systemLossRatio: 0.15, tiltDeg: 30, azimuthDeg: 180,
  ...overrides,
});

test('project state round-trips without map objects', () => {
  const state = { mode: 'virtual', roof: [{ lat: 37.65, lon: 127.05 }], exclusions: [], heightM: 24 };
  assert.deepEqual(deserializeProject(serializeProject(state)), state);
});

test('project deserialization rejects malformed JSON without throwing', () => {
  assert.equal(deserializeProject('{'), null);
});

test('Nowon boundary accepts inside points and rejects outside points', () => {
  assert.equal(isInsideNowon([{ lat: 37.65, lon: 127.05 }]), true);
  assert.equal(isInsideNowon([{ lat: 37.57, lon: 127.05 }]), false);
  assert.equal(isInsideNowon([null]), false);
});

const validProject = {
  mode: 'virtual',
  roof: [
    { lat: 37.65, lon: 127.05 },
    { lat: 37.65, lon: 127.051 },
    { lat: 37.651, lon: 127.051 },
  ],
  exclusions: [],
  heightM: 24,
  formValues: {},
};

test('project validation rejects invalid roof points and degenerate polygons', () => {
  assert.equal(isValidProject({ ...validProject, roof: [null] }), false);
  assert.equal(isValidProject({ ...validProject, roof: validProject.roof.slice(0, 2) }), false);
  assert.equal(isValidProject({ ...validProject, roof: [validProject.roof[0], validProject.roof[0], validProject.roof[0]] }), false);
});

test('polygon validation rejects a non-zero-area crossing ring', () => {
  assert.equal(isValidPolygon([
    { lat: 37.6500, lon: 127.0500 },
    { lat: 37.6520, lon: 127.0530 },
    { lat: 37.6520, lon: 127.0500 },
    { lat: 37.6500, lon: 127.0520 },
  ]), false);
});

test('installable samples exclude equipment zones and edge setbacks', () => {
  const roof = [
    { lat: 37.6500, lon: 127.0500 }, { lat: 37.6500, lon: 127.0510 },
    { lat: 37.6510, lon: 127.0510 }, { lat: 37.6510, lon: 127.0500 },
  ];
  const exclusion = [
    { lat: 37.65045, lon: 127.05045 }, { lat: 37.65045, lon: 127.05055 },
    { lat: 37.65055, lon: 127.05055 }, { lat: 37.65055, lon: 127.05045 },
  ];
  const center = { lat: 37.6505, lon: 127.0505 };
  const nearEdge = { lat: 37.65001, lon: 127.0502 };
  const clear = { lat: 37.6503, lon: 127.0502 };

  assert.deepEqual(filterInstallableSamples([center, clear], roof, [exclusion], 0), [clear]);
  assert.deepEqual(filterInstallableSamples([nearEdge, clear], roof, [], 5), [clear]);
});

test('지도 설치 가능 시각화는 제외영역과 이격거리를 반영한다', async () => {
  globalThis.window = {};
  try {
    const { installableVisualization } = await import(`./app.mjs?installable-map=${Date.now()}`);
    const roof = [
      { lat: 37.6500, lon: 127.0500 }, { lat: 37.6500, lon: 127.0510 },
      { lat: 37.6510, lon: 127.0510 }, { lat: 37.6510, lon: 127.0500 },
    ];
    const exclusion = [[
      { lat: 37.6504, lon: 127.0504 }, { lat: 37.6504, lon: 127.0506 },
      { lat: 37.6506, lon: 127.0506 }, { lat: 37.6506, lon: 127.0504 },
    ]];
    const input = validInput({ roofAreaM2: 9800, exclusionAreaM2: 390, perimeterM: 400, edgeSetbackM: 2 });
    const withoutRestrictions = installableVisualization(roof, [], { ...input, exclusionAreaM2: 0, edgeSetbackM: 0 }, 5);
    const restricted = installableVisualization(roof, exclusion, input, 5);
    assert.ok(restricted.samples.length < withoutRestrictions.samples.length);
    assert.ok(restricted.areaM2 < withoutRestrictions.areaM2);
  } finally {
    delete globalThis.window;
  }
});

test('지도 분석 KML은 지붕·설치가능점·제외영역과 면적 라벨을 포함한다', async () => {
  globalThis.window = {};
  try {
    const { buildAnalysisKml } = await import(`./app.mjs?analysis-kml=${Date.now()}`);
    const roof = [
      { lat: 37.65, lon: 127.05 }, { lat: 37.65, lon: 127.051 }, { lat: 37.651, lon: 127.051 },
    ];
    const kml = buildAnalysisKml({
      roof,
      exclusions: [[{ lat: 37.6502, lon: 127.0502 }, { lat: 37.6502, lon: 127.0503 }, { lat: 37.6503, lon: 127.0503 }]],
      installableSamples: [{ lat: 37.6504, lon: 127.0504 }],
      roofAreaM2: 100,
      installableAreaM2: 72.5,
      heightM: 10,
    });
    assert.match(kml, /지붕 100\.0㎡/);
    assert.match(kml, /설치 가능 72\.5㎡/);
    assert.match(kml, /제외 1/);
    assert.match(kml, /#installable/);
    assert.match(kml, /127\.0504,37\.6504,16/);
  } finally {
    delete globalThis.window;
  }
});

test('stored project reading survives a storage SecurityError', () => {
  const storage = { getItem() { throw new Error('SecurityError'); } };
  assert.deepEqual(readStoredProject(storage, 'nowon-solar-project-v1'), { project: null, unavailable: true });
});

test('stored project removal reports its actual storage outcome', () => {
  const values = new Map([['project', 'broken']]);
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    removeItem(key) { values.delete(key); },
  };

  assert.equal(removeStoredProject(storage, 'project'), true);
  assert.equal(storage.getItem('project'), null);

  const blockedStorage = {
    getItem(key) { return values.get(key) ?? null; },
    removeItem() { throw new Error('SecurityError'); },
  };
  values.set('project', 'broken');

  assert.equal(removeStoredProject(blockedStorage, 'project'), false);
  assert.equal(blockedStorage.getItem('project'), 'broken');
});

test('an analysis result is discarded after its generation is invalidated', async () => {
  let generation = 1;
  let resolveAnalysis;
  const pending = new Promise((resolve) => { resolveAnalysis = resolve; });
  const result = currentAnalysisResult(pending, generation, () => generation);

  generation += 1;
  resolveAnalysis({ annualKwh: 1234 });

  assert.equal(await result, null);
});

test('노원구 인근 10m × 11m 사각형의 면적과 둘레를 계산한다', () => {
  const metrics = polygonMetrics([
    { lat: 37.654, lon: 127.056 },
    { lat: 37.654, lon: 127.056112 },
    { lat: 37.654099, lon: 127.056112 },
    { lat: 37.654099, lon: 127.056 },
  ]);

  assert.ok(metrics.areaM2 >= 90 && metrics.areaM2 <= 110);
  assert.ok(metrics.perimeterM >= 39 && metrics.perimeterM <= 43);
});

test('설치 가능 면적에서 패널 수와 설비용량을 계산한다', () => {
  const result = calculateRough({
    roofAreaM2: 120,
    exclusionAreaM2: 20,
    perimeterM: 0,
    edgeSetbackM: 0,
    layoutRatio: 0.8,
    panelAreaM2: 2,
    panelPowerKw: 0.45,
    moduleEfficiency: 0.2,
    systemLossRatio: 0.15,
    tiltDeg: 30,
    azimuthDeg: 180,
  }, { months: [] });

  assert.equal(result.panelCount, 40);
  assert.equal(result.capacityKwp, 18);
});

test('제외 면적이 지붕보다 크면 0 결과와 경고를 반환한다', () => {
  const result = calculateRough({
    roofAreaM2: 10, exclusionAreaM2: 20, perimeterM: 0, edgeSetbackM: 0,
    layoutRatio: 0.8, panelAreaM2: 2, panelPowerKw: 0.45,
    moduleEfficiency: 0.2, systemLossRatio: 0.15, tiltDeg: 30, azimuthDeg: 180,
  }, { months: [] });

  assert.equal(result.usableAreaM2, 0);
  assert.equal(result.panelCount, 0);
  assert.ok(result.warnings.length > 0);
});

test('하지 정오 무렵 노원구의 태양 고도는 70도보다 높다', () => {
  const position = sunPosition(new Date('2026-06-21T03:00:00Z'), 37.654, 127.056);

  assert.ok(position.altitudeDeg > 70);
});

test('음영 표본이 없으면 정밀 발전량은 개략 발전량과 같다', () => {
  const input = {
    roofAreaM2: 120, exclusionAreaM2: 20, perimeterM: 0, edgeSetbackM: 0,
    layoutRatio: 0.8, panelAreaM2: 2, panelPowerKw: 0.45,
    moduleEfficiency: 0.2, systemLossRatio: 0.15, tiltDeg: 30, azimuthDeg: 180,
  };
  const climate = { months: [{ month: 6, dailyGhiKwhM2: 4.6, days: 30 }] };

  assert.deepEqual(calculateDetailed(input, climate, []), calculateRough(input, climate));
});

test('절반 음영은 직달 성분에만 0보다 크고 0.5보다 작은 손실을 적용한다', () => {
  const input = {
    roofAreaM2: 120, exclusionAreaM2: 20, perimeterM: 0, edgeSetbackM: 0,
    layoutRatio: 0.8, panelAreaM2: 2, panelPowerKw: 0.45,
    moduleEfficiency: 0.2, systemLossRatio: 0.15, tiltDeg: 30, azimuthDeg: 180,
  };
  const climate = { diffuseFraction: 0.2, months: [{ month: 6, dailyGhiKwhM2: 4.6, days: 30 }] };
  const result = calculateDetailed(input, climate, [
    { month: 6, weight: 1, shaded: true },
    { month: 6, weight: 1, shaded: false },
  ]);

  assert.ok(result.shadingLossRatio > 0 && result.shadingLossRatio < 0.5);
});

test('지붕 표본은 내부에 있고 격자가 촘촘할수록 같거나 많으며 cap을 넘지 않는다', () => {
  const roof = [
    { lat: 37.654, lon: 127.056 },
    { lat: 37.654, lon: 127.056112 },
    { lat: 37.654099, lon: 127.056112 },
    { lat: 37.654099, lon: 127.056 },
  ];
  const coarse = samplePolygon(roof, 5, 400);
  const fine = samplePolygon(roof, 2, 10);

  assert.ok(coarse.length > 0);
  assert.ok(fine.length >= coarse.length);
  assert.ok(fine.length <= 10);
  for (const point of [...coarse, ...fine]) {
    assert.ok(point.lat > 37.654 && point.lat < 37.654099);
    assert.ok(point.lon > 127.056 && point.lon < 127.056112);
  }
  assert.deepEqual(samplePolygon([], 2), []);
  assert.deepEqual(samplePolygon(roof.slice(0, 2), 2), []);
  assert.deepEqual(samplePolygon([roof[0], roof[0], roof[0]], 2), []);

  const base = { lat: 37.65, lon: 127.05 };
  const uShape = [[0, 0], [4, 0], [4, 4], [3, 4], [3, 1], [1, 1], [1, 4], [0, 4]]
    .map(([x, y]) => ({ lat: base.lat + y * 0.000009, lon: base.lon + x * 0.000011 }));
  const [fallback] = samplePolygon(uShape, 100);
  const fallbackX = (fallback.lon - base.lon) / 0.000011;
  const fallbackY = (fallback.lat - base.lat) / 0.000009;
  assert.ok(fallbackY < 1 || fallbackX < 1 || fallbackX > 3);

  const largeRoof = [
    { lat: base.lat, lon: base.lon },
    { lat: base.lat, lon: base.lon + 0.00113 },
    { lat: base.lat + 0.0009, lon: base.lon + 0.00113 },
    { lat: base.lat + 0.0009, lon: base.lon },
  ];
  const samplingStarted = performance.now();
  const bounded = samplePolygon(largeRoof, 0.1, 100);
  assert.ok(performance.now() - samplingStarted < 100);
  assert.ok(new Set(bounded.map(({ lat }) => lat.toFixed(7))).size >= 8);
  assert.ok(new Set(bounded.map(({ lon }) => lon.toFixed(7))).size >= 8);

  const toGeo = (x, y) => ({
    lat: base.lat + (y / 6_371_000) * 180 / Math.PI,
    lon: base.lon + (x / (6_371_000 * Math.cos(base.lat * Math.PI / 180))) * 180 / Math.PI,
  });
  const thin = [[-50, -0.5], [50, -0.5], [50, 0.5], [-50, 0.5]];
  const rotate = ([x, y]) => [x * Math.cos(Math.PI / 6) - y * Math.sin(Math.PI / 6), x * Math.sin(Math.PI / 6) + y * Math.cos(Math.PI / 6)];
  const axisAlignedCount = samplePolygon(thin.map(([x, y]) => toGeo(x, y)), 0.1, 100).length;
  const rotatedCount = samplePolygon(thin.map((point) => toGeo(...rotate(point))), 0.1, 100).length;
  assert.ok(axisAlignedCount >= 80);
  assert.ok(Math.abs(rotatedCount - axisAlignedCount) <= 10);

  const square = [[-50, -50], [50, -50], [50, 50], [-50, 50]];
  const axisSquareCount = samplePolygon(square.map(([x, y]) => toGeo(x, y)), 0.1, 400).length;
  const rotatedSquareCount = samplePolygon(square.map((point) => toGeo(...rotate(point))), 0.1, 400).length;
  assert.ok(axisSquareCount >= 350);
  assert.ok(Math.abs(rotatedSquareCount - axisSquareCount) <= 20);

  const sparseU = [[0, 0], [100, 0], [100, 100], [99, 100], [99, 1], [1, 1], [1, 100], [0, 100]];
  const sparseStarted = performance.now();
  const sparseSamples = samplePolygon(sparseU.map(([x, y]) => toGeo(x, y)), 0.1, 400);
  assert.equal(sparseSamples.length, 400);
  assert.ok(performance.now() - sparseStarted < 100);
  for (const sample of sparseSamples) {
    const x = (sample.lon - base.lon) * Math.PI / 180 * 6_371_000 * Math.cos(base.lat * Math.PI / 180);
    const y = (sample.lat - base.lat) * Math.PI / 180 * 6_371_000;
    assert.ok(y < 1 || x < 1 || x > 99);
  }

  const monotonicRoof = [[0, 0], [36, 0], [36, 92], [0, 92]].map(([x, y]) => toGeo(x, y));
  const coarseCount = samplePolygon(monotonicRoof, 3, 400).length;
  const finerCount = samplePolygon(monotonicRoof, 2, 400).length;
  assert.ok(finerCount >= coarseCount);
});

test('CSV는 월별 비교와 분석 metadata를 RFC 4180 형식으로 만든다', () => {
  const result = {
    rough: {
      installableAreaM2: 80,
      capacityKwp: 18,
      monthlyKwh: [
        { month: 1, kwh: 10 }, { month: 2, kwh: 20 }, { month: 3, kwh: 30 }, { month: 4, kwh: 40 },
        { month: 5, kwh: 50 }, { month: 6, kwh: 60 }, { month: 7, kwh: 70 }, { month: 8, kwh: 80 },
        { month: 9, kwh: 90 }, { month: 10, kwh: 100 }, { month: 11, kwh: 110 }, { month: 12, kwh: 120 },
      ],
    },
    detailed: {
      monthlyKwh: [
        { month: 1, kwh: 9 }, { month: 2, kwh: 18 }, { month: 3, kwh: 27 }, { month: 4, kwh: 36 },
        { month: 5, kwh: 45 }, { month: 6, kwh: 54 }, { month: 7, kwh: 63 }, { month: 8, kwh: 72 },
        { month: 9, kwh: 81 }, { month: 10, kwh: 90 }, { month: 11, kwh: 99 }, { month: 12, kwh: 108 },
      ],
    },
    precision: '균형',
    spacingM: 3,
  };
  const project = { formValues: { systemLossRatio: 14 } };
  const climate = { source: '기상청, "관측"\n2025' };
  const expected = `월,개략발전량_kWh,정밀추정발전량_kWh\r
1,10,9\r
2,20,18\r
3,30,27\r
4,40,36\r
5,50,45\r
6,60,54\r
7,70,63\r
8,80,72\r
9,90,81\r
10,100,90\r
11,110,99\r
12,120,108\r
\r
항목,값\r
설치 가능면적㎡,80\r
설비용량kWp,18\r
시스템손실률,0.14\r
정밀도,균형\r
표본간격m,3\r
기후자료출처,"기상청, ""관측""\n2025"\r
분석구분,사전 추정치`;

  assert.equal(buildCsv(result, project, climate), expected);
  assert.equal(buildCsv(result, project, climate).charCodeAt(0) === 0xfeff, false);
  assert.match(buildCsv({ ...result, detailed: null }, project, climate), /\r\n1,10,\r\n/);
});

test('3D scene boundary는 hit와 no-hit을 음영 표본으로 만들고 미지원 API를 거부한다', async () => {
  class Cartesian3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    static fromDegrees(lon, lat, height) { return new Cartesian3(lon * 1000, lat * 1000, height); }
    static subtract(a, b, out) { Object.assign(out, { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }); return out; }
    static normalize(value, out) {
      const length = Math.hypot(value.x, value.y, value.z);
      Object.assign(out, { x: value.x / length, y: value.y / length, z: value.z / length });
      return out;
    }
    static distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  }
  class Ray { constructor(origin, direction) { Object.assign(this, { origin, direction }); } }
  let calls = 0;
  const originHeights = [];
  const scene = {
    globe: { getHeight() { return 100; } },
    async pickFromRayMostDetailed(ray) {
      calls += 1;
      originHeights.push(ray.origin.z);
      return calls % 2 ? { position: new Cartesian3(ray.origin.x + 1, ray.origin.y, ray.origin.z) } : undefined;
    },
  };
  globalThis.window = {
    Cesium: {
      Cartesian3,
      Ray,
      Cartographic: { fromDegrees: (lon, lat) => ({ lon, lat }) },
      Transforms: { eastNorthUpToFixedFrame: () => 'enu-frame' },
      Matrix4: { multiplyByPointAsVector: (_frame, vector, out) => Object.assign(out, vector) },
    },
    ws3d: { viewer: { scene } },
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  try {
    const { buildShadeSamples } = await import(`./app.mjs?boundary=${Date.now()}`);
    const roof = [
      { lat: 37.654, lon: 127.056 },
      { lat: 37.654, lon: 127.056112 },
      { lat: 37.654099, lon: 127.056112 },
      { lat: 37.654099, lon: 127.056 },
    ];
    const samples = await buildShadeSamples({ roof, heightM: 20 }, 'fast');

    assert.ok(samples.some(({ shaded }) => shaded));
    assert.ok(samples.some(({ shaded }) => !shaded));
    assert.ok(originHeights.every((height) => height === 120));
    assert.deepEqual([...new Set(samples.map(({ month }) => month))], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    const normalize = Cartesian3.normalize;
    Cartesian3.normalize = undefined;
    await assert.rejects(
      buildShadeSamples({ roof, heightM: 20 }, 'fast'),
      { message: '현재 VWorld 장면에서는 3D 음영 계산을 지원하지 않습니다.' },
    );
    Cartesian3.normalize = normalize;

    window.ws3d.viewer.scene = {};
    await assert.rejects(
      buildShadeSamples({ roof, heightM: 20 }, 'fast'),
      { message: '현재 VWorld 장면에서는 3D 음영 계산을 지원하지 않습니다.' },
    );
  } finally {
    delete globalThis.window;
    delete globalThis.requestAnimationFrame;
  }
});

test('synchronous scene ray is preferred over a non-returning detailed picker', async () => {
  globalThis.window = {};
  try {
    const { pickSceneFromRay } = await import(`./app.mjs?sync-ray=${Date.now()}`);
    let detailedCalls = 0;
    const hit = { position: { x: 1 } };
    const scene = {
      pickFromRay: () => hit,
      pickFromRayMostDetailed: () => { detailedCalls += 1; return new Promise(() => {}); },
    };

    assert.equal(await pickSceneFromRay(scene, {}), hit);
    assert.equal(detailedCalls, 0);
  } finally {
    delete globalThis.window;
  }
});

test('detailed-only scene ray fails instead of waiting forever', async () => {
  globalThis.window = {};
  try {
    const { pickSceneFromRay } = await import(`./app.mjs?ray-timeout=${Date.now()}`);
    const scene = { pickFromRayMostDetailed: () => new Promise(() => {}) };
    await assert.rejects(pickSceneFromRay(scene, {}, 5), { message: '3D 음영 계산 시간이 초과되었습니다.' });
  } finally {
    delete globalThis.window;
  }
});

test('ENU 태양 방향은 동·북·상 local vector를 ECEF 방향으로 변환한다', async () => {
  class Cartesian3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    static normalize(value, out) {
      const length = Math.hypot(value.x, value.y, value.z);
      Object.assign(out, { x: value.x / length, y: value.y / length, z: value.z / length });
      return out;
    }
  }
  globalThis.window = {
    Cesium: {
      Cartesian3,
      Transforms: { eastNorthUpToFixedFrame: () => 'enu-frame' },
      Matrix4: { multiplyByPointAsVector: (_frame, vector, out) => Object.assign(out, vector) },
    },
  };
  try {
    const { enuDirection } = await import(`./app.mjs?enu=${Date.now()}`);
    assert.equal(typeof enuDirection, 'function');
    const literal = (sun) => Object.values(enuDirection(new Cartesian3(), sun)).map((value) => Math.round(value * 1e6) / 1e6);
    assert.deepEqual(literal({ altitudeDeg: 0, azimuthDeg: 90 }), [1, 0, 0]);
    assert.deepEqual(literal({ altitudeDeg: 0, azimuthDeg: 0 }), [0, 1, 0]);
    assert.deepEqual(literal({ altitudeDeg: 90, azimuthDeg: 0 }), [0, 0, 1]);
  } finally {
    delete globalThis.window;
  }
});

test('stale 정밀 분석은 첫 ray 직후 중단하고 추가 progress를 공지하지 않는다', async () => {
  const announcements = [];
  const statusNode = {};
  Object.defineProperty(statusNode, 'textContent', { set: (value) => announcements.push(value) });
  globalThis.document = { querySelector: (selector) => selector === '#status' ? statusNode : null };
  let current = true;
  let calls = 0;
  class Cartesian3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    static fromDegrees(lon, lat, height) { return new Cartesian3(lon, lat, height); }
    static subtract(a, b, out) { return Object.assign(out, { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }); }
    static normalize(value, out) { return Object.assign(out, value); }
    static distance() { return 100_000; }
  }
  class Ray { constructor(origin, direction) { Object.assign(this, { origin, direction }); } }
  const scene = {
    async pickFromRayMostDetailed() { calls += 1; current = false; return undefined; },
  };
  globalThis.window = {
    Cesium: {
      Cartesian3,
      Ray,
      Transforms: { eastNorthUpToFixedFrame: () => 'enu-frame' },
      Matrix4: { multiplyByPointAsVector: (_frame, vector, out) => Object.assign(out, vector) },
    },
    ws3d: { viewer: { scene } },
  };
  globalThis.requestAnimationFrame = (callback) => callback();
  try {
    const { announceDetailedStart, buildShadeSamples, reportCurrentError } = await import(`./app.mjs?stale=${Date.now()}`);
    const roof = [
      { lat: 37.654, lon: 127.056 }, { lat: 37.654, lon: 127.056112 },
      { lat: 37.654099, lon: 127.056112 }, { lat: 37.654099, lon: 127.056 },
    ];
    announceDetailedStart();
    assert.equal(await buildShadeSamples({ roof, heightM: 20 }, 'fast', () => current), null);
    assert.equal(calls, 1);
    assert.deepEqual(announcements, ['정밀 추정 분석 중…']);
    assert.equal(typeof reportCurrentError, 'function');
    reportCurrentError(new Error('늦은 실패'), () => current);
    assert.deepEqual(announcements, ['정밀 추정 분석 중…']);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.requestAnimationFrame;
  }
});

test('shared invalidation은 결과와 CSV를 지우고 분석 snapshot은 입력 변경과 분리된다', async () => {
  class FakeNode {
    constructor(tag = '') { this.tag = tag; this.children = []; this.attributes = {}; this.style = {}; this.disabled = false; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const resultsNode = new FakeNode('results');
  const csvButton = new FakeNode('button');
  const statusNode = new FakeNode('status');
  statusNode.textContent = '기존 공지';
  globalThis.document = {
    createElement: (tag) => new FakeNode(tag),
    querySelector: (selector) => ({ '#results': resultsNode, '#download-csv': csvButton, '#status': statusNode }[selector] ?? null),
  };
  try {
    const { announceDetailedStart, invalidateAnalysis, renderDetailedFailure, snapshotAnalysis } = await import(`./app.mjs?state=${Date.now()}`);
    assert.equal(typeof announceDetailedStart, 'function');
    assert.equal(typeof invalidateAnalysis, 'function');
    assert.equal(typeof renderDetailedFailure, 'function');
    assert.equal(typeof snapshotAnalysis, 'function');

    announceDetailedStart();
    assert.equal(statusNode.textContent, '정밀 추정 분석 중…');
    csvButton.disabled = false;
    invalidateAnalysis();
    assert.equal(csvButton.disabled, true);
    assert.equal(resultsNode.children.length, 1);
    assert.equal(statusNode.textContent, '입력값이 변경되어 분석 결과를 지웠습니다.');

    const project = { input: { systemLossRatio: 0.14 }, roof: [{ lat: 1, lon: 2 }] };
    const climate = { source: '원본' };
    const snapshot = snapshotAnalysis({ monthlyKwh: [] }, project, climate, '균형', 3);
    project.input.systemLossRatio = 0.9;
    climate.source = '변경';
    assert.equal(snapshot.project.input.systemLossRatio, 0.14);
    assert.equal(snapshot.climate.source, '원본');

    statusNode.textContent = '정밀 추정 분석 중…';
    renderDetailedFailure({ rough: { installableAreaM2: 1, capacityKwp: 1, annualKwh: 1, monthlyKwh: [], warnings: [] } }, '정밀 실패');
    assert.equal(statusNode.textContent, '');
    const alerts = resultsNode.children.filter((child) => child?.attributes?.role === 'alert');
    assert.equal(alerts.length, 1);
  } finally {
    delete globalThis.document;
  }
});

test('known-height building은 높이를 먼저 적용하고 roof 분석을 한 번만 시작한다', async () => {
  globalThis.window = {};
  try {
    const { applyBuildingGeometry } = await import(`./app.mjs?building=${Date.now()}`);
    assert.equal(typeof applyBuildingGeometry, 'function');
    const calls = [];
    const polygon = [{ lat: 37.65, lon: 127.05 }];
    const applied = applyBuildingGeometry(
      polygon,
      24,
      (height) => calls.push(`height:${height}`),
      (roof) => { calls.push(`roof:${roof.length}`); return true; },
    );

    assert.equal(applied, true);
    assert.deepEqual(calls, ['height:24', 'roof:1']);
  } finally {
    delete globalThis.window;
  }
});

test('preloaded VWorld runtime is reused without injecting a late loader', async () => {
  let appended = 0;
  globalThis.window = { vw: {} };
  globalThis.document = {
    querySelector: () => null,
    createElement: () => ({}),
    head: { append(script) { appended += 1; queueMicrotask(() => script.onload()); } },
  };
  try {
    const { loadVWorld } = await import(`./app.mjs?preloaded=${Date.now()}`);
    await loadVWorld('configured-key');
    assert.equal(appended, 0);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});

test('building replacement clears stale geometry and blanks a missing height', async () => {
  globalThis.window = {};
  try {
    const { applyBuildingGeometry, resetBuildingGeometry } = await import(`./app.mjs?replacement=${Date.now()}`);
    const model = { roof: [{ lat: 1, lon: 2 }], exclusions: [[{ lat: 1, lon: 2 }]], heightM: 18 };
    resetBuildingGeometry(model);
    assert.deepEqual(model, { roof: [], exclusions: [], heightM: 0 });

    const calls = [];
    applyBuildingGeometry([{ lat: 37.65, lon: 127.05 }], null, (height) => calls.push(height), () => true);
    assert.deepEqual(calls, [0]);
  } finally {
    delete globalThis.window;
  }
});

test('building lookup request targets the supported VWorld building layer', async () => {
  globalThis.window = {};
  try {
    const { buildingLookupUrl } = await import(`./app.mjs?building-layer=${Date.now()}`);
    const url = new URL(buildingLookupUrl({ lat: 37.6543, lon: 127.0564 }, 'key'));
    assert.equal(url.searchParams.get('data'), 'LT_C_BLDGINFO');
    assert.equal(url.searchParams.get('geomFilter'), 'POINT(127.0564 37.6543)');
  } finally {
    delete globalThis.window;
  }
});

test('건물 요약은 위치·용도·높이·지붕면적을 표시한다', async () => {
  globalThis.window = {};
  try {
    const { buildingSummary } = await import(`./app.mjs?building-summary=${Date.now()}`);
    const rows = Object.fromEntries(buildingSummary({
      properties: { bld_nm: '노원구청', main_purps_cd_nm: '공공업무시설', height: 24 },
      geometry: { type: 'Polygon', coordinates: [[
        [127.056, 37.654], [127.0561, 37.654], [127.0561, 37.6541], [127.056, 37.6541], [127.056, 37.654],
      ]] },
    }, { lat: 37.654, lon: 127.056 }, '서울특별시 노원구 노해로 437'));
    assert.equal(rows['검색 위치'], '서울특별시 노원구 노해로 437');
    assert.equal(rows['건물명'], '노원구청');
    assert.equal(rows['주용도'], '공공업무시설');
    assert.equal(rows['건물 높이'], '24 m');
    assert.match(rows['지붕 추정면적'], /㎡$/);
  } finally {
    delete globalThis.window;
  }
});

test('주소 검색 위치는 지도 카메라와 마커에 반영된다', async () => {
  globalThis.window = {};
  try {
    const { focusBuildingOnMap } = await import(`./app.mjs?building-focus=${Date.now()}`);
    const calls = [];
    const viewer = {
      camera: { flyTo(options) { calls.push(['flyTo', options]); } },
      entities: { add(entity) { calls.push(['add', entity]); return entity; }, remove() {} },
    };
    const Cesium = {
      Cartesian3: { fromDegrees(lon, lat, height) { return { lon, lat, height }; } },
      Cartesian2: class { constructor(x, y) { this.x = x; this.y = y; } },
      Math: { toRadians(value) { return value * Math.PI / 180; } },
      Color: { WHITE: 'white', fromCssColorString(value) { return value; } },
    };
    assert.equal(focusBuildingOnMap({ lat: 37.654, lon: 127.056 }, '노원구청', viewer, Cesium), true);
    assert.deepEqual(calls[0][1].destination, { lon: 127.056, lat: 37.654, height: 700 });
    assert.equal(calls[1][1].label.text, '노원구청');
  } finally {
    delete globalThis.window;
  }
});

test('VWorld 지도는 검색한 건물 위치로 이동한다', async () => {
  globalThis.window = {};
  try {
    const { focusBuildingOnMap } = await import(`./app.mjs?vworld-focus=${Date.now()}`);
    const moved = [];
    const map = { moveTo(position) { moved.push(position); } };
    const vwApi = {
      CoordZ: class { constructor(lon, lat, height) { Object.assign(this, { lon, lat, height }); } },
      Direction: class { constructor(heading, pitch, roll) { Object.assign(this, { heading, pitch, roll }); } },
      CameraPosition: class { constructor(position, direction) { Object.assign(this, { position, direction }); } },
    };
    assert.equal(focusBuildingOnMap({ lat: 37.654, lon: 127.056 }, '노원구청', null, {}, map, vwApi), true);
    assert.equal(moved[0].position.lon, 127.056);
    assert.equal(moved[0].position.lat, 37.654);
    assert.equal(moved[0].position.height, 700);
    assert.equal(moved[0].direction.pitch, -90);
  } finally {
    delete globalThis.window;
  }
});

test('Cesium 화면 클릭 좌표를 위경도로 변환한다', async () => {
  globalThis.window = {};
  try {
    const { coordinateFromClick } = await import(`./app.mjs?map-click=${Date.now()}`);
    const cartographic = { latitude: 0.65, longitude: 2.2 };
    const viewer = {
      scene: { pickPositionSupported: true, pickPosition: () => ({ cartesian: true }) },
      camera: {},
    };
    const Cesium = {
      Cartographic: { fromCartesian: () => cartographic },
      Math: { toDegrees: (value) => value * 180 / Math.PI },
    };
    assert.deepEqual(coordinateFromClick({ position: { x: 10, y: 20 } }, viewer, Cesium), {
      lat: 0.65 * 180 / Math.PI,
      lon: 2.2 * 180 / Math.PI,
    });
  } finally {
    delete globalThis.window;
  }
});

test('VWorld JSONP loader resolves data and removes its temporary callback', async () => {
  globalThis.window = {};
  try {
    const { loadJsonp } = await import(`./app.mjs?jsonp=${Date.now()}`);
    const targetWindow = {};
    let insertedUrl;
    let removed = false;
    const targetDocument = {
      createElement: () => ({ remove() { removed = true; } }),
      head: {
        append(script) {
          insertedUrl = script.src;
          const callback = new URL(script.src).searchParams.get('callback');
          queueMicrotask(() => targetWindow[callback]({ response: { status: 'OK' } }));
        },
      },
    };

    assert.deepEqual(
      await loadJsonp('https://api.vworld.kr/req/data?service=data', 1000, targetWindow, targetDocument),
      { response: { status: 'OK' } },
    );
    const callback = new URL(insertedUrl).searchParams.get('callback');
    assert.match(callback, /^__nowonSolarJsonp\d+$/);
    assert.equal(targetWindow[callback], undefined);
    assert.equal(removed, true);
  } finally {
    delete globalThis.window;
  }
});

test('climate loading retries after a transient response failure', async () => {
  const { loadClimate } = await import(`./app.mjs?climate=${Date.now()}`);
  await assert.rejects(loadClimate(async () => ({ ok: false })), { message: '기후 데이터를 불러오지 못했습니다.' });
  const climate = await loadClimate(async () => ({ ok: true, json: async () => ({ months: [1] }) }));
  assert.deepEqual(climate, { months: [1] });
});

test('기후 품질 경고는 발전량 계산을 막지 않는다', () => {
  const result = calculateRough({
    roofAreaM2: 120, exclusionAreaM2: 20, perimeterM: 0, edgeSetbackM: 0,
    layoutRatio: 0.8, panelAreaM2: 2, panelPowerKw: 0.45,
    moduleEfficiency: 0.2, systemLossRatio: 0.15, tiltDeg: 30, azimuthDeg: 180,
  }, {
    quality: 'prototype-calibration-required',
    months: [{ month: 6, dailyGhiKwhM2: 4.6, days: 30 }],
  });

  assert.equal(result.panelCount, 40);
  assert.ok(result.warnings.some((warning) => warning.includes('기후 데이터 품질')));
});

test('null 입력은 개략·정밀 계산에서 0 결과와 경고를 반환한다', () => {
  for (const result of [calculateRough(null, { months: [] }), calculateDetailed(null, { months: [] }, [])]) {
    assert.equal(result.panelCount, 0);
    assert.ok(result.warnings.length > 0);
  }
});

test('유효하지 않은 경사·방위각은 NaN 발전량 대신 0 결과와 경고를 반환한다', () => {
  for (const input of [
    validInput({ tiltDeg: Number.NaN }),
    validInput({ tiltDeg: 91 }),
    validInput({ azimuthDeg: -1 }),
    validInput({ azimuthDeg: 361 }),
  ]) {
    const result = calculateRough(input, { months: [{ month: 6, dailyGhiKwhM2: 4.6, days: 30 }] });
    assert.equal(result.annualKwh, 0);
    assert.ok(result.warnings.length > 0);
  }
});

test('제외면적과 가장자리 이격이 지붕 면적을 넘으면 관계 경고를 반환한다', () => {
  assert.ok(validateInputs(validInput({ exclusionAreaM2: 121 })).length > 0);
  assert.ok(validateInputs(validInput({ perimeterM: 100, edgeSetbackM: 2 })).length > 0);
});
