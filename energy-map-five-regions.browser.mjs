// Isolated read-only smoke test. Each selection checks early real responses,
// then moves on to avoid collecting 250 parcels merely for a wiring change.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from './leading-city-mrv/node_modules/playwright/index.mjs';
const browser=await chromium.launch({channel:'chrome',headless:true,timeout:20000});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  if (!process.env.ENERGY_MAP_DEPLOYED) await page.route('https://parksh1236.github.io/nowon-mrv/energy-map.mjs',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./energy-map.mjs',import.meta.url),'utf8')}));
  await page.goto('https://parksh1236.github.io/nowon-mrv/');
  await page.locator('[data-tab="tMap"]').click();
  await page.locator('#mapProvinceSelect option[value="서울"]').waitFor({state:'attached'});
  await page.selectOption('#mapProvinceSelect','서울');
  const names=process.env.ENERGY_QA_REGIONS?.split(',') || ['강동구','중랑구','구로구','금천구','강서구'];
  for (const name of names) {
    await page.selectOption('#mapRegionSelect',name);
    await page.waitForFunction(()=>{
      const text=document.querySelector('#mapEnergyCoverage').textContent;
      return /전기자료 있음 [1-9]|미제공 [1-9]|실패 [1-9]/.test(text);
    },null,{timeout:45000});
    const coverage=await page.locator('#mapEnergyCoverage').innerText();
    assert.match(coverage,/실패 0/);
    assert.ok(await page.locator('#mapLiveControls').isVisible());
    const dots=await page.locator('.bldg-dot').count();
    assert.ok(dots>0);
    console.log(JSON.stringify({name,dots,coverage}));
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: '+names.length+' regions show real building positions and energy responses');
} finally {await browser.close();}
