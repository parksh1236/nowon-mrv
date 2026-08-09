import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateDetailed, calculateRough, polygonMetrics, sunPosition } from './solar-core.mjs';

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
