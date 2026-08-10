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
  return Array.isArray(points) && points.length > 0 && points.every((point) => (
    Number.isFinite(point?.lat) && Number.isFinite(point?.lon) && point.lat >= 37.58 && point.lat <= 37.70 && point.lon >= 127.00 && point.lon <= 127.12
  ));
}

export function isValidPolygon(points) {
  return Array.isArray(points) && points.length >= 3 && isInsideNowon(points) && polygonMetrics(points).areaM2 > 0;
}

export function isValidProject(project) {
  return ['existing', 'virtual'].includes(project?.mode)
    && Array.isArray(project.roof) && (!project.roof.length || isValidPolygon(project.roof))
    && Array.isArray(project.exclusions) && project.exclusions.every(isValidPolygon)
    && Number.isFinite(project.heightM) && project.heightM >= 0
    && project.formValues && typeof project.formValues === 'object';
}

export function readStoredProject(storage, key) {
  try {
    const value = storage.getItem(key);
    if (value === null) return { project: null };
    const project = deserializeProject(value);
    return project && isValidProject(project) ? { project } : { project: null, invalid: true };
  } catch {
    return { project: null, unavailable: true };
  }
}

export function removeStoredProject(storage, key) {
  try {
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch {
    return false;
  }
}

export async function currentAnalysisResult(result, generation, currentGeneration) {
  const resolved = await result;
  return generation === currentGeneration() ? resolved : null;
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

export function samplePolygon(points, spacingM, maxPoints = 400) {
  if (!Array.isArray(points) || points.length < 3 || !(spacingM > 0) || !(maxPoints > 0) || polygonMetrics(points).areaM2 === 0) return [];

  const latitude = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const longitude = points.reduce((sum, point) => sum + point.lon, 0) / points.length;
  const cosineLatitude = Math.cos(radians(latitude));
  const projected = points.map(({ lat, lon }) => ({
    x: EARTH_RADIUS_M * radians(lon - longitude) * cosineLatitude,
    y: EARTH_RADIUS_M * radians(lat - latitude),
  }));
  const longestEdge = projected.reduce((longest, point, index) => {
    const next = projected[(index + 1) % projected.length];
    const edge = { x: next.x - point.x, y: next.y - point.y };
    const lengthSquared = edge.x ** 2 + edge.y ** 2;
    return lengthSquared > longest.lengthSquared ? { ...edge, lengthSquared } : longest;
  }, { x: 1, y: 0, lengthSquared: 0 });
  const angle = Math.atan2(longestEdge.y, longestEdge.x);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const gridPolygon = projected.map(({ x, y }) => ({ x: x * cosine + y * sine, y: -x * sine + y * cosine }));
  const xs = gridPolygon.map(({ x }) => x);
  const ys = gridPolygon.map(({ y }) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const cap = Math.max(1, Math.floor(maxPoints));
  let sampleSpacingM = spacingM;
  let candidateCount = Math.ceil(width / sampleSpacingM) * Math.ceil(height / sampleSpacingM);
  if (candidateCount > cap) {
    sampleSpacingM *= Math.sqrt(candidateCount / cap);
    candidateCount = Math.ceil(width / sampleSpacingM) * Math.ceil(height / sampleSpacingM);
    while (candidateCount > cap) {
      sampleSpacingM *= 1.01;
      candidateCount = Math.ceil(width / sampleSpacingM) * Math.ceil(height / sampleSpacingM);
    }
  }
  const unproject = ({ x, y }) => ({
    lat: latitude + ((x * sine + y * cosine) / EARTH_RADIUS_M) * 180 / Math.PI,
    lon: longitude + ((x * cosine - y * sine) / (EARTH_RADIUS_M * cosineLatitude)) * 180 / Math.PI,
  });
  const inside = ({ x, y }) => {
    let result = false;
    for (let index = 0, previous = gridPolygon.length - 1; index < gridPolygon.length; previous = index, index += 1) {
      const a = gridPolygon[index];
      const b = gridPolygon[previous];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) result = !result;
    }
    return result;
  };
  const samples = [];
  for (let y = Math.min(...ys) + sampleSpacingM / 2; y < Math.max(...ys); y += sampleSpacingM) {
    for (let x = Math.min(...xs) + sampleSpacingM / 2; x < Math.max(...xs); x += sampleSpacingM) {
      if (inside({ x, y })) samples.push(unproject({ x, y }));
    }
  }
  if (!samples.length) {
    if (inside({ x: 0, y: 0 })) return [{ lat: latitude, lon: longitude }];
    const orientation = gridPolygon.reduce((sum, point, index) => {
      const next = gridPolygon[(index + 1) % gridPolygon.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) >= 0 ? 1 : -1;
    for (let index = 0; index < gridPolygon.length; index += 1) {
      const point = gridPolygon[index];
      const next = gridPolygon[(index + 1) % gridPolygon.length];
      const length = Math.hypot(next.x - point.x, next.y - point.y);
      if (!length) continue;
      const epsilon = Math.max(1e-6, length * 1e-6);
      const candidate = {
        x: (point.x + next.x) / 2 - orientation * (next.y - point.y) / length * epsilon,
        y: (point.y + next.y) / 2 + orientation * (next.x - point.x) / length * epsilon,
      };
      if (inside(candidate)) return [unproject(candidate)];
    }
    return [];
  }
  if (samples.length <= maxPoints) return samples;

  // ponytail: cap browser ray casts at 400 roof samples; raise only after profiling a real large roof.
  return Array.from({ length: cap }, (_, index) => samples[Math.floor(index * samples.length / cap)]);
}

const csvCell = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function buildCsv(result = {}, project = {}, climate = {}) {
  const rough = result.rough ?? result;
  const detailed = result.detailed;
  const roughByMonth = new Map((rough.monthlyKwh ?? []).map(({ month, kwh }) => [month, kwh]));
  const detailedByMonth = new Map((detailed?.monthlyKwh ?? []).map(({ month, kwh }) => [month, kwh]));
  const formLoss = Number(project.formValues?.systemLossRatio);
  const systemLossRatio = project.systemLossRatio ?? project.input?.systemLossRatio ?? (Number.isFinite(formLoss) ? formLoss / 100 : '');
  const rows = [['월', '개략발전량_kWh', '정밀추정발전량_kWh']];
  for (let month = 1; month <= 12; month += 1) rows.push([month, roughByMonth.get(month), detailedByMonth.get(month)]);
  rows.push(
    [],
    ['항목', '값'],
    ['설치 가능면적㎡', rough.installableAreaM2],
    ['설비용량kWp', rough.capacityKwp],
    ['시스템손실률', systemLossRatio],
    ['정밀도', result.precision ?? project.precision ?? ''],
    ['표본간격m', result.spacingM ?? project.spacingM ?? ''],
    ['기후자료출처', climate.source ?? ''],
    ['분석구분', '사전 추정치'],
  );
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
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
