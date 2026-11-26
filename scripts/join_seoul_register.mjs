import fs from 'node:fs';
const tiles='solar/data/seoul-buildings-20260715';
const byParcel=new Map();
for(const tile of JSON.parse(fs.readFileSync(tiles+'/index.json'))){
  for(const b of JSON.parse(fs.readFileSync(tiles+'/'+tile+'.json'))){
    if(!['11350','11740','11305'].includes(b[12]))continue;
    if(!byParcel.has(b[1]))byParcel.set(b[1],new Map());
    byParcel.get(b[1]).set(b[0],b.slice(2,12));
  }
}
for(const code of ['11350','11740','11305']){
  const file='data/energy/'+code+'.json',rows=JSON.parse(fs.readFileSync(file));
  let matched=0;
  for(const r of rows){
    const k=code+r.bjdongCd+(Number(r.platGbCd)+1)+r.bun+r.ji;
    const buildings=byParcel.get(k);
    if(buildings){r.register=[...buildings.values()];matched++;}
  }
  if(!matched)throw Error('No matches: '+code);
  fs.writeFileSync(file,JSON.stringify(rows));console.log(code,matched,rows.length);
}
