import { buildCsv, calculateDetailed, calculateRough, filterInstallableSamples, isInsideNowon, isValidPolygon, polygonMetrics, readStoredProject, removeStoredProject, samplePolygon, serializeProject, sunPosition } from './solar-core.mjs';

const PROJECT_KEY = 'nowon-solar-project-v1';
const PRECISION = {
  fast: { gridM: 5, hours: [9, 12, 15] },
  balanced: { gridM: 3, hours: [8, 10, 12, 14, 16] },
  fine: { gridM: 2, hours: [8, 9, 10, 11, 12, 13, 14, 15, 16] },
};
const precisionLabels = { fast: '빠름', balanced: '균형', fine: '정밀' };
const doc = globalThis.document;
const form = doc?.querySelector('#analysis-form');
const status = doc?.querySelector('#status');
const results = doc?.querySelector('#results');
const roofCoordinates = doc?.querySelector('#roof-coordinates');
const roofCoordinatesError = doc?.querySelector('#roof-coordinates-error');
const exclusionCoordinates = doc?.querySelector('#exclusion-coordinates');
const heightInput = doc?.querySelector('#building-height');
const exclusionList = doc?.querySelector('#exclusion-list');
const precisionSelect = doc?.querySelector('#precision');
const precisionOptions = doc?.querySelector('#precision-options');
const detailedMode = form?.querySelector('input[name="analysisMode"][value="detailed"]');
const analysisSubmit = doc?.querySelector('#run-analysis');
const csvButton = doc?.querySelector('#download-csv');
let climatePromise;
let analysisGeneration = 0;
let busyGeneration = 0;
let mapInstance;
let drawing;
let latestResult;
const mapEntities = [];
const state = { mode: 'existing', roof: [], exclusions: [], heightM: 0, formValues: {}, dirty: false };

const element = (tag, text, className) => {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const pointsToText = (points) => points.map(({ lat, lon }) => `${lat}, ${lon}`).join('\n');

function parsePoints(value) {
  const text = value.trim();
  if (!text) return [];
  const points = text.split(/\n+/).map((line) => line.trim().split(/[\s,]+/).filter(Boolean));
  if (points.some((pair) => pair.length !== 2)) return null;
  const parsed = points.map(([lat, lon]) => ({ lat: Number(lat), lon: Number(lon) }));
  return parsed.every(({ lat, lon }) => Number.isFinite(lat) && Number.isFinite(lon)) ? parsed : null;
}

function markDirty() {
  state.dirty = true;
  state.formValues = formValues();
  invalidateAnalysis();
}

function formValues() {
  return Object.fromEntries(new FormData(form).entries());
}

function applyFormValues(values = {}) {
  for (const [name, value] of Object.entries(values)) {
    const controls = form.querySelectorAll(`[name="${CSS.escape(name)}"]`);
    controls.forEach((control) => {
      if (control.type === 'radio') control.checked = control.value === value;
      else control.value = value;
    });
  }
}

function setStatus(message) {
  if (status) status.textContent = message;
}

export function reportCurrentError(error, isCurrent = () => true) {
  if (isCurrent()) setStatus(error.message);
}

export function announceDetailedStart() {
  setStatus('정밀 추정 분석 중…');
}

function manualFallback(detail = '') {
  setStatus(`건물 정상 자료가 없어 직접 입력이 필요합니다.${detail ? ` ${detail}` : ''}`);
}

function updateModeTools() {
  document.querySelector('#existing-tools').hidden = state.mode !== 'existing';
  document.querySelector('#virtual-tools').hidden = state.mode !== 'virtual';
  form.querySelector(`input[name="buildingMode"][value="${state.mode}"]`).checked = true;
}

function updateMetrics() {
  const roofMetrics = polygonMetrics(state.roof);
  const exclusionAreaM2 = state.exclusions.reduce((sum, points) => sum + polygonMetrics(points).areaM2, 0);
  if (state.roof.length >= 3 && roofMetrics.areaM2 > 0) {
    form.elements.roofAreaM2.value = roofMetrics.areaM2.toFixed(1);
    form.elements.perimeterM.value = roofMetrics.perimeterM.toFixed(1);
  } else {
    invalidateRoof();
  }
  form.elements.exclusionAreaM2.value = exclusionAreaM2.toFixed(1);
}

function clearRoofMetrics() {
  form.elements.roofAreaM2.value = '0';
  form.elements.perimeterM.value = '0';
}

function invalidateRoof() {
  invalidateAnalysis();
  clearRoofMetrics();
}

function clearResults() {
  results?.replaceChildren(element('p', '지붕 좌표를 3개 이상 입력하면 분석 결과를 표시합니다.', 'estimate'));
}

export function invalidateAnalysis() {
  analysisGeneration += 1;
  busyGeneration = 0;
  latestResult = undefined;
  if (form) setAnalysisBusy(false);
  if (csvButton) csvButton.disabled = true;
  clearResults();
  setStatus('입력값이 변경되어 분석 결과를 지웠습니다.');
}

function setRoofCoordinatesError(message = '') {
  if (message) roofCoordinates.setAttribute('aria-invalid', 'true');
  else roofCoordinates.removeAttribute('aria-invalid');
  roofCoordinatesError.hidden = !message;
  roofCoordinatesError.textContent = message;
}

function getViewer() {
  return mapInstance?.getCesiumViewer?.() ?? window.ws3d?.viewer;
}

function removeMapEntities() {
  for (const { viewer, entity } of mapEntities.splice(0)) viewer.entities?.remove?.(entity);
}

function addMapPolygon(points, color, heightM = 0) {
  const viewer = getViewer();
  const fromDegrees = window.Cesium?.Cartesian3?.fromDegreesArray;
  if (!viewer?.entities?.add || !fromDegrees || points.length < 3) return;
  const entity = viewer.entities.add({
    polygon: {
      hierarchy: fromDegrees(points.flatMap(({ lon, lat }) => [lon, lat])),
      material: window.Cesium?.Color?.fromCssColorString?.(color) ?? color,
      outline: true,
      outlineColor: window.Cesium?.Color?.WHITE,
      extrudedHeight: heightM || undefined,
    },
  });
  mapEntities.push({ viewer, entity });
}

function renderMapShapes() {
  removeMapEntities();
  addMapPolygon(state.roof, '#16704488', state.heightM);
  state.exclusions.forEach((points) => addMapPolygon(points, '#b6434388'));
}

function renderExclusions() {
  exclusionList.replaceChildren();
  state.exclusions.forEach((points, index) => {
    const metrics = polygonMetrics(points);
    const item = element('li');
    const remove = element('button', `제외 영역 ${index + 1} 제거`, 'secondary');
    remove.type = 'button';
    remove.dataset.exclusionIndex = index;
    remove.addEventListener('click', () => {
      state.exclusions.splice(index, 1);
      updateMetrics();
      renderExclusions();
      renderMapShapes();
      markDirty();
      runAnalysis('rough');
      (exclusionList.querySelector(`[data-exclusion-index="${index}"]`) ?? exclusionCoordinates).focus();
      setStatus(`제외 영역 ${index + 1}을 제거했습니다.`);
    });
    item.append(`${index + 1}: ${metrics.areaM2.toFixed(1)}㎡ `, remove);
    exclusionList.append(item);
  });
}

function validPolygon(points) {
  return isValidPolygon(points);
}

export function setRoofPolygon(points) {
  if (!Array.isArray(points) || !validPolygon(points)) {
    setStatus('지붕은 노원구 범위 안의 좌표 3개 이상으로 입력하세요.');
    return false;
  }
  state.roof = points.map(({ lat, lon }) => ({ lat, lon }));
  roofCoordinates.value = pointsToText(state.roof);
  setRoofCoordinatesError();
  updateMetrics();
  renderMapShapes();
  markDirty();
  runAnalysis('rough');
  return true;
}

export function addExclusionPolygon(points) {
  if (!Array.isArray(points) || !validPolygon(points)) {
    setStatus('제외 영역은 노원구 범위 안의 좌표 3개 이상으로 입력하세요.');
    return false;
  }
  state.exclusions.push(points.map(({ lat, lon }) => ({ lat, lon })));
  drawing = undefined;
  exclusionCoordinates.value = '';
  updateMetrics();
  renderExclusions();
  renderMapShapes();
  markDirty();
  runAnalysis('rough');
  return true;
}

function clearRoof() {
  drawing = undefined;
  state.roof = [];
  roofCoordinates.value = '';
  updateMetrics();
  renderMapShapes();
  markDirty();
}

export function setBuildingMode(mode) {
  if (!['existing', 'virtual'].includes(mode) || mode === state.mode) return false;
  if (state.dirty && !window.confirm('저장하지 않은 변경사항을 지우시겠습니까?')) {
    updateModeTools();
    form.querySelector(`input[name="buildingMode"][value="${state.mode}"]`).focus();
    setStatus(`모드 전환을 취소했습니다. 현재 모드는 ${state.mode === 'existing' ? '기존 건물' : '가상 건물'}입니다.`);
    return false;
  }
  state.mode = mode;
  drawing = undefined;
  state.roof = [];
  state.exclusions = [];
  roofCoordinates.value = '';
  exclusionCoordinates.value = '';
  updateMetrics();
  renderExclusions();
  renderMapShapes();
  updateModeTools();
  markDirty();
  return true;
}

function setDraftPoint(point) {
  if (!drawing || !isInsideNowon([point])) return;
  drawing.points.push(point);
  if (drawing.kind === 'roof') {
    state.roof = [...drawing.points];
    roofCoordinates.value = pointsToText(state.roof);
    updateMetrics();
    renderMapShapes();
    markDirty();
  } else {
    exclusionCoordinates.value = pointsToText(drawing.points);
  }
}

function finishRoofDrawing() {
  const points = drawing?.kind === 'roof' ? drawing.points : state.roof;
  if (setRoofPolygon(points)) {
    drawing = undefined;
    setStatus('지붕 외곽을 반영했습니다.');
  }
}

function coordinateFromClick(event) {
  const cartographic = event?.cartographic ?? event;
  if (!Number.isFinite(cartographic?.latitude) || !Number.isFinite(cartographic?.longitude)) return null;
  const toDegrees = window.Cesium?.Math?.toDegrees ?? ((value) => value * 180 / Math.PI);
  const longitude = Math.abs(cartographic.longitude) <= Math.PI * 2 ? toDegrees(cartographic.longitude) : cartographic.longitude;
  const latitude = Math.abs(cartographic.latitude) <= Math.PI ? toDegrees(cartographic.latitude) : cartographic.latitude;
  return { lat: latitude, lon: longitude };
}

function wireMapClicks(map) {
  if (!map?.onClick?.addEventListener) {
    setStatus('지도 클릭을 지원하지 않습니다. 좌표 입력으로 분석을 계속할 수 있습니다.');
    return;
  }
  map.onClick.addEventListener(window, async (event) => {
    const position = coordinateFromClick(event);
    if (!position) return;
    if (drawing) setDraftPoint(position);
    else if (state.mode === 'existing') await selectExistingBuilding(position);
  });
}

function vworldUrl(path, params) {
  return `https://api.vworld.kr${path}?${new URLSearchParams(params)}`;
}

function vworldKey() {
  return window.SOLAR_CONFIG?.vworldApiKey;
}

export function buildingLookupUrl(position, key) {
  return vworldUrl('/req/data', {
    service: 'data', request: 'GetFeature', data: 'LT_C_BLDGINFO', geomFilter: `POINT(${position.lon} ${position.lat})`,
    geometry: 'true', attribute: 'true', crs: 'EPSG:4326', format: 'json', key,
  });
}

function firstFeature(response) {
  return response?.response?.result?.featureCollection?.features?.[0] ?? response?.features?.[0] ?? null;
}

function polygonFromGeometry(geometry) {
  const coordinates = geometry?.type === 'Polygon' ? geometry.coordinates?.[0] : geometry?.type === 'MultiPolygon' ? geometry.coordinates?.[0]?.[0] : null;
  if (!Array.isArray(coordinates)) return null;
  const ring = coordinates.slice(0, -1).map(([lon, lat]) => ({ lat: Number(lat), lon: Number(lon) }));
  return validPolygon(ring) ? ring : null;
}

function featureHeight(properties = {}) {
  const entry = Object.entries(properties).find(([name, value]) => /height|hgt/i.test(name) && Number.isFinite(Number(value)));
  return entry ? Number(entry[1]) : null;
}

export function applyBuildingGeometry(polygon, height, setHeight, setRoof) {
  setHeight(height ?? 0);
  return setRoof(polygon);
}

export function resetBuildingGeometry(target) {
  target.roof = [];
  target.exclusions = [];
  target.heightM = 0;
}

function clearBuildingSelection() {
  drawing = undefined;
  resetBuildingGeometry(state);
  roofCoordinates.value = '';
  exclusionCoordinates.value = '';
  heightInput.value = '0';
  updateMetrics();
  renderExclusions();
  renderMapShapes();
  markDirty();
}

export async function selectExistingBuilding(position) {
  clearBuildingSelection();
  if (!vworldKey() || !isInsideNowon([position])) {
    manualFallback('지도 API 키 또는 선택 좌표를 확인하세요.');
    return false;
  }
  try {
    const response = await fetch(buildingLookupUrl(position, vworldKey()));
    if (!response.ok) throw new Error('building lookup failed');
    const feature = firstFeature(await response.json());
    const polygon = polygonFromGeometry(feature?.geometry);
    const height = featureHeight(feature?.properties);
    const applied = polygon && applyBuildingGeometry(
      polygon,
      height,
      (value) => {
        state.heightM = value;
        heightInput.value = value;
      },
      setRoofPolygon,
    );
    if (!applied) throw new Error('building geometry missing');
    if (height === null) {
      manualFallback('건물 높이를 직접 입력하세요.');
    } else {
      setStatus('건물 외곽과 높이를 반영했습니다.');
    }
    return true;
  } catch {
    manualFallback();
    return false;
  }
}

function positionFromSearch(item) {
  const point = item?.point ?? item?.geometry?.coordinates;
  const lon = Number(point?.x ?? point?.[0]);
  const lat = Number(point?.y ?? point?.[1]);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

async function searchBuilding() {
  clearBuildingSelection();
  const query = document.querySelector('#address-query').value.trim();
  if (!query || !vworldKey()) return manualFallback('주소와 지도 API 키를 확인하세요.');
  try {
    const response = await fetch(vworldUrl('/req/search', {
      service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326', size: '10', page: '1', type: 'address', category: 'road', format: 'json', key: vworldKey(), query,
    }));
    if (!response.ok) throw new Error('address search failed');
    const result = await response.json();
    const items = result?.response?.result?.items ?? [];
    const position = positionFromSearch(items[0]);
    if (!position) throw new Error('address not found');
    await selectExistingBuilding(position);
  } catch {
    manualFallback();
  }
}

export function saveProject() {
  try {
    state.formValues = formValues();
    localStorage.setItem(PROJECT_KEY, serializeProject(state));
    state.dirty = false;
    setStatus('프로젝트를 이 기기에 저장했습니다.');
    return true;
  } catch {
    setStatus('프로젝트를 저장하지 못했습니다.');
    return false;
  }
}

export function restoreProject() {
  let stored;
  try {
    stored = readStoredProject(localStorage, PROJECT_KEY);
  } catch {
    setStatus('저장소에 접근하지 못해 프로젝트를 복원하지 않았습니다.');
    return false;
  }
  if (stored.unavailable) {
    setStatus('저장소에 접근하지 못해 프로젝트를 복원하지 않았습니다.');
    return false;
  }
  if (stored.invalid) {
    setStatus(removeStoredProject(localStorage, PROJECT_KEY)
      ? '저장된 프로젝트가 유효하지 않아 제거했습니다.'
      : '손상된 저장값을 제거하지 못했습니다. 브라우저 저장소를 직접 지워주세요.');
    return false;
  }
  const { project } = stored;
  if (!project) return false;
  state.mode = project.mode;
  state.roof = project.roof;
  state.exclusions = project.exclusions;
  state.heightM = project.heightM;
  state.formValues = project.formValues;
  applyFormValues(project.formValues);
  roofCoordinates.value = pointsToText(state.roof);
  heightInput.value = state.heightM;
  updateMetrics();
  updateModeTools();
  renderExclusions();
  renderMapShapes();
  state.dirty = false;
  setStatus('저장된 프로젝트를 복원했습니다.');
  return true;
}

export function loadVWorld(key) {
  if (!key) return Promise.reject(new Error('VWorld API 키가 필요합니다.'));
  if (window.vw) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey=${encodeURIComponent(key)}`;
    script.onload = resolve;
    script.onerror = () => reject(new Error('VWorld 지도를 불러오지 못했습니다.'));
    document.head.append(script);
  });
}

export async function initMap() {
  try {
    await loadVWorld(vworldKey());
    if (!window.vw) throw new Error('VWorld 지도를 초기화하지 못했습니다.');
    const options = {
      mapId: 'map', initPosition: new vw.CameraPosition(new vw.CoordZ(127.056, 37.654, 8000), new vw.Direction(0, -70, 0)), logo: true, navigation: true,
    };
    mapInstance = new vw.Map();
    mapInstance.setOption(options);
    mapInstance.setMapId('map');
    mapInstance.setInitPosition(options.initPosition);
    mapInstance.start();
    wireMapClicks(mapInstance);
    renderMapShapes();
    setStatus(`${window.SOLAR_CONFIG?.allowedRegion ?? '노원구'} VWorld 지도를 불러왔습니다.`);
    return mapInstance;
  } catch (error) {
    setStatus(`${error.message} 좌표 입력으로 개략 분석을 계속할 수 있습니다.`);
    return null;
  }
}

export function readForm() {
  const data = new FormData(form);
  const number = (name) => Number(data.get(name));
  return {
    roofAreaM2: number('roofAreaM2'), exclusionAreaM2: number('exclusionAreaM2'), perimeterM: number('perimeterM'), edgeSetbackM: number('edgeSetbackM'),
    layoutRatio: number('layoutRatio') / 100, panelAreaM2: number('panelAreaM2'), panelPowerKw: number('panelPowerKw'),
    moduleEfficiency: number('moduleEfficiency') / 100, systemLossRatio: number('systemLossRatio') / 100, tiltDeg: number('tiltDeg'), azimuthDeg: number('azimuthDeg'),
  };
}

export async function loadClimate(fetcher = fetch) {
  climatePromise ??= fetcher('./data/nowon-solar.json').then((response) => {
    if (!response.ok) throw new Error('기후 데이터를 불러오지 못했습니다.');
    return response.json();
  }).catch((error) => {
    climatePromise = undefined;
    throw error;
  });
  return climatePromise;
}

function setAnalysisBusy(busy) {
  detailedMode.disabled = busy;
  precisionSelect.disabled = busy;
  analysisSubmit.disabled = busy;
  analysisSubmit.setAttribute('aria-busy', String(busy));
}

export function enuDirection(origin, sun, Cesium = window.Cesium) {
  const altitude = sun.altitudeDeg * Math.PI / 180;
  const azimuth = sun.azimuthDeg * Math.PI / 180;
  const local = new Cesium.Cartesian3(
    Math.cos(altitude) * Math.sin(azimuth),
    Math.cos(altitude) * Math.cos(azimuth),
    Math.sin(altitude),
  );
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(origin);
  const direction = Cesium.Matrix4.multiplyByPointAsVector(frame, local, new Cesium.Cartesian3());
  return Cesium.Cartesian3.normalize(direction, direction);
}

export async function pickSceneFromRay(scene, ray, timeoutMs = 5000) {
  if (scene.pickFromRay) return scene.pickFromRay(ray, []);
  let timeout;
  try {
    return await Promise.race([
      scene.pickFromRayMostDetailed(ray, []),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('3D 음영 계산 시간이 초과되었습니다.')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildShadeSamples(project, quality = 'balanced', isCurrent = () => true) {
  const preset = PRECISION[quality] ?? PRECISION.balanced;
  const scene = mapInstance?.getCesiumViewer?.()?.scene ?? window.ws3d?.viewer?.scene;
  const Cesium = window.Cesium;
  const Cartesian3 = Cesium?.Cartesian3;
  const Ray = Cesium?.Ray;
  if ((!scene?.pickFromRay && !scene?.pickFromRayMostDetailed) || !Cartesian3 || !Cartesian3.fromDegrees
    || !Cartesian3.normalize || !Cartesian3.distance || !Ray
    || !Cesium?.Transforms?.eastNorthUpToFixedFrame || !Cesium?.Matrix4?.multiplyByPointAsVector) {
    throw new Error('현재 VWorld 장면에서는 3D 음영 계산을 지원하지 않습니다.');
  }

  const roofSamples = filterInstallableSamples(
    samplePolygon(project.roof, preset.gridM),
    project.roof,
    project.exclusions,
    project.input?.edgeSetbackM,
  );
  if (!roofSamples.length) throw new Error('정밀 추정에는 유효한 설치 영역이 필요합니다.');
  const raySamples = roofSamples.map((sample) => {
    const cartographic = window.Cesium?.Cartographic?.fromDegrees?.(sample.lon, sample.lat);
    const roofHeightM = (cartographic ? scene.globe?.getHeight?.(cartographic) ?? 0 : 0) + (project.heightM ?? 0);
    return { ...sample, roofHeightM, origin: Cartesian3.fromDegrees(sample.lon, sample.lat, roofHeightM) };
  });
  const shadeSamples = [];
  if (!isCurrent()) return null;
  for (let month = 1; month <= 12; month += 1) {
    if (!isCurrent()) return null;
    for (const hour of preset.hours) {
      if (!isCurrent()) return null;
      const date = new Date(Date.UTC(2026, month - 1, 15, hour - 9));
      for (const sample of raySamples) {
        const sun = sunPosition(date, sample.lat, sample.lon);
        if (sun.altitudeDeg <= 0) continue;
        const altitude = sun.altitudeDeg * Math.PI / 180;
        const origin = sample.origin;
        const direction = enuDirection(origin, sun, Cesium);
        const hit = await pickSceneFromRay(scene, new Ray(origin, direction));
        if (!isCurrent()) return null;
        shadeSamples.push({
          month,
          weight: Math.sin(altitude),
          shaded: Boolean(hit?.position && Cartesian3.distance(origin, hit.position) < 100_000),
        });
      }
    }
    if (!isCurrent()) return null;
    setStatus(`정밀 추정 분석 중: ${month}/12개월`);
    await new Promise(requestAnimationFrame);
    if (!isCurrent()) return null;
  }
  return shadeSamples;
}

export function snapshotAnalysis(rough, project, climate, precision, spacingM) {
  return {
    rough,
    detailed: null,
    precision,
    spacingM,
    project: structuredClone(project),
    climate: structuredClone(climate),
  };
}

export async function runAnalysis(mode) {
  const generation = ++analysisGeneration;
  const detailed = mode === 'detailed';
  busyGeneration = detailed ? generation : 0;
  setAnalysisBusy(detailed);
  if (detailed) announceDetailedStart();
  try {
    const input = readForm();
    const climate = await loadClimate();
    if (generation !== analysisGeneration) return null;
    const rough = calculateRough(input, climate);
    const quality = precisionSelect.value;
    const project = { ...state, input, formValues: formValues() };
    latestResult = snapshotAnalysis(rough, project, climate, precisionLabels[quality], PRECISION[quality].gridM);
    renderResult(latestResult);
    csvButton.disabled = false;
    if (!detailed) return rough;

    try {
      const shadeSamples = await buildShadeSamples({ ...state, input }, precisionSelect.value, () => generation === analysisGeneration);
      if (shadeSamples === null || generation !== analysisGeneration) return null;
      latestResult = { ...latestResult, detailed: calculateDetailed(input, climate, shadeSamples) };
      renderResult(latestResult);
      setStatus('정밀 추정 분석을 완료했습니다.');
      return latestResult.detailed;
    } catch (error) {
      if (generation === analysisGeneration) {
        latestResult = renderDetailedFailure(latestResult, error.message);
      }
      return null;
    }
  } catch (error) {
    reportCurrentError(error, () => generation === analysisGeneration);
    return null;
  } finally {
    if (generation === analysisGeneration && busyGeneration === generation) {
      busyGeneration = 0;
      setAnalysisBusy(false);
    }
  }
}

export function renderDetailedFailure(result, message) {
  const failed = { ...result, error: message };
  setStatus('');
  renderResult(failed);
  return failed;
}

const format = (value, fractionDigits = 1) => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits });

export function renderResult(result) {
  const rough = result.rough ?? result;
  const detailed = result.detailed;
  const cards = element('div', undefined, 'cards');
  const values = [
    ['설치 가능면적', `${format(rough.installableAreaM2)} ㎡`],
    ['설비용량', `${format(rough.capacityKwp)} kWp`],
    ['개략 연간 발전량', `${format(rough.annualKwh)} kWh/년`],
    ...(detailed ? [
      ['정밀 추정 연간 발전량', `${format(detailed.annualKwh)} kWh/년`],
      ['음영 손실률', `${format(detailed.shadingLossRatio * 100)} %`],
      ['정밀도 / 표본 간격', `${result.precision} / ${result.spacingM} m`],
    ] : []),
  ];
  for (const [label, value] of values) {
    const card = element('div', undefined, 'card');
    card.append(element('span', label), element('strong', value));
    cards.append(card);
  }
  const warnings = rough.warnings?.length ? element('ul', undefined, 'warnings') : null;
  rough.warnings?.forEach((warning) => warnings.append(element('li', warning)));
  const error = result.error ? element('p', result.error, 'detailed-error') : null;
  if (error) error.setAttribute('role', 'alert');
  const table = element('table', undefined, 'comparison');
  table.append(element('caption', '월별 발전량 비교'));
  const head = element('thead');
  const headRow = element('tr');
  for (const label of ['월', '개략 발전량 (kWh)', '정밀 추정 발전량 (kWh)']) {
    const cell = element('th', label);
    cell.scope = 'col';
    headRow.append(cell);
  }
  head.append(headRow);
  const body = element('tbody');
  const detailedByMonth = new Map((detailed?.monthlyKwh ?? []).map((entry) => [entry.month, entry.kwh]));
  const maxKwh = Math.max(1, ...(rough.monthlyKwh ?? []).map(({ kwh }) => kwh), ...(detailed?.monthlyKwh ?? []).map(({ kwh }) => kwh));
  for (const { month, kwh } of rough.monthlyKwh ?? []) {
    const row = element('tr');
    const monthCell = element('th', `${month}월`);
    monthCell.scope = 'row';
    row.append(monthCell, generationCell(kwh, maxKwh), generationCell(detailedByMonth.get(month), maxKwh));
    body.append(row);
  }
  table.append(head, body);
  results.replaceChildren(element('p', detailed ? '개략 분석 / 정밀 추정 결과' : '개략 분석 결과', 'estimate'), cards, ...(warnings ? [warnings] : []), ...(error ? [error] : []), table);
}

function generationCell(kwh, maxKwh) {
  const cell = element('td', kwh == null ? '' : `${format(kwh)} kWh`);
  if (kwh != null) {
    const bar = element('span', undefined, 'compare-bar');
    bar.style.width = `${(kwh / maxKwh) * 100}%`;
    bar.setAttribute('aria-hidden', 'true');
    cell.append(bar);
  }
  return cell;
}

export function downloadCsv(result, project) {
  const blob = new Blob(['\ufeff', buildCsv(result, project, result?.climate ?? {})], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'nowon-solar-analysis.csv';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

if (form) {
form.addEventListener('submit', (event) => {
  event.preventDefault();
  runAnalysis(new FormData(form).get('analysisMode'));
});
form.querySelectorAll('input[name="analysisMode"]').forEach((control) => control.addEventListener('change', () => {
  precisionOptions.hidden = control.value !== 'detailed' || !control.checked;
}));
form.addEventListener('input', (event) => {
  if (event.target.name !== 'buildingMode' && ![roofCoordinates, exclusionCoordinates, heightInput].includes(event.target)) markDirty();
});
form.querySelectorAll('input[name="buildingMode"]').forEach((control) => control.addEventListener('change', () => setBuildingMode(control.value)));
roofCoordinates.addEventListener('input', () => {
  const points = parsePoints(roofCoordinates.value);
  const error = points === null
    ? '좌표는 한 줄에 lat, lon 형식으로 입력하세요.'
    : !validPolygon(points) ? '지붕은 노원구 범위 안의 좌표 3개 이상으로 입력하세요.' : '';
  if (error) {
    state.roof = [];
    invalidateRoof();
    markDirty();
    setRoofCoordinatesError(error);
    setStatus(error);
  } else {
    state.roof = points;
    setRoofCoordinatesError();
    updateMetrics();
    markDirty();
    runAnalysis('rough');
  }
  renderMapShapes();
});
heightInput.addEventListener('input', () => {
  state.heightM = Number(heightInput.value);
  renderMapShapes();
  markDirty();
});
document.querySelector('#start-roof-drawing').addEventListener('click', () => { drawing = { kind: 'roof', points: [] }; clearRoof(); drawing = { kind: 'roof', points: [] }; setStatus('지도에서 지붕 꼭짓점을 차례로 선택하세요.'); });
document.querySelector('#undo-roof-point').addEventListener('click', () => {
  if (drawing?.kind !== 'roof') return;
  drawing.points.pop();
  state.roof = [...drawing.points];
  roofCoordinates.value = pointsToText(state.roof);
  updateMetrics();
  renderMapShapes();
  markDirty();
  if (validPolygon(state.roof)) runAnalysis('rough');
});
document.querySelector('#finish-roof-drawing').addEventListener('click', finishRoofDrawing);
document.querySelector('#reset-roof').addEventListener('click', clearRoof);
document.querySelector('#start-exclusion-drawing').addEventListener('click', () => { drawing = { kind: 'exclusion', points: [] }; setStatus('지도에서 제외 영역 꼭짓점을 차례로 선택하세요.'); });
document.querySelector('#add-exclusion').addEventListener('click', () => { const points = parsePoints(exclusionCoordinates.value); if (points === null) setStatus('좌표는 한 줄에 lat, lon 형식으로 입력하세요.'); else addExclusionPolygon(points); });
document.querySelector('#search-building').addEventListener('click', searchBuilding);
document.querySelector('#select-building').addEventListener('click', () => setStatus('지도에서 기존 건물을 선택하세요.'));
document.querySelector('#save-project').addEventListener('click', saveProject);
csvButton.addEventListener('click', () => downloadCsv(latestResult, latestResult.project));

restoreProject();
precisionOptions.hidden = new FormData(form).get('analysisMode') !== 'detailed';
initMap();
runAnalysis('rough');
}
