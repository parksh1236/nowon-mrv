import { calculateRough } from './solar-core.mjs';

const form = document.querySelector('#analysis-form');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
let climatePromise;

export function loadVWorld(key) {
  if (!key) return Promise.reject(new Error("VWorld API 키가 필요합니다."));
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://map.vworld.kr/js/webglMapInit.js.do?version=3.0&apiKey=${encodeURIComponent(key)}`;
    script.onload = resolve;
    script.onerror = () => reject(new Error("VWorld 지도를 불러오지 못했습니다."));
    document.head.append(script);
  });
}

export async function initMap() {
  try {
    await loadVWorld(window.SOLAR_CONFIG?.vworldApiKey);
    if (!window.vw) throw new Error('VWorld 지도를 초기화하지 못했습니다.');
    const options = {
      mapId: 'map',
      initPosition: new vw.CameraPosition(
        new vw.CoordZ(127.056, 37.654, 8000),
        new vw.Direction(0, -70, 0),
      ),
      logo: true,
      navigation: true,
    };
    const map = new vw.Map();
    map.setOption(options);
    map.setMapId('map');
    map.setInitPosition(options.initPosition);
    map.start();
    status.textContent = `${window.SOLAR_CONFIG?.allowedRegion ?? '노원구'} VWorld 지도를 불러왔습니다.`;
    return map;
  } catch (error) {
    status.textContent = `${error.message} 수동 입력으로 개략 분석을 계속할 수 있습니다.`;
    return null;
  }
}

export function readForm() {
  const data = new FormData(form);
  const number = (name) => Number(data.get(name));
  return {
    roofAreaM2: number('roofAreaM2'),
    exclusionAreaM2: number('exclusionAreaM2'),
    perimeterM: number('perimeterM'),
    edgeSetbackM: number('edgeSetbackM'),
    layoutRatio: number('layoutRatio') / 100,
    panelAreaM2: number('panelAreaM2'),
    panelPowerKw: number('panelPowerKw'),
    moduleEfficiency: number('moduleEfficiency') / 100,
    systemLossRatio: number('systemLossRatio') / 100,
    tiltDeg: number('tiltDeg'),
    azimuthDeg: number('azimuthDeg'),
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
    status.textContent = '정밀 추정은 다음 단계에서 연결됩니다.';
    return null;
  }
  try {
    const result = calculateRough(readForm(), await loadClimate());
    renderResult(result);
    return result;
  } catch (error) {
    status.textContent = error.message;
    return null;
  }
}

const format = (value, fractionDigits = 1) => Number(value).toLocaleString('ko-KR', {
  maximumFractionDigits: fractionDigits,
  minimumFractionDigits: fractionDigits,
});

const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

export function renderResult(result) {
  const cards = element('div', undefined, 'cards');
  const values = [
    ['설치 가능면적', `${format(result.installableAreaM2)} ㎡`],
    ['패널 수', `${format(result.panelCount, 0)} 장`],
    ['설비용량', `${format(result.capacityKwp)} kWp`],
    ['연간 발전량', `${format(result.annualKwh)} kWh/년`],
  ];
  for (const [label, value] of values) {
    const card = element('div', undefined, 'card');
    card.append(element('span', label), element('strong', value));
    cards.append(card);
  }
  const estimate = element('p', '결과는 사전 추정치이며 설계·인허가 확정치가 아닙니다.', 'estimate');
  const warnings = result.warnings?.length ? element('ul', undefined, 'warnings') : null;
  result.warnings?.forEach((warning) => warnings.append(element('li', warning)));
  const chart = element('div', undefined, 'months');
  chart.id = 'monthly-chart';
  chart.setAttribute('aria-label', '월별 예상 발전량');
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
  results.replaceChildren(element('p', '개략 분석 결과', 'estimate'), cards, estimate, ...(warnings ? [warnings] : []), chart);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runAnalysis(new FormData(form).get('analysisMode'));
});

initMap();
runAnalysis('rough');
