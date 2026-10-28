import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const load=()=>import('./usage-details.mjs');
const parcel={sigunguCd:'11680',bjdongCd:'10100',bun:'0635',ji:'0000',platGbCd:'0'};
const geo=(main='635',sub='',x='127.03',mountain='N')=>({x,y:'37.5',address:{b_code:'1168010100',main_address_no:main,sub_address_no:sub,mountain_yn:mountain,address_name:`서울특별시 강남구 역삼동 ${main}${sub?'-'+sub:''}`}});

test('existing parcel skips address API and zero sub-number is retained',async()=>{
  const {resolveParcel}=await load();let calls=0;
  assert.deepEqual(await resolveParcel(parcel,async()=>{calls++;}),parcel);
  assert.equal(calls,0);
});
test('Gangnam legacy point resolves exact address to normalized parcel',async()=>{
  const {resolveParcel}=await load();
  const r=await resolveParcel({addr:'서울특별시 강남구 역삼동 635번지',lat:37.5,lng:127.03},async()=>[geo()]);
  assert.deepEqual(r,parcel);
});
test('geocoded address preserves mountain category',async()=>{
  const {resolveParcel}=await load();
  assert.equal((await resolveParcel({address:geo('12','3','127.03','Y').address},async()=>[])).platGbCd,'1');
});
test('ambiguous nearby parcels are rejected rather than taking first result',async()=>{
  const {resolveParcel}=await load();
  await assert.rejects(resolveParcel({addr:'역삼동',lat:37.5,lng:127.03},async()=>[geo(),geo('636')]),/여러|특정/);
});
test('unrelated distant geocoder hit is rejected',async()=>{
  const {resolveParcel}=await load();
  await assert.rejects(resolveParcel({addr:'알 수 없는 주소',lat:37.5,lng:127.03},async()=>[geo('635','','128')]),/일치|지번/);
});
test('invalid or missing parcel does not query energy with fake 0000',async()=>{
  const {resolveParcel}=await load();
  await assert.rejects(resolveParcel({addr:'없는 주소'},async()=>[{address:{b_code:'bad'}}]),/지번/);
});
test('address service exception produces safe user message',async()=>{
  const {resolveParcel}=await load();
  await assert.rejects(resolveParcel({addr:'주소'},async()=>{throw new Error('secret-provider-url');}),e=>!e.message.includes('secret-provider-url'));
});
test('no input address is explicitly rejected',async()=>{
  const {resolveParcel}=await load();
  await assert.rejects(resolveParcel({},async()=>[]),/주소|지번/);
});

const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
function chartContext(){
  const nodes=Object.fromEntries(['usageChartBox','usageChart','usageTable','usageChartStatus'].map(id=>[id,{style:{},innerHTML:'',textContent:'',setAttribute(){}}]));
  const c=vm.createContext({document:{getElementById:id=>nodes[id]}});
  const start=html.indexOf('function renderUsageChart('),end=html.indexOf('// 공공데이터포털 API 공통 호출');
  vm.runInContext(html.slice(start,end),c);
  return {nodes,c};
}
test('all-missing chart stays visible with explanation and month rows',()=>{
  const {nodes,c}=chartContext();
  c.renderUsageChart([{ym:'202604',elec:null,gas:null,elecStatus:'no-data',gasStatus:'no-data'}]);
  assert.equal(nodes.usageChartBox.style.display,'block');
  assert.match(nodes.usageChartStatus.textContent,/미제공|자료가 없/);
  assert.match(nodes.usageTable.innerHTML,/미제공/);
});
test('429 appears as error, not missing data or hidden chart',()=>{
  const {nodes,c}=chartContext();
  c.renderUsageChart([{ym:'202604',elec:null,gas:null,elecStatus:'error',gasStatus:'not-requested',elecError:'API 호출 제한 (429)'}]);
  assert.equal(nodes.usageChartBox.style.display,'block');
  assert.match(nodes.usageChartStatus.textContent,/429/);
  assert.match(nodes.usageTable.innerHTML,/조회 실패/);
});
test('progressive chart differentiates pending, zero and missing',()=>{
  const {nodes,c}=chartContext();
  c.renderUsageChart([{ym:'202601',elec:0,gas:null,elecStatus:'available',gasStatus:'pending'}]);
  assert.match(nodes.usageChart.innerHTML,/<rect/);
  assert.match(nodes.usageTable.innerHTML,/조회 중/);
  assert.match(nodes.usageChartStatus.textContent,/조회 중/);
});
test('monthly API errors survive series conversion and reach progress callback',async()=>{
  const source=html.slice(html.indexOf('async function fetchMonthlySeries('),html.indexOf('// 월별 시계열을'));
  let progress=0;
  const c=vm.createContext({monthsFromJan2026:()=>['202601'],fetchBeUsage:async()=>({found:false,error:'API 호출 제한 (429)'})});
  vm.runInContext(source,c);
  const rows=await c.fetchMonthlySeries('11350','10500','0701','0001','0',{onProgress:()=>progress++});
  assert.equal(rows[0].elecStatus,'error');
  assert.match(rows[0].elecError,/429/);
  assert.ok(progress>0);
});
test('cancelled detail series does not enqueue more API calls',async()=>{
  const source=html.slice(html.indexOf('async function fetchMonthlySeries('),html.indexOf('// 월별 시계열을'));
  let calls=0;
  const c=vm.createContext({monthsFromJan2026:()=>['202601'],fetchBeUsage:async()=>{calls++;return {found:false};}});
  vm.runInContext(source,c);
  await c.fetchMonthlySeries('11350','10500','0701','0001','0',{isCurrent:()=>false});
  assert.equal(calls,0);
});
