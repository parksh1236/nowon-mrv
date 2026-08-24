# Virtual Tree Shadow Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable virtual 3D trees whose moving shadows reduce detailed rooftop solar generation estimates and expose the before/after difference.

**Architecture:** Keep the existing static Cesium/VWorld application and project state. Render one CC0 Kenney GLB entity per tree, but calculate shade deterministically with a pure east/north/up ray-versus-cylinder function so the result does not depend on whether Cesium ray picking sees application entities.

**Tech Stack:** Static HTML/CSS, JavaScript ES modules, VWorld WebGL 3D/Cesium, Node.js built-in test runner, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-08-24-virtual-tree-shadow-design.md`

## Global Constraints

- Support only coordinates inside the existing Nowon bounds.
- Support 1–50 m tree height, 1–30 m crown diameter, and at most 50 trees.
- Keep old saved projects compatible by defaulting a missing `trees` field to `[]`.
- Use `solar/assets/tree.glb` from Kenney Nature Kit 2.1 (`Models/GLTF format/tree_default.glb`, CC0-1.0).
- Detailed analysis uses opaque vertical cylinders; rough analysis remains unchanged.
- Add no dependency, server, obstacle class, or new map abstraction.

---

### Task 1: Tree state validation and cylinder shade geometry

**Files:**
- Modify: `solar/solar-core.mjs:1-82`
- Modify: `solar/solar-core.mjs:379-428`
- Test: `solar/solar-core.test.mjs:1-90`

**Interfaces:**
- Produces: `normalizeTrees(value): Array<Tree>` where `Tree = { id: string, center: {lat:number, lon:number}, heightM:number, crownDiameterM:number }`
- Produces: `rayIntersectsTree(sample, direction, tree): boolean`; `sample` and `direction` are local ENU metres and unit direction vectors `{east,north,up}`.
- Produces: project serialization with `trees` and backward-compatible deserialization.

- [ ] **Step 1: Write failing persistence and geometry tests**

Add imports for `normalizeTrees` and `rayIntersectsTree`, then add:

```js
test('tree state round-trips and old projects default to no trees', () => {
  const tree = { id: 'tree-1', center: { lat: 37.654, lon: 127.056 }, heightM: 12, crownDiameterM: 8 };
  const state = { mode: 'virtual', roof: [], exclusions: [], heightM: 0, formValues: {}, dirty: false, trees: [tree] };
  assert.deepEqual(deserializeProject(serializeProject(state)).trees, [tree]);
  assert.deepEqual(deserializeProject(JSON.stringify({ ...state, trees: undefined })).trees, []);
});

test('invalid trees are removed without rejecting valid trees', () => {
  const valid = { id: 'tree-1', center: { lat: 37.654, lon: 127.056 }, heightM: 12, crownDiameterM: 8 };
  assert.deepEqual(normalizeTrees([
    valid,
    { ...valid, id: 'too-tall', heightM: 51 },
    { ...valid, id: 'outside', center: { lat: 36, lon: 127.056 } },
  ]), [valid]);
});

test('sun ray intersects the crown cylinder only when it crosses its volume', () => {
  const tree = { east: 5, north: 0, baseUp: 0, heightM: 12, crownDiameterM: 8 };
  assert.equal(rayIntersectsTree({ east: 0, north: 0, up: 5 }, { east: 1, north: 0, up: 0.5 }, tree), true);
  assert.equal(rayIntersectsTree({ east: 0, north: 9, up: 5 }, { east: 1, north: 0, up: 0.5 }, tree), false);
  assert.equal(rayIntersectsTree({ east: 5, north: 0, up: 13 }, { east: 0, north: 0, up: 1 }, tree), false);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test --test-name-pattern="tree state|invalid trees|sun ray intersects" solar/solar-core.test.mjs`

Expected: FAIL because `normalizeTrees` and `rayIntersectsTree` are not exported and `trees` is not serialized.

- [ ] **Step 3: Implement normalization and backward-compatible serialization**

Change the project fields and normalize on deserialization:

```js
const projectFields = ['mode', 'roof', 'exclusions', 'heightM', 'formValues', 'dirty', 'trees'];

export function normalizeTrees(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).filter((tree) => (
    typeof tree?.id === 'string' && tree.id.length > 0
    && isInsideNowon([tree.center])
    && Number.isFinite(tree.heightM) && tree.heightM >= 1 && tree.heightM <= 50
    && Number.isFinite(tree.crownDiameterM) && tree.crownDiameterM >= 1 && tree.crownDiameterM <= 30
  )).map((tree) => structuredClone(tree));
}
```

In `deserializeProject`, assign `project.trees = normalizeTrees(parsed.trees)` after copying fields. Extend `isValidProject` with `&& Array.isArray(project.trees) && project.trees.length === normalizeTrees(project.trees).length`. Before serializing, copy the state and normalize `trees` so malformed UI state cannot enter storage.

- [ ] **Step 4: Implement the finite-cylinder ray intersection**

Add a pure function using a quadratic intersection in the east/north plane, accepting only positive ray distance whose height lies inside the cylinder:

```js
export function rayIntersectsTree(sample, direction, tree) {
  const x = sample.east - tree.east;
  const y = sample.north - tree.north;
  const radius = tree.crownDiameterM / 2;
  const a = direction.east ** 2 + direction.north ** 2;
  const b = 2 * (x * direction.east + y * direction.north);
  const c = x ** 2 + y ** 2 - radius ** 2;
  const candidates = [];
  if (a > 1e-12) {
    const discriminant = b ** 2 - 4 * a * c;
    if (discriminant >= 0) {
      candidates.push((-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a));
    }
  } else if (c <= 0 && direction.up > 0) {
    candidates.push((tree.baseUp + tree.heightM - sample.up) / direction.up);
  }
  return candidates.some((distance) => {
    if (distance <= 1e-6) return false;
    const up = sample.up + distance * direction.up;
    return up >= tree.baseUp && up <= tree.baseUp + tree.heightM;
  });
}
```

- [ ] **Step 5: Run the complete core suite**

Run: `node --test solar/solar-core.test.mjs`

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add solar/solar-core.mjs solar/solar-core.test.mjs
git commit -m "feat: add virtual tree shade geometry"
```

---

### Task 2: Tree controls, map placement, and immediate 3D rendering

**Files:**
- Modify: `solar/index.html:10-65,95-135,145-153`
- Modify: `solar/app.mjs:1-55,218-365,497-540,681-735,806-845,1180-1245`
- Create: `solar/assets/tree.glb`
- Create: `solar/assets/NOTICE.md`
- Test: `solar/solar-core.test.mjs`

**Interfaces:**
- Consumes: `normalizeTrees(value)` from Task 1.
- Produces: `validateTreeInput(heightM, crownDiameterM): string[]`
- Produces: `treeEntityDefinition(tree, groundHeightM, Cesium): object`
- Produces: application state `state.trees: Tree[]` and one-click placement mode `drawing.kind === 'tree'`.

- [ ] **Step 1: Add failing tests for input bounds and entity definition**

```js
test('virtual tree input enforces documented bounds', async () => {
  const { validateTreeInput } = await import(`./app.mjs?tree-input=${Date.now()}`);
  assert.deepEqual(validateTreeInput(12, 8), []);
  assert.match(validateTreeInput(0, 8)[0], /1.*50/);
  assert.match(validateTreeInput(12, 31)[0], /1.*30/);
});

test('tree entity uses the bundled model and casts shadows', async () => {
  const Cesium = { Cartesian3: { fromDegrees: (...values) => values }, HeightReference: { NONE: 'none' }, ShadowMode: { ENABLED: 'enabled' } };
  const { treeEntityDefinition } = await import(`./app.mjs?tree-entity=${Date.now()}`);
  const definition = treeEntityDefinition({ center: { lat: 37.654, lon: 127.056 }, heightM: 12, crownDiameterM: 8 }, 20, Cesium);
  assert.deepEqual(definition.position, [127.056, 37.654, 20]);
  assert.equal(definition.model.uri, './assets/tree.glb');
  assert.equal(definition.model.shadows, 'enabled');
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test --test-name-pattern="virtual tree input|tree entity" solar/solar-core.test.mjs`

Expected: FAIL because both app exports are absent.

- [ ] **Step 3: Add accessible controls and a tree list**

Insert after the exclusion fieldset:

```html
<fieldset>
  <legend>가상 나무</legend>
  <div class="fields tree-fields">
    <label for="tree-height">높이 (m)<input id="tree-height" type="number" min="1" max="50" step="0.1" value="12"></label>
    <label for="tree-crown">수관 지름 (m)<input id="tree-crown" type="number" min="1" max="30" step="0.1" value="8"></label>
  </div>
  <p id="tree-input-error" role="alert" hidden></p>
  <button id="place-tree" type="button">지도에 나무 배치</button>
  <ul id="tree-list" class="geometry-list" aria-label="배치된 가상 나무"></ul>
</fieldset>
```

Add a green circular `가상 나무` item to `.map-legend`. Reuse `.fields`, `.geometry-list`, `.secondary`, and existing responsive rules; add only `.tree-fields { grid-template-columns: repeat(2,minmax(0,1fr)); }` and its narrow-screen one-column override if the current layout needs it.

- [ ] **Step 4: Add input validation, state, list rendering, and placement arming**

Initialize `state.trees = []`. Export:

```js
export function validateTreeInput(heightM, crownDiameterM) {
  const errors = [];
  if (!Number.isFinite(heightM) || heightM < 1 || heightM > 50) errors.push('나무 높이는 1m 이상 50m 이하로 입력하세요.');
  if (!Number.isFinite(crownDiameterM) || crownDiameterM < 1 || crownDiameterM > 30) errors.push('수관 지름은 1m 이상 30m 이하로 입력하세요.');
  return errors;
}
```

The placement button validates both values, rejects the 51st tree, then sets:

```js
drawing = { kind: 'tree', heightM, crownDiameterM };
setStatus('지도에서 가상 나무의 중심 위치를 클릭하세요.');
```

`renderTrees()` rebuilds `#tree-list`; each item uses text `나무 N · 높이 Xm · 지름 Ym` and a `type=button` delete control. Deletion splices `state.trees`, calls `renderTrees()`, `renderMapShapes()`, `markDirty()`, and announces the removed index.

- [ ] **Step 5: Route the next map click into one tree and render immediately**

At the shared map-click handler, handle `drawing?.kind === 'tree'` before roof/exclusion point accumulation:

```js
if (drawing?.kind === 'tree') {
  if (!isInsideNowon([position])) return setStatus('가상 나무는 노원구 범위 안에 배치하세요.');
  state.trees.push({
    id: `tree-${Date.now()}-${state.trees.length + 1}`,
    center: position,
    heightM: drawing.heightM,
    crownDiameterM: drawing.crownDiameterM,
  });
  drawing = undefined;
  renderTrees();
  renderMapShapes();
  markDirty();
  setStatus('가상 나무를 배치했습니다.');
  return;
}
```

The `renderMapShapes()` flow must append tree entities after roof/KML rendering rather than returning early from `renderVWorldAnalysisLayer`; change the early return into a boolean branch so tree rendering always runs.

- [ ] **Step 6: Add the Cesium model entity and fallback cylinder**

Export `treeEntityDefinition`:

```js
export function treeEntityDefinition(tree, groundHeightM = 0, Cesium = window.Cesium) {
  return {
    position: Cesium.Cartesian3.fromDegrees(tree.center.lon, tree.center.lat, groundHeightM),
    model: {
      uri: './assets/tree.glb',
      minimumPixelSize: 24,
      maximumScale: tree.heightM,
      scale: tree.heightM,
      shadows: Cesium.ShadowMode?.ENABLED,
      heightReference: Cesium.HeightReference?.NONE,
    },
  };
}
```

Use the viewer globe height when available, otherwise `0`. Attach `model.errorEvent` if exposed; on failure remove the model and add a translucent Cesium cylinder using `length: tree.heightM`, `topRadius` and `bottomRadius` equal to `tree.crownDiameterM / 2`, with its center elevated by half the height. Do not fail analysis because the visual asset failed.

- [ ] **Step 7: Vendor the exact CC0 asset and notice**

Download Kenney Nature Kit 2.1 from `https://kenney.nl/assets/nature-kit`, verify the archive SHA-256 equals `fa7974a0d342bfe63c38664ba9f8ec1a4aab8ea25f099bdc56870e33588c4d9d`, and copy `Models/GLTF format/tree_default.glb` to `solar/assets/tree.glb`.

Create `solar/assets/NOTICE.md`:

```markdown
# Third-party asset

`tree.glb` is `tree_default.glb` from Kenney Nature Kit 2.1.

- Source: https://kenney.nl/assets/nature-kit
- Creator: Kenney
- License: CC0 1.0 Universal
- License: https://creativecommons.org/publicdomain/zero/1.0/
```

- [ ] **Step 8: Save, restore, and reset trees**

On restore assign `state.trees = normalizeTrees(project.trees)` and call `renderTrees()`. Keep trees out of `resetBuildingGeometry(target)` so changing the analyzed building does not erase independently placed site obstacles. Clear `state.trees` only in the full `resetAnalysis()` flow, then call `renderTrees()`.

- [ ] **Step 9: Run syntax and tests**

Run: `node --check solar/app.mjs`

Run: `node --test solar/solar-core.test.mjs`

Expected: both PASS.

- [ ] **Step 10: Commit Task 2**

```bash
git add solar/index.html solar/app.mjs solar/solar-core.test.mjs solar/assets/tree.glb solar/assets/NOTICE.md
git commit -m "feat: place virtual trees on the solar map"
```

---

### Task 3: Include virtual trees in detailed shade samples

**Files:**
- Modify: `solar/app.mjs:901-1020`
- Modify: `solar/solar-core.mjs`
- Test: `solar/solar-core.test.mjs:430-610`

**Interfaces:**
- Consumes: `rayIntersectsTree(sample, direction, tree)` from Task 1.
- Produces: each detailed shade sample with both `shadeRatio` and `baselineShadeRatio` inputs through the existing `calculateDetailed` pipeline.
- Produces: `treeEnu(tree, origin, groundHeightM, Cesium): CylinderTree` for one common local coordinate frame.

- [ ] **Step 1: Add a failing shade integration test**

Create a focused test using the existing fake Cesium boundary setup. Make scene ray picking return no hit and place a tree between the roof sample and the fake sun direction:

```js
test('detailed shade marks a sample blocked only by a virtual tree', async () => {
  const { buildShadeSamples } = await import(`./app.mjs?tree-shade=${Date.now()}`);
  const project = {
    roof,
    exclusions: [],
    heightM: 5,
    trees: [{ id: 'tree-1', center: roof[0], heightM: 20, crownDiameterM: 10 }],
  };
  const samples = await buildShadeSamples(project, 'fast');
  assert.ok(samples.some((sample) => sample.shaded === true && sample.baselineShaded === false));
});
```

Use the same deterministic clock, `requestAnimationFrame`, Cartesian, transform, and `scene.pickFromRay` fakes already used by neighboring `buildShadeSamples` tests.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test --test-name-pattern="blocked only by a virtual tree" solar/solar-core.test.mjs`

Expected: FAIL because tree geometry is not evaluated.

- [ ] **Step 3: Convert trees and sample rays to a shared ENU frame**

Use the first roof vertex as the fixed origin for one analysis run. Convert tree centers to east/north metres with the existing Earth-radius convention:

```js
export function localOffset(origin, point) {
  const meanLat = ((origin.lat + point.lat) / 2) * Math.PI / 180;
  return {
    east: (point.lon - origin.lon) * Math.PI / 180 * 6_371_000 * Math.cos(meanLat),
    north: (point.lat - origin.lat) * Math.PI / 180 * 6_371_000,
  };
}
```

For each tree build `{ ...localOffset(origin, tree.center), baseUp: groundHeightM, heightM, crownDiameterM }`. For each roof sample use its local east/north and `up: project.heightM`. Convert the already-computed normalized sun direction into local `{east,north,up}` before it is transformed to ECEF for Cesium.

- [ ] **Step 4: Record baseline and tree-aware shade per ray**

For every month/hour/sample ray:

```js
const baselineShaded = Boolean(await pickSceneFromRay(scene, ray));
const treeShaded = localTrees.some((tree) => rayIntersectsTree(localSample, localSun, tree));
shadeSamples.push({ month, hour, shaded: baselineShaded || treeShaded, baselineShaded });
```

Preserve generation cancellation checks before and after awaited scene picking. Avoid a second Cesium ray cast: baseline and tree-aware results share the same scene result.

- [ ] **Step 5: Calculate baseline and tree-aware detailed results once**

In `runAnalysis`, derive two arrays from the returned samples:

```js
const detailed = calculateDetailed(input, climate, shadeSamples);
const baselineDetailed = calculateDetailed(
  input,
  climate,
  shadeSamples.map((sample) => ({ ...sample, shaded: sample.baselineShaded })),
);
latestResult = { ...latestResult, detailed, baselineDetailed };
```

Do not run `buildShadeSamples` twice. If there are no trees, both calculations receive identical shade values.

- [ ] **Step 6: Run focused and complete tests**

Run: `node --test --test-name-pattern="blocked only by a virtual tree|shade ray|scene ray" solar/solar-core.test.mjs`

Run: `node --test solar/solar-core.test.mjs`

Expected: all tests PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add solar/app.mjs solar/solar-core.mjs solar/solar-core.test.mjs
git commit -m "feat: include virtual trees in detailed shade"
```

---

### Task 4: Present and export the generation difference

**Files:**
- Modify: `solar/app.mjs:1055-1180`
- Modify: `solar/solar-core.mjs:379-428`
- Test: `solar/solar-core.test.mjs:360-430,900-920`

**Interfaces:**
- Consumes: result fields `detailed` and `baselineDetailed` from Task 3.
- Produces: `treeImpact(result): { baselineAnnualKwh:number, annualKwh:number, lossKwh:number, lossRatio:number } | null`
- Produces: CSV metadata rows for tree count and annual before/after/difference.

- [ ] **Step 1: Add failing impact and CSV tests**

```js
test('tree impact reports a non-negative annual loss', async () => {
  const { treeImpact } = await import(`./app.mjs?tree-impact=${Date.now()}`);
  assert.deepEqual(treeImpact({
    baselineDetailed: { annualKwh: 1000 },
    detailed: { annualKwh: 850 },
  }), { baselineAnnualKwh: 1000, annualKwh: 850, lossKwh: 150, lossRatio: 0.15 });
});

test('CSV includes virtual tree count and before-after generation', () => {
  const csv = buildCsv(
    { detailed: { annualKwh: 850 }, baselineDetailed: { annualKwh: 1000 } },
    { trees: [{ id: 'tree-1', center: { lat: 37.654, lon: 127.056 }, heightM: 12, crownDiameterM: 8 }] },
    {},
  );
  assert.match(csv, /가상 나무 수,1/);
  assert.match(csv, /나무 미반영 연간 발전량\(kWh\),1000/);
  assert.match(csv, /나무로 인한 감소량\(kWh\),150/);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test --test-name-pattern="tree impact|CSV includes virtual tree" solar/solar-core.test.mjs`

Expected: FAIL because the helper and CSV rows are absent.

- [ ] **Step 3: Implement one impact helper and result cards**

```js
export function treeImpact(result = {}) {
  const baselineAnnualKwh = Number(result.baselineDetailed?.annualKwh);
  const annualKwh = Number(result.detailed?.annualKwh);
  if (!Number.isFinite(baselineAnnualKwh) || !Number.isFinite(annualKwh)) return null;
  const lossKwh = Math.max(0, baselineAnnualKwh - annualKwh);
  return { baselineAnnualKwh, annualKwh, lossKwh, lossRatio: baselineAnnualKwh > 0 ? lossKwh / baselineAnnualKwh : 0 };
}
```

In `renderResult`, when impact exists add cards labeled `나무 미반영 발전량`, `나무 반영 발전량`, `나무로 인한 감소량`, and `나무 영향 감소율`. In `calculationBasisRows`, add `가상 나무 음영` with the tree count and cylinder simplification. Keep the current detailed generation card only once; rename it to `나무 반영 정밀 발전량` when trees exist.

- [ ] **Step 4: Add exact CSV rows**

In `buildCsv`, append before monthly rows:

```js
['가상 나무 수', normalizeTrees(project.trees).length],
['나무 미반영 연간 발전량(kWh)', result.baselineDetailed?.annualKwh ?? ''],
['나무 반영 연간 발전량(kWh)', result.detailed?.annualKwh ?? ''],
['나무로 인한 감소량(kWh)', Math.max(0, (result.baselineDetailed?.annualKwh ?? 0) - (result.detailed?.annualKwh ?? 0))],
```

Also add one row per tree after project metadata: `가상 나무 N,"lat,lon",높이,수관 지름`. Use the existing CSV escaping helper rather than manual quoting.

- [ ] **Step 5: Run all checks**

Run: `node --test solar/solar-core.test.mjs`

Run: `node --check solar/app.mjs`

Run: `node --check solar/solar-core.mjs`

Run: `git diff --check`

Expected: all exit 0.

- [ ] **Step 6: Commit Task 4**

```bash
git add solar/app.mjs solar/solar-core.mjs solar/solar-core.test.mjs
git commit -m "feat: compare solar output with virtual trees"
```

---

### Task 5: Browser verification and release readiness

**Files:**
- Modify only if a verified defect requires it: `solar/index.html`, `solar/app.mjs`, `solar/solar-core.mjs`, `solar/solar-core.test.mjs`

**Interfaces:**
- Consumes: complete Tasks 1–4.
- Produces: verified static application ready for the existing GitHub Pages workflow.

- [ ] **Step 1: Serve the repository over HTTP**

Run from the repository root: `python -m http.server 4173`

Expected: `http://localhost:4173/solar/` loads; do not test from `file://` because ES modules and GLB loading require HTTP.

- [ ] **Step 2: Verify immediate placement and deletion**

In the browser:

1. Enter height `12` and crown diameter `8`.
2. Click `지도에 나무 배치`, then click a Nowon map location.
3. Confirm the tree appears before any zoom or pan.
4. Place a second tree and confirm both list entries and both models remain.
5. Delete the first entry and confirm only its model disappears.

Expected: each action announces status text and causes no console error.

- [ ] **Step 3: Verify shadow motion and fallback**

Enable `그림자 표시`, choose a sunny daytime hour, and move the time slider by at least three hours.

Expected: the tree shadow direction or length changes. Temporarily rename `tree.glb`, reload, and confirm a cylinder appears and the application remains usable; restore the exact filename immediately after the check.

- [ ] **Step 4: Verify detailed before/after analysis**

Select or draw a roof, place a tree where its daytime shadow crosses the roof, and run balanced detailed analysis.

Expected:

- `나무 반영 발전량 <= 나무 미반영 발전량`
- decrease cards and CSV values agree
- removing the tree and rerunning makes decrease `0`
- rough output is unchanged by tree placement

- [ ] **Step 5: Verify persistence and backward compatibility**

Save a project with two trees, reload, and restore it.

Expected: both tree list items, coordinates, dimensions, and map models return. Then load a pre-feature saved project without `trees`; expected: the project restores with an empty tree list.

- [ ] **Step 6: Run the final local gate**

Run: `node --test solar/solar-core.test.mjs`

Run: `node --check solar/app.mjs`

Run: `node --check solar/solar-core.mjs`

Run: `git diff --check`

Expected: all exit 0.

- [ ] **Step 7: Commit any verified fixes**

If browser verification required code changes:

```bash
git add solar/index.html solar/app.mjs solar/solar-core.mjs solar/solar-core.test.mjs
git commit -m "fix: finish virtual tree browser flow"
```

If no code changed, do not create an empty commit.
