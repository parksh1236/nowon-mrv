// 지번은 공식 주소 응답으로 확인한다. 문자열에서 법정동 코드를 추측하지 않는다.
export function normalizeParcel(input) {
  if (!input) return null;
  const sigunguCd=String(input.sigunguCd || ''), bjdongCd=String(input.bjdongCd || '');
  const bun=String(input.bun ?? ''), ji=String(input.ji ?? '0');
  const platGbCd=String(input.platGbCd ?? '0');
  if (!/^\d{5}$/.test(sigunguCd) || !/^\d{5}$/.test(bjdongCd) || !/^\d{1,4}$/.test(bun) || Number(bun)===0 || !/^\d{1,4}$/.test(ji) || !['0','1'].includes(platGbCd)) return null;
  return {sigunguCd,bjdongCd,bun:bun.padStart(4,'0'),ji:ji.padStart(4,'0'),platGbCd};
}

export function parcelFromAddress(address) {
  if (!address || !/^\d{10}$/.test(String(address.b_code || ''))) return null;
  return normalizeParcel({sigunguCd:address.b_code.slice(0,5),bjdongCd:address.b_code.slice(5),bun:address.main_address_no,ji:address.sub_address_no || '0',platGbCd:address.mountain_yn==='Y'?'1':'0'});
}

const cleanAddress=s=>String(s || '').normalize('NFKC').replace(/번지/g,'').replace(/\s+/g,'').trim();
const key=p=>`${p.sigunguCd}${p.bjdongCd}${p.platGbCd}${p.bun}${p.ji}`;
function nearby(building,result) {
  const lat=Number(building.lat), lng=Number(building.lng), x=Number(result.x), y=Number(result.y);
  if (![lat,lng,x,y].every(Number.isFinite)) return false;
  const dx=(x-lng)*111320*Math.cos(lat*Math.PI/180),dy=(y-lat)*111320;
  return Math.hypot(dx,dy)<=150;
}

export async function resolveParcel(building, lookup) {
  const direct=normalizeParcel(building) || parcelFromAddress(building?.address);
  if (direct) return direct;
  if (!building?.addr) throw new Error('주소·지번 정보가 없어 조회할 수 없습니다. 주소 검색을 이용해 주세요.');
  let results;
  try { results=await lookup(building.addr); }
  catch(e){ throw new Error('주소 검색 서비스 연결 실패. 잠시 후 다시 선택해 주세요.'); }
  const candidates=new Map();
  for (const result of Array.isArray(results)?results:[]) {
    const parcel=parcelFromAddress(result.address);
    if (!parcel) continue;
    if (building.sigunguCd && String(building.sigunguCd)!==parcel.sigunguCd) continue;
    const exact=cleanAddress(building.addr)===cleanAddress(result.address.address_name);
    if (!exact && !nearby(building,result)) continue;
    candidates.set(key(parcel),parcel);
  }
  if (candidates.size===1) return candidates.values().next().value;
  if (candidates.size>1) throw new Error('여러 지번이 검색되어 건물을 특정할 수 없습니다. 정확한 주소를 검색해 주세요.');
  throw new Error('선택 건물과 일치하는 지번을 확인하지 못했습니다. 정확한 주소를 검색해 주세요.');
}
