# Cross-Platform Virtual Tree Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed virtual-tree solar simulation available from the nowon-mrv landing page and the native nowon-energy-platform Solar Lab.

**Architecture:** The nowon-mrv landing page keeps its existing iframe and only refreshes its cache key. The energy platform keeps its native map/UI and ports the already-tested tree state, cylinder shade calculation, GLB rendering, editing, result comparison, and persistence into its local Solar Lab files.

**Tech Stack:** Static HTML/CSS, JavaScript ES modules, VWorld WebGL 3D/Cesium, Node.js built-in test runner, GitHub Pages

**Spec:** `docs/superpowers/specs/2026-08-24-cross-platform-virtual-tree-port-design.md`

## Global Constraints

- No new dependency, server, iframe replacement, or cross-repository runtime import.
- Preserve the energy platform's existing DOM IDs, integrated VWorld map, tabs, and result overlay.
- Tree bounds: height 1–50m, crown diameter 1–30m, maximum 50 trees.
- Use the exact verified Kenney GLB already tracked at `nowon-mrv/solar/assets/tree.glb`.
- Do not modify or commit unrelated `docs/research/` files.

---

### Task 1: Refresh the nowon-mrv landing-page Solar Lab

**Files:**
- Modify: `C:/Users/user/projects/nowon-mrv/index.html:365`

**Interfaces:**
- Consumes: existing deployed `./solar/` application.
- Produces: landing-page iframe URL `./solar/?v=20260824-virtual-tree-1`.

- [ ] **Step 1: Change only the iframe cache key**

```html
<iframe class="solar-lab-frame" src="./solar/?v=20260824-virtual-tree-1" title="Solar Lab 태양광 건축 사전분석" loading="lazy"></iframe>
```

- [ ] **Step 2: Verify the static change**

Run: `git diff --check`

Expected: exit 0 and no Solar Lab code duplication in root `index.html`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "fix: refresh virtual tree solar lab embed"
```

---

### Task 2: Port validated tree calculation and persistence to energy platform

**Files:**
- Modify: `C:/Users/user/projects/nowon-energy-platform/platform/solar-core.mjs`
- Modify: `C:/Users/user/projects/nowon-energy-platform/platform/solar-lab.test.mjs`

**Interfaces:**
- Produces: `normalizeTrees`, `localOffset`, `rayIntersectsTree`, `calculateDetailedPair` with the same signatures as `nowon-mrv/solar/solar-core.mjs`.
- Produces: `trees` project persistence and tree-aware CSV rows.

- [ ] **Step 1: Add failing core behavior tests**

Extend `solar-lab.test.mjs` imports and add literal tests for:

```js
test('가상 나무 저장과 원기둥 음영 계산을 지원한다', async () => {
  const core = await import('./solar-core.mjs');
  const tree = { id: 'tree-1', center: { lat: 37.654, lon: 127.056 }, heightM: 12, crownDiameterM: 8 };
  const state = { mode: 'virtual', roof: [], exclusions: [], heightM: 0, formValues: {}, dirty: false, trees: [tree] };
  assert.deepEqual(core.deserializeProject(core.serializeProject(state)).trees, [tree]);
  assert.equal(core.rayIntersectsTree(
    { east: 0, north: 0, up: 5 },
    { east: 1, north: 0, up: 0.5 },
    { east: 5, north: 0, baseUp: 0, heightM: 12, crownDiameterM: 8 },
  ), true);
});

test('가상 나무 CSV는 발전량 전후 차이를 포함한다', async () => {
  const { buildCsv } = await import('./solar-core.mjs');
  const csv = buildCsv(
    { detailed: { annualKwh: 850 }, baselineDetailed: { annualKwh: 1000 } },
    { trees: [{ id: 'tree-1', center: { lat: 37.654, lon: 127.056 }, heightM: 12, crownDiameterM: 8 }] },
    {},
  );
  assert.match(csv, /가상 나무 수,1/);
  assert.match(csv, /나무로 인한 감소량\(kWh\),150/);
});
```

- [ ] **Step 2: Run RED**

Run from `platform/`: `node --test solar-lab.test.mjs`

Expected: FAIL because tree exports and CSV rows do not exist.

- [ ] **Step 3: Port the minimal verified core functions**

Copy the implementations and their direct call-site changes from `nowon-mrv/solar/solar-core.mjs`:

- add `trees` to `projectFields`
- normalize trees in serialization/deserialization
- validate normalized trees in `isValidProject`
- add `normalizeTrees`, `localOffset`, `rayIntersectsTree`
- add `calculateDetailedPair`
- append tree count, baseline generation, tree-aware generation, loss, and per-tree rows in `buildCsv`

Do not replace unrelated energy-platform calculation code.

- [ ] **Step 4: Run GREEN and syntax checks**

Run: `node --test solar-lab.test.mjs`

Run: `node --check solar-core.mjs`

Expected: all pass.

- [ ] **Step 5: Commit Task 2 in nowon-energy-platform**

```bash
git add platform/solar-core.mjs platform/solar-lab.test.mjs
git commit -m "feat: add virtual tree solar calculations"
```

---

### Task 3: Port native tree UI, rendering, and analysis integration

**Files:**
- Modify: `C:/Users/user/projects/nowon-energy-platform/platform/index.html`
- Modify: `C:/Users/user/projects/nowon-energy-platform/platform/solar-lab.mjs`
- Modify: `C:/Users/user/projects/nowon-energy-platform/platform/solar-lab.test.mjs`
- Create: `C:/Users/user/projects/nowon-energy-platform/platform/assets/tree.glb`
- Create: `C:/Users/user/projects/nowon-energy-platform/platform/assets/NOTICE.md`

**Interfaces:**
- Consumes: Task 2 core exports.
- Produces: native platform controls `#tree-height`, `#tree-crown`, `#place-tree`, `#update-tree`, `#tree-list`.
- Produces: `validateTreeInput`, `treeEntityDefinition`, `updateTreeDimensions`, `treeImpact` matching the nowon-mrv implementation.

- [ ] **Step 1: Add failing app tests**

Add the same real-behavior tests used in `nowon-mrv/solar/solar-core.test.mjs` for:

- valid/invalid tree input
- bundled model URI and enabled Cesium shadows
- selected tree dimension update without moving its center
- detailed shade sample where `baselineShaded === false` and tree-aware `shaded === true`
- non-negative `treeImpact`

- [ ] **Step 2: Run RED**

Run: `node --test solar-lab.test.mjs`

Expected: FAIL because application exports and tree-aware sample fields are absent.

- [ ] **Step 3: Add native platform controls and styling**

Insert a `가상 나무` fieldset after the existing coordinate/exclusion details:

```html
<fieldset><legend>가상 나무</legend>
  <div class="solarGrid"><label>높이 (m)<input id="tree-height" type="number" min="1" max="50" step="0.1" value="12"></label><label>수관 지름 (m)<input id="tree-crown" type="number" min="1" max="30" step="0.1" value="8"></label></div>
  <p id="tree-input-error" role="alert" hidden></p>
  <button id="place-tree" type="button">지도에 나무 배치</button>
  <button id="update-tree" class="secondary" type="button" hidden>선택 나무 수정</button>
  <ul id="tree-list" aria-label="배치된 가상 나무"></ul>
</fieldset>
```

Add two-column `.tree-actions`, selected-row highlight, and cache version `solar-lab.mjs?v=20260824-virtual-tree-1`.

- [ ] **Step 4: Port state and interaction into the native map flow**

Port only the corresponding validated logic from `nowon-mrv/solar/app.mjs` and adapt `#status` to `#solarStatus`:

- `state.trees`, `selectedTreeId`, tree DOM selectors
- validation, entity definition, dimension update, impact helper
- tree rendering after both KML and fallback roof rendering
- map-click `drawing.kind === 'tree'` branch before polygon drawing
- list selection to move the existing VWorld camera without creating a stale building marker
- selected-row edit/delete behavior
- full-reset/restore selection cleanup
- save/restore tree state
- `buildShadeSamples` ENU tree intersection and `baselineShaded`
- `runAnalysis` use of `calculateDetailedPair`
- result cards and calculation-basis tree impact

- [ ] **Step 5: Copy the exact asset and verify equality**

Copy:

```powershell
Copy-Item -LiteralPath 'C:\Users\user\projects\nowon-mrv\solar\assets\tree.glb' -Destination 'platform\assets\tree.glb'
Copy-Item -LiteralPath 'C:\Users\user\projects\nowon-mrv\solar\assets\NOTICE.md' -Destination 'platform\assets\NOTICE.md'
```

Run:

```powershell
(Get-FileHash 'platform\assets\tree.glb').Hash -eq (Get-FileHash 'C:\Users\user\projects\nowon-mrv\solar\assets\tree.glb').Hash
```

Expected: `True`.

- [ ] **Step 6: Run GREEN and full local checks**

Run from `platform/`:

```powershell
node --test solar-lab.test.mjs
node --check solar-lab.mjs
node --check solar-core.mjs
git diff --check
```

Expected: all exit 0.

- [ ] **Step 7: Browser verify the native platform**

Serve the energy-platform repository over HTTP and verify:

1. Open the Solar Lab tab.
2. Place a tree and confirm it appears without zoom/pan.
3. Confirm `나무 선택` is left of `나무 삭제`.
4. Select it, change 12/8 to 18/11, and confirm list/model update.
5. Save, reload, and confirm restoration.
6. Run detailed analysis and confirm tree-aware generation is not above baseline.

- [ ] **Step 8: Commit Task 3**

```bash
git add platform/index.html platform/solar-lab.mjs platform/solar-lab.test.mjs platform/assets/tree.glb platform/assets/NOTICE.md
git commit -m "feat: add virtual trees to energy platform"
```

---

### Task 4: Deploy and verify both Pages sites

**Files:**
- No source changes unless verification exposes a tested defect.

**Interfaces:**
- Consumes: Tasks 1–3 commits.
- Produces: two successful GitHub Pages deployments.

- [ ] **Step 1: Final tests in both repositories**

Run the nowon-mrv 57-test suite and energy-platform test suite plus syntax and diff checks.

- [ ] **Step 2: Push both master branches**

```bash
git -C C:/Users/user/projects/nowon-mrv push origin master
git -C C:/Users/user/projects/nowon-energy-platform push origin master
```

- [ ] **Step 3: Verify Pages workflows**

Use `gh run list` in each repository and require the pushed HEAD workflow conclusion to be `success`.

- [ ] **Step 4: Verify public URLs**

- `https://parksh1236.github.io/nowon-mrv/`: iframe shows virtual-tree controls.
- `https://parksh1236.github.io/nowon-energy-platform/platform/`: native Solar Lab shows virtual-tree controls and VWorld map loads.

