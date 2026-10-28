// VWorld 도로명주소 건물 → 공공데이터포털 지번별 전기사용량 연결.
// 한 필지의 여러 동은 동일 API 조회 경계를 공유하므로 필지당 한 점만 표시한다.
export const LIVE_REGIONS = Object.freeze({
  '노원구':['11350'], '강남구':['11680'], '강북구':['11305'],
  '강동구':['11740'], '중랑구':['11260'], '구로구':['11530'],
  '금천구':['11545'], '강서구':['11500'],
  '관악구':['11620'], '광진구':['11215'], '도봉구':['11320'],
  '동대문구':['11230'], '동작구':['11590'],
  '마포구':['11440'], '서대문구':['11410'], '서초구':['11650'],
  '성동구':['11200'], '성북구':['11290'],
  '송파구':['11710'], '양천구':['11470'], '영등포구':['11560'],
  '용산구':['11170'], '은평구':['11380'],
  '종로구':['11110'], '중구':['11140'],
  '남양주시':['41360'], '용인시':['41461','41463','41465']
});

export function buildingsFromFeatures(features, codes, known = new Set()) {
  const result = { buildings:[], duplicates:0, rejected:0, outside:0 };
  for (const feature of features) {
    const p=feature.properties || {}, id=String(p.bd_mgt_sn || '');
    if (!/^\d{25}$/.test(id) || !['1','2'].includes(id[10])) { result.rejected++; continue; }
    if (!codes.includes(id.slice(0,5))) { result.outside++; continue; }
    const parcel=id.slice(0,19);
    if (known.has(parcel)) { result.duplicates++; continue; }
    const g=feature.geometry;
    const ring=g?.type==='MultiPolygon' ? g.coordinates?.[0]?.[0] : g?.type==='Polygon' ? g.coordinates?.[0] : null;
    if (!Array.isArray(ring) || ring.length<3 || ring.some(c=>!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || c[0]<124 || c[0]>132 || c[1]<33 || c[1]>39)) { result.rejected++; continue; }
    const lng=ring.reduce((v,c)=>v+c[0],0)/ring.length, lat=ring.reduce((v,c)=>v+c[1],0)/ring.length;
    known.add(parcel);
    result.buildings.push({
      parcel, lat, lng, sigunguCd:id.slice(0,5), bjdongCd:id.slice(5,10),
      platGbCd:id[10]==='2'?'1':'0', bun:id.slice(11,15), ji:id.slice(15,19),
      addr:[p.sido,p.sigungu,p.rd_nm,p.buld_no,p.buld_nm].filter(Boolean).join(' '),
      type:'도로명주소 건물 (필지별 조회)', etc:'', elec:null, gas:null,
      energyStatus:'pending', source:'live', gasStatus:'unqueried'
    });
  }
  return result;
}

export function buildingPageUrl({bounds,codes,page=1,key,domain='',callback}) {
  if (!key) throw new Error('건물 위치 API 키 설정을 확인해 주세요.');
  if (!Array.isArray(bounds) || bounds.length!==4 || !bounds.every(Number.isFinite)) throw new Error('지도 범위를 확인해 주세요.');
  const [x1,y1,x2,y2]=bounds;
  const area=(x2-x1)*111.32*Math.cos((y1+y2)/2*Math.PI/180)*(y2-y1)*111.32;
  if (area<=0 || area>9.5 || x1<124 || x2>132 || y1<33 || y2>39) throw new Error('지도를 더 확대해 주세요. 건물 위치 API는 10km² 미만 범위에서 조회합니다.');
  if (!Array.isArray(codes) || !codes.length || codes.some(c=>!/^\d{5}$/.test(c)) || !Number.isInteger(page) || page<1) throw new Error('지역·페이지 설정을 확인해 주세요.');
  const u=new URL('https://api.vworld.kr/req/data');
  const params={service:'data',request:'GetFeature',version:'2.0',data:'LT_C_SPBD',geomFilter:`BOX(${bounds.join(',')})`,geometry:'true',attribute:'true',crs:'EPSG:4326',format:'json',size:'50',page:String(page),key,domain};
  // 용인시 3개 구는 동일 접두부 4146으로 필터링하고, 응답에서 정확한 구 코드를 재검증한다.
  params.attrFilter=`bd_mgt_sn:like:${codes.length===3 && codes.every(c=>c.startsWith('4146'))?'4146':codes[0]}`;
  if (callback) params.callback=callback;
  Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
  return u.href;
}

export function parseBuildingPage(data) {
  const r=data?.response;
  if (r?.status==='NOT_FOUND') return {features:[],total:0,hasNext:false};
  if (r?.status!=='OK') throw new Error('건물 위치 API 조회 실패. 키·허용 도메인·호출 한도를 확인해 주세요.');
  const features=r.result?.featureCollection?.features;
  const total=Number(r.record?.total), page=Number(r.page?.current), pages=Number(r.page?.total);
  if (!Array.isArray(features) || !Number.isInteger(total) || total<0 || !Number.isInteger(page) || page<1 || !Number.isInteger(pages) || pages<1) throw new Error('건물 위치 API 응답 형식을 확인해 주세요.');
  return {features,total,hasNext:page<pages};
}

export async function hydrateElectricity(buildings, fetchUsage, {concurrency=3,isCurrent=()=>true,onProgress=()=>{}}={}) {
  let cursor=0, stopped=false;
  async function worker() {
    while (!stopped && isCurrent() && cursor<buildings.length) {
      const b=buildings[cursor++];
      let r;
      try { r=await fetchUsage(b); }
      catch(e) { r={found:false,error:'전기 API 연결 오류'}; }
      if (!isCurrent()) return;
      if (r.found && r.useQty!=null && String(r.useQty).trim()!=='' && Number.isFinite(Number(r.useQty)) && Number(r.useQty)>=0) {
        b.elec=Number(r.useQty); b.energyStatus='available';
      } else if (r.error || r.found) {
        b.energyStatus='error'; b.energyError=r.error || '전기 사용량 형식 오류';
        stopped=true; // 인증·호출한도·통신 실패를 수십 번 반복하지 않음
      } else { b.energyStatus='no-data'; }
      onProgress();
    }
  }
  await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),buildings.length)},worker));
}

export function coverageText({total,loaded,buildings,month,duplicates=0,rejected=0,outside=0}) {
  const count=s=>buildings.filter(b=>b.energyStatus===s).length;
  return `${month.slice(0,4)}.${month.slice(4)} · 현재 화면 API 건물 ${total.toLocaleString()}개 중 ${loaded.toLocaleString()}개 불러옴. `+
    `필지 ${buildings.length.toLocaleString()}개: 전기자료 있음 ${count('available')} · 미제공 ${count('no-data')} · 실패 ${count('error')} · 미조회 ${count('pending')}. `+
    `동일 필지 중복 ${duplicates} · 식별/좌표 오류 ${rejected} · 다른 지역 ${outside}. `+
    `지역 전체 건물의 전수자료가 아닙니다. 미제공은 0kWh가 아니며 회색 점은 미제공·미조회·오류를 포함합니다. 같은 필지의 여러 동은 1개 지점으로 표시합니다.`;
}
