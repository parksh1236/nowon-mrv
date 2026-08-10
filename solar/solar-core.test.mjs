import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDetailed, calculateRough, currentAnalysisResult, deserializeProject, isInsideNowon, isValidProject, polygonMetrics, readStoredProject, removeStoredProject, serializeProject, sunPosition, validateInputs,
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
