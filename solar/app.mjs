import { calculateRough, deserializeProject, isInsideNowon, polygonMetrics, serializeProject } from './solar-core.mjs';

const PROJECT_KEY = 'nowon-solar-project-v1';
const form = document.querySelector('#analysis-form');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const roofCoordinates = document.querySelector('#roof-coordinates');
const roofCoordinatesError = document.querySelector('#roof-coordinates-error');
const exclusionCoordinates = document.querySelector('#exclusion-coordinates');
const heightInput = document.querySelector('#building-height');
const exclusionList = document.querySelector('#exclusion-list');
let climatePromise;
let mapInstance;
let drawing;
const mapEntities = [];
const state = { mode: 'existing', roof: [], exclusions: [], heightM: 0, formValues: {}, dirty: false };

const element = (tag, text, className) => {
  const node = document.createElement(tag);
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
  status.textContent = message;
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
  if (state.roof.length >= 3) {
    form.elements.roofAreaM2.value = roofMetrics.areaM2.toFixed(1);
    form.elements.perimeterM.value = roofMetrics.perimeterM.toFixed(1);
  }
  form.elements.exclusionAreaM2.value = exclusionAreaM2.toFixed(1);
}

function clearRoofMetrics() {
  form.elements.roofAreaM2.value = '0';
  form.elements.perimeterM.value = '0';
}

function setRoofCoordinatesError(message = '') {
  roofCoordinates.toggleAttribute('aria-invalid', Boolean(message));
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
  return points.length >= 3 && isInsideNowon(points);
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

export async function selectExistingBuilding(position) {
  if (!vworldKey() || !isInsideNowon([position])) {
    manualFallback('지도 API 키 또는 선택 좌표를 확인하세요.');
    return false;
  }
  try {
    const response = await fetch(vworldUrl('/req/data', {
      service: 'data', request: 'GetFeature', data: 'LT_C_BLDGBASE', geomFilter: `POINT(${position.lon} ${position.lat})`,
      geometry: 'true', attribute: 'true', crs: 'EPSG:4326', format: 'json', key: vworldKey(),
    }));
    if (!response.ok) throw new Error('building lookup failed');
    const feature = firstFeature(await response.json());
    const polygon = polygonFromGeometry(feature?.geometry);
    if (!polygon || !setRoofPolygon(polygon)) throw new Error('building geometry missing');
    const height = featureHeight(feature.properties);
    if (height === null) {
      manualFallback('건물 높이를 직접 입력하세요.');
    } else {
      state.heightM = height;
      heightInput.value = height;
      renderMapShapes();
      markDirty();
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

function validProject(project) {
  return ['existing', 'virtual'].includes(project?.mode)
    && Array.isArray(project.roof) && (!project.roof.length || isInsideNowon(project.roof))
    && Array.isArray(project.exclusions) && project.exclusions.every(validPolygon)
    && Number.isFinite(project.heightM) && project.heightM >= 0
    && project.formValues && typeof project.formValues === 'object';
}

export function restoreProject() {
  const project = deserializeProject(localStorage.getItem(PROJECT_KEY));
  if (!project) return false;
  if (!validProject(project)) {
    localStorage.removeItem(PROJECT_KEY);
    setStatus('저장된 프로젝트가 유효하지 않아 제거했습니다.');
    return false;
  }
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

async function loadClimate() {
  climatePromise ??= fetch('./data/nowon-solar.json').then((response) => {
    if (!response.ok) throw new Error('기후 데이터를 불러오지 못했습니다.');
    return response.json();
  });
  return climatePromise;
}

export async function runAnalysis(mode) {
  if (mode === 'detailed') {
    setStatus('정밀 추정은 다음 단계에서 연결합니다.');
    return null;
  }
  try {
    const result = calculateRough(readForm(), await loadClimate());
    renderResult(result);
    return result;
  } catch (error) {
    setStatus(error.message);
    return null;
  }
}

const format = (value, fractionDigits = 1) => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: fractionDigits, minimumFractionDigits: fractionDigits });

export function renderResult(result) {
  const cards = element('div', undefined, 'cards');
  const values = [['설치 가능면적', `${format(result.installableAreaM2)} ㎡`], ['패널 수', `${format(result.panelCount, 0)} 장`], ['설비용량', `${format(result.capacityKwp)} kWp`], ['연간 발전량', `${format(result.annualKwh)} kWh/년`]];
  for (const [label, value] of values) {
    const card = element('div', undefined, 'card');
    card.append(element('span', label), element('strong', value));
    cards.append(card);
  }
  const warnings = result.warnings?.length ? element('ul', undefined, 'warnings') : null;
  result.warnings?.forEach((warning) => warnings.append(element('li', warning)));
  const chart = element('div', undefined, 'months');
  chart.id = 'monthly-chart';
  const maxKwh = Math.max(1, ...(result.monthlyKwh ?? []).map(({ kwh }) => kwh));
  for (const { month, kwh } of result.monthlyKwh ?? []) {
    const row = element('div', undefined, 'month');
    const track = element('div', undefined, 'bar-track');
    const bar = element('div', undefined, 'bar');
    bar.style.width = `${(kwh / maxKwh) * 100}%`;
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', `${month}월 ${format(kwh)} kWh`);
    track.append(bar);
    row.append(element('span', `${month}월`), track, element('span', `${format(kwh)} kWh`));
    chart.append(row);
  }
  results.replaceChildren(element('p', '개략 분석 결과', 'estimate'), cards, ...(warnings ? [warnings] : []), chart);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runAnalysis(new FormData(form).get('analysisMode'));
});
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
    clearRoofMetrics();
    setRoofCoordinatesError(error);
    setStatus(error);
  } else {
    state.roof = points;
    setRoofCoordinatesError();
    updateMetrics();
    runAnalysis('rough');
  }
  renderMapShapes();
  markDirty();
});
heightInput.addEventListener('input', () => {
  state.heightM = Number(heightInput.value);
  renderMapShapes();
  markDirty();
});
document.querySelector('#start-roof-drawing').addEventListener('click', () => { drawing = { kind: 'roof', points: [] }; clearRoof(); drawing = { kind: 'roof', points: [] }; setStatus('지도에서 지붕 꼭짓점을 차례로 선택하세요.'); });
document.querySelector('#undo-roof-point').addEventListener('click', () => { if (drawing?.kind === 'roof') { drawing.points.pop(); state.roof = [...drawing.points]; roofCoordinates.value = pointsToText(state.roof); renderMapShapes(); } });
document.querySelector('#finish-roof-drawing').addEventListener('click', finishRoofDrawing);
document.querySelector('#reset-roof').addEventListener('click', clearRoof);
document.querySelector('#start-exclusion-drawing').addEventListener('click', () => { drawing = { kind: 'exclusion', points: [] }; setStatus('지도에서 제외 영역 꼭짓점을 차례로 선택하세요.'); });
document.querySelector('#add-exclusion').addEventListener('click', () => { const points = parsePoints(exclusionCoordinates.value); if (points === null) setStatus('좌표는 한 줄에 lat, lon 형식으로 입력하세요.'); else addExclusionPolygon(points); });
document.querySelector('#search-building').addEventListener('click', searchBuilding);
document.querySelector('#select-building').addEventListener('click', () => setStatus('지도에서 기존 건물을 선택하세요.'));
document.querySelector('#save-project').addEventListener('click', saveProject);

restoreProject();
initMap();
runAnalysis('rough');
