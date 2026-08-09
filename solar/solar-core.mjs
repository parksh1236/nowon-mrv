const EARTH_RADIUS_M = 6_371_000;
const radians = (degrees) => (degrees * Math.PI) / 180;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const projectFields = ['mode', 'roof', 'exclusions', 'heightM', 'formValues', 'dirty'];

export function serializeProject(state = {}) {
  const project = {};
  for (const field of projectFields) {
    if (Object.hasOwn(state, field)) project[field] = state[field];
  }
  return JSON.stringify(project);
}

export function deserializeProject(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !Object.keys(parsed).length) return null;
    const project = {};
    for (const field of projectFields) {
      if (Object.hasOwn(parsed, field)) project[field] = parsed[field];
    }
    return Object.keys(project).length ? project : null;
  } catch {
    return null;
  }
}

export function isInsideNowon(points) {
  return Array.isArray(points) && points.length > 0 && points.every(({ lat, lon } = {}) => (
    Number.isFinite(lat) && Number.isFinite(lon) && lat >= 37.58 && lat <= 37.70 && lon >= 127.00 && lon <= 127.12
  ));
}

export function validateInputs(input = {}) {
  if (!input || typeof input !== 'object') return ['입력값이 올바르지 않습니다.'];
  const warnings = [];
  if (!(input.roofAreaM2 > 0)) warnings.push('지붕 면적은 0보다 커야 합니다.');
  if (!(input.exclusionAreaM2 >= 0)) warnings.push('제외 면적은 0 이상이어야 합니다.');
  if (!(input.perimeterM >= 0) || !(input.edgeSetbackM >= 0)) warnings.push('둘레와 가장자리 이격거리는 0 이상이어야 합니다.');
  if (!(input.layoutRatio > 0 && input.layoutRatio <= 1)) warnings.push('배치율은 0보다 크고 1 이하여야 합니다.');
  if (!(input.panelAreaM2 > 0)) warnings.push('패널 면적은 0보다 커야 합니다.');
  if (!(input.panelPowerKw > 0)) warnings.push('패널 정격용량은 0보다 커야 합니다.');
  if (!(input.moduleEfficiency > 0 && input.moduleEfficiency <= 1)) warnings.push('모듈 효율은 0보다 크고 1 이하여야 합니다.');
  if (!(input.systemLossRatio >= 0 && input.systemLossRatio < 1)) warnings.push('시스템 손실률은 0 이상 1 미만이어야 합니다.');
  if (!Number.isFinite(input.tiltDeg) || input.tiltDeg < 0 || input.tiltDeg > 90) warnings.push('경사각은 0도 이상 90도 이하여야 합니다.');
  if (!Number.isFinite(input.azimuthDeg) || input.azimuthDeg < 0 || input.azimuthDeg > 360) warnings.push('방위각은 0도 이상 360도 이하여야 합니다.');
  if (input.exclusionAreaM2 > input.roofAreaM2) warnings.push('제외 면적이 지붕 면적보다 큽니다.');
  const edgeArea = Math.max(0, input.perimeterM * input.edgeSetbackM - Math.PI * input.edgeSetbackM ** 2);
  if (input.exclusionAreaM2 + edgeArea >= input.roofAreaM2) warnings.push('제외 면적과 가장자리 이격 면적이 지붕 면적 이상입니다.');
  return warnings;
}

function roofIrradianceFactor(tiltDeg = 0, azimuthDeg = 180) {
  const tilt = radians(tiltDeg);
  return Math.max(0, Math.cos(tilt) + 0.15 * Math.sin(tilt) * Math.cos(radians(azimuthDeg - 180)));
}

function emptyResult(warnings) {
  return {
    usableAreaM2: 0,
    installableAreaM2: 0,
    panelCount: 0,
    capacityKwp: 0,
    monthlyKwh: [],
    annualKwh: 0,
    shadingLossRatio: 0,
    warnings,
  };
}

function baseCalculation(input, climate) {
  const warnings = validateInputs(input);
  if (warnings.length) return emptyResult(warnings);
  if (climate?.quality) warnings.push(`기후 데이터 품질: ${climate.quality}`);

  // ponytail: convex-roof setback approximation; replace with polygon offsetting if irregular-roof error becomes material.
  const edgeArea = Math.max(0, input.perimeterM * input.edgeSetbackM - Math.PI * input.edgeSetbackM ** 2);
  const usableAreaM2 = Math.max(0, input.roofAreaM2 - input.exclusionAreaM2 - edgeArea);
  const installableAreaM2 = Math.max(0, usableAreaM2 * input.layoutRatio);
  const panelCount = Math.floor(installableAreaM2 / input.panelAreaM2);
  if (panelCount === 0) return emptyResult([...warnings, '설치 가능한 유효 면적이 없습니다.']);

  return {
    usableAreaM2,
    installableAreaM2,
    panelCount,
    capacityKwp: panelCount * input.panelPowerKw,
    warnings,
  };
}

function monthlyGeneration(input, climate, panelCount, directFactor = () => 1) {
  const panelAreaM2 = panelCount * input.panelAreaM2;
  const irradianceFactor = roofIrradianceFactor(input.tiltDeg, input.azimuthDeg);
  return (climate?.months ?? []).map(({ month, dailyGhiKwhM2, days }) => ({
    month,
    kwh: panelAreaM2 * dailyGhiKwhM2 * days * irradianceFactor * input.moduleEfficiency * (1 - input.systemLossRatio) * directFactor(month),
  }));
}

export function calculateRough(input, climate) {
  const base = baseCalculation(input, climate);
  if (base.panelCount === 0) return base;
  const monthlyKwh = monthlyGeneration(input, climate, base.panelCount);
  return { ...base, monthlyKwh, annualKwh: monthlyKwh.reduce((sum, { kwh }) => sum + kwh, 0), shadingLossRatio: 0 };
}

export function calculateDetailed(input, climate, shadeSamples) {
  const rough = calculateRough(input, climate);
  if (rough.panelCount === 0 || !shadeSamples?.length) return rough;

  const diffuseFraction = clamp(climate?.diffuseFraction ?? 0.2, 0, 1);
  const shadeByMonth = new Map();
  for (const sample of shadeSamples) {
    if (!(sample.weight > 0)) continue;
    const totals = shadeByMonth.get(sample.month) ?? { total: 0, shaded: 0 };
    totals.total += sample.weight;
    if (sample.shaded) totals.shaded += sample.weight;
    shadeByMonth.set(sample.month, totals);
  }
  const directFactor = (month) => {
    const totals = shadeByMonth.get(month);
    const shadedRatio = totals ? totals.shaded / totals.total : 0;
    return 1 - (1 - diffuseFraction) * shadedRatio;
  };
  const monthlyKwh = monthlyGeneration(input, climate, rough.panelCount, directFactor);
  const annualKwh = monthlyKwh.reduce((sum, { kwh }) => sum + kwh, 0);

  return { ...rough, monthlyKwh, annualKwh, shadingLossRatio: rough.annualKwh ? 1 - annualKwh / rough.annualKwh : 0 };
}

export function polygonMetrics(points) {
  if (!Array.isArray(points) || points.length < 3) return { areaM2: 0, perimeterM: 0 };

  const latitude = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const projected = points.map(({ lat, lon }) => ({
    x: EARTH_RADIUS_M * radians(lon) * Math.cos(radians(latitude)),
    y: EARTH_RADIUS_M * radians(lat),
  }));
  let doubleArea = 0;
  let perimeterM = 0;

  for (let index = 0; index < projected.length; index += 1) {
    const point = projected[index];
    const next = projected[(index + 1) % projected.length];
    doubleArea += point.x * next.y - next.x * point.y;
    perimeterM += Math.hypot(next.x - point.x, next.y - point.y);
  }

  return { areaM2: Math.abs(doubleArea) / 2, perimeterM };
}

export function sunPosition(date, latitude, longitude) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86_400_000) + 1;
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (minutes / 60 - 12) / 24);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const declination = 0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const hourAngle = radians((minutes + equationOfTime + 4 * longitude) / 4 - 180);
  const latitudeRad = radians(latitude);
  const cosineZenith = clamp(
    Math.sin(latitudeRad) * Math.sin(declination) + Math.cos(latitudeRad) * Math.cos(declination) * Math.cos(hourAngle),
    -1,
    1,
  );
  const zenith = Math.acos(cosineZenith);
  const azimuth = (Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(latitudeRad) - Math.tan(declination) * Math.cos(latitudeRad),
  ) * 180 / Math.PI + 180) % 360;

  return { altitudeDeg: 90 - zenith * 180 / Math.PI, azimuthDeg: azimuth };
}
