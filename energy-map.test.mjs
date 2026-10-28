import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Dynamic import lets the missing implementation fail inside an executed test.
const load = () => import('./energy-map.mjs');
const feature = (id='1130510300101920058009155', lng=127.02) => ({
  properties:{bd_mgt_sn:id, sido:'서울특별시', sigungu:'강북구', rd_nm:'도봉로87길', buld_no:'26-11'},
  geometry:{type:'MultiPolygon',coordinates:[[[[lng,37.63],[lng+.001,37.63],[lng+.001,37.631],[lng,37.63]]]]}
});
test('three requested regions include all three Yongin districts', async () => {
  const { LIVE_REGIONS } = await load();
  assert.deepEqual(LIVE_REGIONS['남양주시'], ['41360']);
  assert.deepEqual(LIVE_REGIONS['강북구'], ['11305']);
  assert.deepEqual(LIVE_REGIONS['용인시'], ['41461','41463','41465']);
});
for (const [name,code] of [['강동구','11740'],['중랑구','11260'],['구로구','11530'],['금천구','11545'],['강서구','11500']]) {
  test(`${name} connects its official district code to building and energy lookup`,async()=>{
    const {LIVE_REGIONS,buildingPageUrl,buildingsFromFeatures}=await load();
    const centers=JSON.parse(readFileSync(new URL('./data/region_centers.json',import.meta.url),'utf8'));
    assert.deepEqual(LIVE_REGIONS[name],[code]);
    assert.equal(centers[name].sigunguCd,code);
    const u=new URL(buildingPageUrl({bounds:[126.88,37.49,126.89,37.50],codes:LIVE_REGIONS[name],page:1,key:'test-only'}));
    assert.equal(u.searchParams.get('attrFilter'),`bd_mgt_sn:like:${code}`);
    const converted=buildingsFromFeatures([feature(code+'10100100010000000001')],LIVE_REGIONS[name]);
    assert.equal(converted.buildings[0].sigunguCd,code);
  });
}
test('official building ID maps to exact API parcel without inventing usage', async () => {
  const { buildingsFromFeatures } = await load();
  const r=buildingsFromFeatures([feature()],['11305']);
  assert.equal(r.buildings[0].bjdongCd,'10300');
  assert.equal(r.buildings[0].bun,'0192');
  assert.equal(r.buildings[0].ji,'0058');
  assert.equal(r.buildings[0].platGbCd,'0');
  assert.equal(r.buildings[0].elec,null);
  assert.equal(r.buildings[0].energyStatus,'pending');
});
test('parcel duplicates, invalid identifiers, and other cities are counted explicitly',async()=>{
  const { buildingsFromFeatures }=await load();
  const r=buildingsFromFeatures([feature(),feature(),feature('bad'),feature('1168010100100010000000001')],['11305']);
  assert.equal(r.buildings.length,1);
  assert.equal(r.duplicates,1);
  assert.equal(r.rejected,1);
  assert.equal(r.outside,1);
});
test('mountain parcels retain their land category', async()=>{
  const { buildingsFromFeatures }=await load();
  assert.equal(buildingsFromFeatures([feature('1130510300201920058009155')],['11305']).buildings[0].platGbCd,'1');
});
test('invalid geometry is counted instead of mapped to fake coordinates',async()=>{
  const { buildingsFromFeatures }=await load();
  const f=feature(); f.geometry=null;
  assert.equal(buildingsFromFeatures([f],['11305']).rejected,1);
});
test('bbox request uses official layer, selected districts, month-independent pagination',async()=>{
  const { buildingPageUrl }=await load();
  const u=new URL(buildingPageUrl({bounds:[127.02,37.63,127.03,37.64],codes:['41461','41463','41465'],page:2,key:'fake',domain:'https://example.test',callback:'callback1'}));
  assert.equal(u.searchParams.get('data'),'LT_C_SPBD');
  assert.equal(u.searchParams.get('page'),'2');
  assert.equal(u.searchParams.get('geomFilter'),'BOX(127.02,37.63,127.03,37.64)');
  assert.equal(u.searchParams.get('callback'),'callback1');
});
test('over-wide view is rejected before burning an API request',async()=>{
  const { buildingPageUrl }=await load();
  assert.throws(()=>buildingPageUrl({bounds:[126,36,128,38],codes:['11305'],page:1,key:'fake'}),/확대/);
});
test('API response counts and next-page state are retained',async()=>{
  const { parseBuildingPage }=await load();
  const r=parseBuildingPage({response:{status:'OK',record:{total:'121'},page:{total:'3',current:'1'},result:{featureCollection:{features:[feature()]}}}});
  assert.equal(r.total,121); assert.equal(r.hasNext,true);
});
test('service error and empty area are different outcomes',async()=>{
  const { parseBuildingPage }=await load();
  assert.throws(()=>parseBuildingPage({response:{status:'ERROR',error:{code:'INVALID_KEY'}}}),/건물 위치/);
  assert.equal(parseBuildingPage({response:{status:'NOT_FOUND'}}).total,0);
});
test('electricity batch preserves zero, missing data, failures, and limits concurrency',async()=>{
  const { hydrateElectricity }=await load();
  const rows=[0,1,2].map(i=>({bun:String(i),elec:null,energyStatus:'pending'}));
  let active=0,max=0;
  await hydrateElectricity(rows,async b=>{
    active++; max=Math.max(max,active);
    await new Promise(r=>setTimeout(r,2));active--;
    return b.bun==='0'?{found:true,useQty:0}:b.bun==='1'?{found:false}:{found:false,error:'API 오류'};
  },{concurrency:2});
  assert.equal(max,2);
  assert.deepEqual(rows.map(b=>b.energyStatus),['available','no-data','error']);
  assert.equal(rows[0].elec,0); assert.equal(rows[1].elec,null);
});
test('stale selection does not start new API calls',async()=>{
  const { hydrateElectricity }=await load();
  let calls=0;
  await hydrateElectricity([{energyStatus:'pending'}],async()=>{calls++;},{isCurrent:()=>false});
  assert.equal(calls,0);
});
test('page and API coverage are not conflated with complete district coverage',async()=>{
  const { coverageText }=await load();
  const text=coverageText({total:200,loaded:50,duplicates:2,rejected:1,outside:3,buildings:[{energyStatus:'available'},{energyStatus:'no-data'},{energyStatus:'error'},{energyStatus:'pending'}],month:'202604'});
  for(const expected of ['200','50','미제공 1','실패 1','미조회 1','지역 전체','2026.04']) assert.ok(text.includes(expected),expected);
});
test('main page wires visible-area loading and does not claim full building coverage',()=>{
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  assert.ok(html.includes('id="mapLoadBuildings"'));
  assert.ok(html.includes('id="mapEnergyCoverage"'));
  assert.ok(html.includes("import('./energy-map.mjs')"));
});
