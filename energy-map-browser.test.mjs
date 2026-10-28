// Uses the existing optional local Playwright install, never the user's browser session.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from './leading-city-mrv/node_modules/playwright/index.mjs';

console.log('Starting isolated browser');
const browser=await chromium.launch({channel:'chrome',headless:true,timeout:20000});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Preview only the changed source at the already allowed production origin.
  const origin='https://parksh1236.github.io/nowon-mrv/';
  await page.route(origin,route=>route.fulfill({contentType:'text/html',body:readFileSync(new URL('./index.html',import.meta.url),'utf8')}));
  await page.route(origin+'energy-map.mjs',route=>route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./energy-map.mjs',import.meta.url),'utf8')}));
  await page.goto(origin);
  console.log('Preview loaded');
  await page.locator('[data-tab="tMap"]').click();
  await page.locator('#mapProvinceSelect option[value="서울"]').waitFor({state:'attached'});
  for (const [province,name] of [['서울','강북구'],['경기','남양주시'],['경기','용인시']]) {
    console.log('Selecting '+name);
    await page.selectOption('#mapProvinceSelect',province);
    await page.selectOption('#mapRegionSelect',name);
    const heartbeat=setInterval(async()=>{
      try { console.log('Progress: '+await page.locator('#mapStatus').innerText()); }
      catch(e){ console.log('Progress unavailable'); }
    },10000);
    try { await page.waitForFunction(()=>{
      const text=document.querySelector('#mapStatus').textContent;
      return text.includes('조회 완료') || text.includes('실패') || text.includes('확인 필요') || text.includes('시간 초과') || text.includes('더 확대') || text.includes('호출 제한');
    },null,{timeout:120000}); } finally { clearInterval(heartbeat); }
    const status=await page.locator('#mapStatus').innerText();
    const coverage=await page.locator('#mapEnergyCoverage').innerText();
    const dots=await page.locator('.bldg-dot').count();
    console.log(JSON.stringify({name,status,coverage,dots}));
    assert.ok(status.includes('조회 완료'),name+': '+status);
    assert.ok(coverage.includes('지역 전체'),name+': coverage disclosure missing');
    assert.ok(dots>0,name+': no building markers');
    assert.ok(await page.locator('#mapLiveControls').isVisible());
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: three-region map selection, official building positions, live electricity responses and explicit coverage');
} finally { await browser.close(); }
