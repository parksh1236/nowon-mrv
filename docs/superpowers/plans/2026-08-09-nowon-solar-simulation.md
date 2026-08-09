# 노원구 VWorld 태양광 건축 시뮬레이터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노원구의 기존 건물과 가상 건물을 대상으로 태양광 설치 가능면적과 개략·정밀 추정 발전량을 계산하는 독립 정적 웹 앱을 만들고 GitHub Pages에 배포한다.

**Architecture:** `solar/` 아래의 정적 HTML과 ES 모듈만 사용한다. VWorld WebGL 3D API 3.0은 지도와 3D 객체 표시를 담당하고, 지도와 분리된 순수 JavaScript 함수가 면적·태양 위치·발전량을 계산한다. 서버와 신규 패키지는 추가하지 않으며 VWorld가 실패해도 수동 입력 기반 개략 계산은 동작한다.

**Tech Stack:** HTML5, CSS, JavaScript ES modules, VWorld WebGL 3D API 3.0, Node.js built-in `node:test`/`assert`, GitHub Pages

## Global Constraints

- 첫 배포 지역은 노원구로 제한한다.
- 기존 건물과 가상 건물 모두 개략 분석과 정밀 추정을 지원한다.
- 정밀 결과는 인허가·구조설계용 확정치가 아닌 `정밀 추정`으로 표시한다.
- 항공영상 기반 장애물 자동 판독, 구조 안전성, 경제성, 계통연계, 사용자 계정은 만들지 않는다.
- `config.local.js`와 실제 VWorld 키는 Git에 포함하지 않는다.
- 브라우저용 키는 배포 페이지에서 노출될 수 있으므로 VWorld 콘솔의 배포 도메인 제한을 필수로 안내한다.
- 접근 가능한 레이블, 키보드 조작, 색상 외 상태 텍스트, 모바일 세로 배치를 유지한다.
- 외부 런타임 의존성은 VWorld API 하나만 허용한다.

---

## File Map

- Create `solar/index.html`: 독립 워크벤치 마크업과 앱 스타일
- Create `solar/config.example.js`: 키 없는 설정 예시
- Create `solar/solar-core.mjs`: 좌표 면적, 입력 검증, 태양 위치, 개략·정밀 발전량 순수 함수
- Create `solar/solar-core.test.mjs`: Node 기본 테스트
- Create `solar/app.mjs`: DOM 상태, VWorld 초기화, 지도/도형 작업, 결과 렌더링, 저장, CSV
- Create `solar/data/nowon-solar.json`: 노원구 프로토타입 월별 일사량과 출처·보정 메타데이터
- Create `solar/README.md`: 로컬 실행, 키 설정, 분석 한계, 배포 URL 안내
- Modify `.gitignore`: `solar/config.local.js` 제외

### Task 1: 계산 엔진과 데이터 계약

**Files:**
- Create: `solar/solar-core.mjs`
- Create: `solar/solar-core.test.mjs`
- Create: `solar/data/nowon-solar.json`

**Interfaces:**
- Produces: `polygonMetrics(points)`, `validateInputs(input)`, `sunPosition(date, latitude, longitude)`, `calculateRough(input, climate)`, `calculateDetailed(input, climate, shadeSamples)`
- `points`: `Array<{lat:number, lon:number}>`
- `input`: `{roofAreaM2, exclusionAreaM2, perimeterM, edgeSetbackM, layoutRatio, panelAreaM2, panelPowerKw, moduleEfficiency, systemLossRatio, tiltDeg, azimuthDeg}`
- `climate.months`: `Array<{month:number, dailyGhiKwhM2:number, days:number}>`
- `shadeSamples`: `Array<{month:number, weight:number, shaded:boolean}>`
- Result: `{usableAreaM2, installableAreaM2, panelCount, capacityKwp, monthlyKwh, annualKwh, shadingLossRatio, warnings}`

- [ ] **Step 1: Write failing tests for geometry and rough calculation**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { polygonMetrics, calculateRough } from "./solar-core.mjs";

const validInput = {
  roofAreaM2: 120, exclusionAreaM2: 20, perimeterM: 42, edgeSetbackM: 0,
  layoutRatio: 0.8, panelAreaM2: 2, panelPowerKw: 0.45,
  moduleEfficiency: 0.225, systemLossRatio: 0.14, tiltDeg: 20, azimuthDeg: 180,
};
const fullClimate = {
  diffuseFraction: 0.2,
  months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, dailyGhiKwhM2: 3, days: 30 })),
};

test("polygonMetrics calculates a small Nowon roof", () => {
  const result = polygonMetrics([
    { lat: 37.6540, lon: 127.0560 },
    { lat: 37.6540, lon: 127.0561 },
    { lat: 37.6541, lon: 127.0561 },
    { lat: 37.6541, lon: 127.0560 },
  ]);
  assert.ok(result.areaM2 > 90 && result.areaM2 < 110);
  assert.ok(result.perimeterM > 39 && result.perimeterM < 43);
});

test("calculateRough floors panel count and applies losses", () => {
  const result = calculateRough({
    roofAreaM2: 120, exclusionAreaM2: 20, perimeterM: 42, edgeSetbackM: 0,
    layoutRatio: 0.8, panelAreaM2: 2, panelPowerKw: 0.45,
    moduleEfficiency: 0.225, systemLossRatio: 0.14, tiltDeg: 20, azimuthDeg: 180,
  }, { months: [{ month: 1, dailyGhiKwhM2: 3, days: 31 }] });
  assert.equal(result.panelCount, 40);
  assert.equal(result.capacityKwp, 18);
  assert.ok(result.monthlyKwh[0] > 1300 && result.monthlyKwh[0] < 1500);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test solar/solar-core.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `solar-core.mjs`.

- [ ] **Step 3: Implement the minimal pure calculation module**

```js
const RAD = Math.PI / 180;
const EARTH_M = 6_371_000;

export function polygonMetrics(points) {
  if (points.length < 3) return { areaM2: 0, perimeterM: 0 };
  const lat0 = points.reduce((sum, p) => sum + p.lat, 0) / points.length * RAD;
  const xy = points.map(p => ({ x: EARTH_M * p.lon * RAD * Math.cos(lat0), y: EARTH_M * p.lat * RAD }));
  let twiceArea = 0, perimeterM = 0;
  xy.forEach((p, i) => {
    const q = xy[(i + 1) % xy.length];
    twiceArea += p.x * q.y - q.x * p.y;
    perimeterM += Math.hypot(q.x - p.x, q.y - p.y);
  });
  return { areaM2: Math.abs(twiceArea) / 2, perimeterM };
}

export function validateInputs(input) {
  const warnings = [];
  if (!(input.roofAreaM2 > 0)) warnings.push("지붕면적은 0보다 커야 합니다.");
  if (input.exclusionAreaM2 < 0) warnings.push("제외면적은 0 이상이어야 합니다.");
  if (!(input.layoutRatio > 0 && input.layoutRatio <= 1)) warnings.push("배치율은 0 초과 1 이하여야 합니다.");
  if (!(input.systemLossRatio >= 0 && input.systemLossRatio < 1)) warnings.push("손실률은 0 이상 1 미만이어야 합니다.");
  return warnings;
}
```

Complete `calculateRough` with the approved formula. Estimate inward edge area as `perimeterM * edgeSetbackM - Math.PI * edgeSetbackM ** 2`, clamp every area at zero, and add this source comment:

```js
// ponytail: convex-roof setback approximation; replace with polygon offsetting if irregular-roof error becomes material.
```

Implement `sunPosition` using the NOAA fractional-year approximation and `calculateDetailed` by applying the weighted shaded fraction to the rough result's direct component. Keep diffuse fraction configurable in the climate JSON and default it to `0.2`.

- [ ] **Step 4: Add boundary, sun-position, and detailed-shading tests**

```js
test("invalid usable area is clamped and reported", () => {
  const result = calculateRough({
    roofAreaM2: 10, exclusionAreaM2: 20, perimeterM: 12, edgeSetbackM: 0,
    layoutRatio: 0.8, panelAreaM2: 2, panelPowerKw: 0.45,
    moduleEfficiency: 0.225, systemLossRatio: 0.14, tiltDeg: 20, azimuthDeg: 180,
  }, { months: [] });
  assert.equal(result.usableAreaM2, 0);
  assert.equal(result.panelCount, 0);
  assert.ok(result.warnings.length > 0);
});

test("summer noon sun is above the horizon in Nowon", () => {
  const sun = sunPosition(new Date("2026-06-21T03:00:00Z"), 37.654, 127.056);
  assert.ok(sun.altitudeDeg > 70);
});

test("detailed analysis reduces only the direct component", () => {
  const result = calculateDetailed(validInput, fullClimate, [
    { month: 1, weight: 1, shaded: true },
    { month: 1, weight: 1, shaded: false },
  ]);
  assert.ok(result.shadingLossRatio > 0 && result.shadingLossRatio < 0.5);
});
```

- [ ] **Step 5: Add Nowon climate data with explicit prototype metadata**

```json
{
  "region": "서울특별시 노원구",
  "latitude": 37.654,
  "longitude": 127.056,
  "source": "기상청 위성기반 태양광 기상자원지도 2020-2024 평균",
  "sourceUrl": "https://data.kma.go.kr/data/weatherResourceMap/selectWeatherResourceMapSlaNew.do?pgmNo=756&srt=ANN",
  "quality": "prototype-calibration-required",
  "diffuseFraction": 0.2,
  "months": [
    { "month": 1, "dailyGhiKwhM2": 2.13, "days": 31 },
    { "month": 2, "dailyGhiKwhM2": 2.99, "days": 28 },
    { "month": 3, "dailyGhiKwhM2": 3.91, "days": 31 },
    { "month": 4, "dailyGhiKwhM2": 4.77, "days": 30 },
    { "month": 5, "dailyGhiKwhM2": 5.30, "days": 31 },
    { "month": 6, "dailyGhiKwhM2": 4.60, "days": 30 },
    { "month": 7, "dailyGhiKwhM2": 3.55, "days": 31 },
    { "month": 8, "dailyGhiKwhM2": 4.06, "days": 31 },
    { "month": 9, "dailyGhiKwhM2": 3.77, "days": 30 },
    { "month": 10, "dailyGhiKwhM2": 3.46, "days": 31 },
    { "month": 11, "dailyGhiKwhM2": 2.31, "days": 30 },
    { "month": 12, "dailyGhiKwhM2": 1.89, "days": 31 }
  ]
}
```

These are explicit Seoul prototype defaults, not claimed as the final KMA grid extraction. The app must show `quality` as a warning until the values are validated against the downloaded KMA grid cell.

- [ ] **Step 6: Run tests and commit**

Run: `node --test solar/solar-core.test.mjs`

Expected: all tests PASS.

```bash
git add solar/solar-core.mjs solar/solar-core.test.mjs solar/data/nowon-solar.json
git commit -m "태양광 면적·발전량 계산 엔진 추가"
```

### Task 2: 독립 분석 워크벤치와 VWorld 초기화

**Files:**
- Create: `solar/index.html`
- Create: `solar/config.example.js`
- Create: `solar/app.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 1 calculation exports
- Produces: `loadVWorld(key)`, `initMap()`, `readForm()`, `runAnalysis(mode)`, `renderResult(result)`
- DOM contract: `#map`, `#analysis-form`, `#building-mode`, `#analysis-mode`, `#status`, `#results`, `#monthly-chart`

- [ ] **Step 1: Add the standalone accessible workbench**

Create semantic HTML containing:

```html
<header><p class="eyebrow">NOWON SOLAR LAB</p><h1>태양광 건축 사전분석</h1></header>
<main class="workbench">
  <aside>
    <fieldset id="building-mode"><legend>분석 대상</legend><!-- 기존/가상 라디오 --></fieldset>
    <form id="analysis-form"><!-- 숫자 입력은 label + input 조합 --></form>
  </aside>
  <section class="map-panel" aria-label="3차원 지도"><div id="map"></div><p id="status" role="status"></p></section>
  <section id="results" aria-live="polite"><!-- 결과 카드와 월별 차트 --></section>
</main>
```

Keep CSS inside `index.html` to match the repository's dependency-free static pattern. Use a responsive three-area grid above 1100px and a single column below it. Provide visible focus styles and do not use color as the only mode indicator.

- [ ] **Step 2: Add safe key configuration and loader**

`config.example.js`:

```js
window.SOLAR_CONFIG = { vworldApiKey: "", allowedRegion: "노원구" };
```

`.gitignore` addition:

```gitignore
solar/config.local.js
```

`app.mjs` loader:

```js
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
```

Load `config.example.js`, then optional `config.local.js`, then `app.mjs`. Missing keys leave the form calculation available but show the manual-input fallback message.

- [ ] **Step 3: Initialize the map at Nowon**

Use the official VWorld 3.0 pattern:

```js
const options = {
  mapId: "map",
  initPosition: new vw.CameraPosition(
    new vw.CoordZ(127.056, 37.654, 8000),
    new vw.Direction(0, -70, 0)
  ),
  logo: true,
  navigation: true,
};
const map = new vw.Map();
map.setOption(options);
map.setMapId("map");
map.setInitPosition(options.initPosition);
map.start();
```

Wrap initialization in `try/catch`; on error write the message into `#status` and keep manual fields enabled.

- [ ] **Step 4: Wire form input to rough calculation and result cards**

`readForm()` returns the exact Task 1 `input` object. `runAnalysis("rough")` fetches `data/nowon-solar.json`, calls `calculateRough`, and renders formatted `㎡`, `kWp`, `kWh/년`, warnings, and an accessible HTML table that also drives the CSS monthly bar chart.

- [ ] **Step 5: Run local smoke check and commit**

Run: `python -m http.server 8737`

Open: `http://localhost:8737/solar/`

Expected: workbench renders; missing-key status is visible; manual values produce result cards and 12 monthly rows.

```bash
git add .gitignore solar/index.html solar/config.example.js solar/app.mjs
git commit -m "독립 태양광 분석 워크벤치 추가"
```

### Task 3: 기존·가상 건물 지도 작업과 로컬 저장

**Files:**
- Modify: `solar/index.html`
- Modify: `solar/app.mjs`
- Modify: `solar/solar-core.mjs`
- Modify: `solar/solar-core.test.mjs`

**Interfaces:**
- Consumes: `polygonMetrics(points)` and VWorld `map`
- Produces: `setBuildingMode(mode)`, `setRoofPolygon(points)`, `addExclusionPolygon(points)`, `selectExistingBuilding(position)`, `saveProject()`, `restoreProject()`
- Stored project key: `nowon-solar-project-v1`

- [ ] **Step 1: Add a serialization test**

Move serialization into exported pure helpers in `solar-core.mjs`:

```js
test("project state round-trips without functions or map objects", () => {
  const state = { mode: "virtual", roof: [{ lat: 37.65, lon: 127.05 }], exclusions: [], heightM: 24 };
  assert.deepEqual(deserializeProject(serializeProject(state)), state);
});
```

Run: `node --test solar/solar-core.test.mjs`

Expected: FAIL because serialization exports do not exist.

- [ ] **Step 2: Implement project serialization and persistence**

```js
export const serializeProject = state => JSON.stringify(state);
export const deserializeProject = value => JSON.parse(value);
```

In `app.mjs`, save only plain coordinates and input values. Never store the API key or VWorld objects.

- [ ] **Step 3: Implement virtual-building drawing**

Add `건물 외곽 그리기`, `마지막 점 취소`, `완료`, `초기화` buttons. Use map click coordinates when the VWorld event API is available; otherwise accept pasted latitude/longitude rows. On completion call `polygonMetrics`, populate roof area/perimeter, validate that every point lies inside the conservative Nowon bounding box `37.58 ≤ lat ≤ 37.70`, `127.00 ≤ lon ≤ 127.12`, and render a simple extruded polygon through the VWorld/Cesium object exposed by API 3.0.

- [ ] **Step 4: Implement existing-building selection with explicit fallback**

Provide address search and map click. Call the address endpoint with `https://api.vworld.kr/req/search?service=search&request=search&version=2.0&crs=EPSG:4326&size=10&page=1&type=address&category=road&format=json&key=...&query=...`, then query `LT_C_BLDGBASE` through `/req/data` for the returned point. Use returned geometry/attributes when present. If the response has no polygon or height, keep the selected location, switch the missing fields to editable state, and show `건물 형상 자료가 없어 직접 입력이 필요합니다.` Do not synthesize silent values.

- [ ] **Step 5: Implement exclusion drawing and mode cleanup**

Reuse the polygon drawing path for exclusions. Subtract the sum of exclusion polygon areas and show each area in a removable list. Switching building modes clears map-only objects after confirmation only when unsaved edits exist; otherwise clear directly.

- [ ] **Step 6: Verify both flows and commit**

Run: `node --test solar/solar-core.test.mjs`

Browser checks:

1. Draw a virtual four-point roof, set height, draw one exclusion, calculate.
2. Search one Nowon address; if geometry is absent, complete manual fallback and calculate.
3. Reload and confirm the last project restores without persisting the key.

```bash
git add solar/index.html solar/app.mjs solar/solar-core.mjs solar/solar-core.test.mjs
git commit -m "기존·가상 건물 지도 분석 흐름 추가"
```

### Task 4: 정밀 음영 추정과 결과 내보내기

**Files:**
- Modify: `solar/index.html`
- Modify: `solar/app.mjs`
- Modify: `solar/solar-core.mjs`
- Modify: `solar/solar-core.test.mjs`

**Interfaces:**
- Consumes: `sunPosition`, `calculateDetailed`, selected roof geometry, VWorld/Cesium scene
- Produces: `buildShadeSamples(project, quality)`, `downloadCsv(result, project)`, precision options `fast|balanced|fine`

- [ ] **Step 1: Add deterministic detailed-analysis tests**

```js
test("unshaded detailed output matches rough output", () => {
  const rough = calculateRough(validInput, fullClimate);
  const detailed = calculateDetailed(validInput, fullClimate,
    fullClimate.months.map(({ month }) => ({ month, weight: 1, shaded: false })));
  assert.ok(Math.abs(detailed.annualKwh - rough.annualKwh) < 0.01);
});
```

Run: `node --test solar/solar-core.test.mjs`

Expected: FAIL until detailed weighting is corrected.

- [ ] **Step 2: Implement precision sampling presets**

```js
const PRECISION = {
  fast: { gridM: 5, hours: [9, 12, 15] },
  balanced: { gridM: 3, hours: [8, 10, 12, 14, 16] },
  fine: { gridM: 2, hours: [8, 9, 10, 11, 12, 13, 14, 15, 16] },
};
```

Resolve the scene with one documented adapter and no further abstraction:

```js
function getScene(map) {
  return map?.getCesiumViewer?.()?.scene ?? window.ws3d?.viewer?.scene ?? null;
}
```

For each month, roof sample point, and hour, compute the sun direction, build a Cesium ray, and call `scene.pickFromRayMostDetailed(ray, [])` when present. Count a hit before the sunward maximum distance as shaded. Yield to the browser between monthly batches with `await new Promise(requestAnimationFrame)` and update `#status` progress.

- [ ] **Step 3: Add safe fallback for unsupported ray casting**

Feature-detect the scene ray API. If absent or rejected, preserve the rough result, set detailed status to failed, and show `현재 VWorld 장면에서는 3D 음영 계산을 지원하지 않습니다.` Do not label the rough result as detailed.

- [ ] **Step 4: Render detailed comparison and CSV**

Show rough vs detailed annual generation, shading loss, sampling preset and data-quality warning. Create CSV with UTF-8 BOM and columns `월,개략발전량_kWh,정밀추정발전량_kWh`; add metadata rows for area, capacity, loss assumptions and source. Trigger download with `Blob`, `URL.createObjectURL`, a temporary anchor, and `URL.revokeObjectURL`.

- [ ] **Step 5: Verify and commit**

Run: `node --test solar/solar-core.test.mjs`

Browser checks:

1. An unshaded sample produces detailed output close to rough output.
2. A shaded sample lowers direct generation and reports the loss.
3. Unsupported ray casting keeps rough output and shows the detailed-only error.
4. CSV opens with Korean headers and 12 monthly rows.

```bash
git add solar/index.html solar/app.mjs solar/solar-core.mjs solar/solar-core.test.mjs
git commit -m "시간대별 3D 음영 추정과 CSV 추가"
```

### Task 5: 문서화, 전체 검증, GitHub Pages 배포

**Files:**
- Create: `solar/README.md`
- Modify only if needed: `solar/index.html`, `solar/app.mjs`, `solar/solar-core.mjs`

**Interfaces:**
- Consumes: completed standalone app
- Produces: public URL `https://parksh1236.github.io/nowon-mrv/solar/`

- [ ] **Step 1: Document setup and limitations**

Include exact local setup:

```js
// solar/config.local.js
window.SOLAR_CONFIG = { vworldApiKey: "발급받은_키", allowedRegion: "노원구" };
```

```powershell
python -m http.server 8737
```

Document the URL `http://localhost:8737/solar/`, VWorld localhost and GitHub Pages domain allow-list requirements, data quality warning, and the non-engineering-use disclaimer.

- [ ] **Step 2: Run automated checks**

Run:

```powershell
node --test solar/solar-core.test.mjs
git diff --check
```

Expected: all tests PASS and `git diff --check` prints nothing.

- [ ] **Step 3: Run browser acceptance checks**

Serve the repository and verify desktop plus mobile width:

1. Workbench layout and keyboard focus order.
2. Missing-key manual rough calculation.
3. VWorld-key map initialization.
4. Existing building selection/manual fallback.
5. Virtual building/exclusion drawing.
6. Rough and detailed result labels.
7. Project restore and CSV download.

- [ ] **Step 4: Review security and secrets**

Run:

```powershell
rg -n "apiKey|vworldApiKey" solar
git status --short
```

Expected: only placeholders/config access appear; `solar/config.local.js` is ignored and no real key is staged.

- [ ] **Step 5: Commit final documentation and fixes**

```bash
git add solar/README.md solar/index.html solar/app.mjs solar/solar-core.mjs solar/solar-core.test.mjs solar/data/nowon-solar.json
git commit -m "노원구 태양광 시뮬레이터 배포 준비"
```

- [ ] **Step 6: Push and enable or verify GitHub Pages**

```bash
git push origin master
gh api repos/parksh1236/nowon-mrv/pages
```

If Pages is not configured, enable deployment from `master` root using the repository settings or the equivalent GitHub API, then verify:

```text
https://parksh1236.github.io/nowon-mrv/solar/
```

Do not publish until the VWorld key's allowed domains include `parksh1236.github.io` and local verification has passed.

---

## Plan Self-Review

- Spec coverage: existing building, virtual building, exclusions, rough/detailed analysis, results, CSV, local storage, errors, accessibility, tests, key handling and deployment are assigned to Tasks 1-5.
- Dependency check: no package manager, framework, backend or new runtime dependency is introduced.
- Type consistency: Task 1 defines the calculation input/result contracts consumed unchanged by Tasks 2-4.
- Known ceiling: edge setback is a documented convex-roof approximation; irregular-roof polygon offsetting is deferred until measured error justifies it.
