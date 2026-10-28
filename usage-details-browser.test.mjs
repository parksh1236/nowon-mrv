import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from './leading-city-mrv/node_modules/playwright/index.mjs';

console.log('Starting isolated monthly-detail browser verification');
const browser=await chromium.launch({channel:'chrome',headless:true,timeout:20000});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const origin='https://parksh1236.github.io/nowon-mrv/';
  await page.route(origin,route=>route.fulfill({contentType:'text/html',body:readFileSync(new URL('./index.html',import.meta.url),'utf8')}));
  for (const file of ['usage-details.mjs','energy-map.mjs']) await page.route(origin+file,route=>route.fulfill({contentType:'text/javascript',body:readFileSync(new URL('./'+file,import.meta.url),'utf8')}));
  await page.goto(origin);
  await page.locator('[data-tab="tMap"]').click();
  await page.locator('#mapProvinceSelect option[value="서울"]').waitFor({state:'attached'});
  await page.selectOption('#mapProvinceSelect','서울');
  await page.selectOption('#mapRegionSelect','강남구');
  await page.waitForFunction(()=>document.querySelector('#mapStatus').textContent.includes('지도 축척'));
  const first=JSON.parse(readFileSync(new URL('./data/energy/11680.json',import.meta.url),'utf8'))[0];
  assert.equal(first.sigunguCd,undefined);
  await page.evaluate(({lat,lng})=>{kakaoMap.setCenter(new kakao.maps.LatLng(lat,lng));kakaoMap.setLevel(3);},first);
  await page.locator('.bldg-dot').first().click();
  await page.waitForFunction(()=>document.querySelector('#infoBuildingSub').textContent.includes('지번 확인 완료'),null,{timeout:20000});
  assert.ok(await page.locator('#usageChartBox').isVisible());
  await page.waitForFunction(()=>document.querySelector('#usageChart svg rect'),null,{timeout:45000});
  console.log(JSON.stringify({case:'real Gangnam legacy point',parcel:await page.locator('#infoBuildingSub').innerText(),chartVisible:await page.locator('#usageChartBox').isVisible(),bars:await page.locator('#usageChart rect').count(),building:await page.locator('#usageChartBuilding').innerText()}));

  // Following cases are isolated UI fixtures, not claims about provider data.
  let mode='empty';
  await page.route('https://apis.data.go.kr/1613000/BldEngyHubService/**',async route=>{
    await route.fulfill({status:mode==='error'?429:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({response:{header:{resultCode:'00'},body:{totalCount:0,items:{item:[]}}}})});
  });
  await page.locator('#mapAddrInput').fill('노원구청');
  await page.locator('#mapSearchBtn').click();
  await page.waitForFunction(()=>document.querySelector('#usageChartBuilding').textContent.includes('노원구청'));
  await page.waitForFunction(()=>document.querySelector('#usageChartStatus').textContent.includes('공개된 전기·가스 자료가 없습니다'),null,{timeout:60000});
  assert.ok(await page.locator('#usageChartBox').isVisible());
  assert.equal(await page.locator('#usageChart rect').count(),0);
  assert.match(await page.locator('#usageTable').innerText(),/자료 미제공/);
  console.log('PASS fixture: no data keeps chart area and monthly table visible');

  mode='error';
  await page.locator('#mapSearchBtn').click();
  await page.waitForFunction(()=>document.querySelector('#usageChartStatus').textContent.includes('429'),null,{timeout:30000});
  assert.ok(await page.locator('#usageChartBox').isVisible());
  assert.match(await page.locator('#usageTable').innerText(),/조회 실패/);
  assert.match(await page.locator('#usageTable').innerText(),/미조회/);
  console.log('PASS fixture: rate limit is visible and not mislabelled as no data');

  mode='empty';
  await page.evaluate(({lat,lng})=>{kakaoMap.setCenter(new kakao.maps.LatLng(lat,lng));kakaoMap.setLevel(3);},first);
  await page.locator('.bldg-dot').first().click();
  await page.locator('#mapSearchBtn').click();
  await page.waitForFunction(()=>document.querySelector('#usageChartBuilding').textContent.includes('노원구청'));
  await page.waitForFunction(()=>document.querySelector('#usageChartStatus').textContent.includes('공개된 전기·가스 자료가 없습니다'),null,{timeout:60000});
  assert.match(await page.locator('#usageChartBuilding').innerText(),/노원구청/);
  console.log('PASS fixture: fast building/address switch does not restore the previous graph');
  assert.deepEqual(errors,[]);
  console.log('PASS: actual missing-parcel resolution, progressive graph and 3 UI regression scenarios');
} finally {await browser.close();}
