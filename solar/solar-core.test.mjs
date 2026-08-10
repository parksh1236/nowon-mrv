import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCsv, calculateDetailed, calculateRough, currentAnalysisResult, deserializeProject, isInsideNowon, isValidProject, polygonMetrics, readStoredProject, removeStoredProject, samplePolygon, serializeProject, sunPosition, validateInputs,
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
  globalThis.window = { Cesium: { Cartesian3, Ray, Cartographic: { fromDegrees: (lon, lat) => ({ lon, lat }) } }, ws3d: { viewer: { scene } } };
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
