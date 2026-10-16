const number = value => Number(String(value).replaceAll(',',''));
export function parseInstitutional(json,sessionDate) {
 if(json.stat!=='OK'||json.date!==sessionDate.replaceAll('-','')||!Array.isArray(json.data))return null;
 const row = predicate => json.data.filter(r=>predicate(String(r[0])));
 const amount = rows => rows.reduce((sum,r)=>sum+number(r[3]),0);
 const foreignRows=row(n=>n.startsWith('外資及陸資'));
 const trustRows=row(n=>n==='投信');
 let dealerRows=row(n=>n==='自營商');
 if(!dealerRows.length)dealerRows=row(n=>n.startsWith('自營商('));
 const totalRows=row(n=>n==='合計'||n==='合併');
 if(!foreignRows.length||!trustRows.length||!dealerRows.length||!totalRows.length)return null;
 const foreign=amount(foreignRows),dealer=amount(dealerRows),trust=amount(trustRows),total=amount(totalRows);
 if(![foreign,dealer,trust,total].every(Number.isFinite)||Math.abs(foreign+dealer+trust-total)>1)return null;
 return {flowPublished:true,flowDate:sessionDate,netFlowBillions:total/1e8,flow:[{name:'外資',value:foreign/1e8},{name:'自營商',value:dealer/1e8},{name:'投信',value:trust/1e8}]};
}
export async function fetchInstitutional(market) {
 const url=`https://www.twse.com.tw/fund/BFI82U?response=json&dayDate=${market.sessionDate.replaceAll('-','')}&type=day`;
 const r=await fetch(url,{signal:AbortSignal.timeout(8000),headers:{'user-agent':'Mozilla/5.0 FinancialBriefPrototype/0.3'}});
 if(!r.ok)throw new Error('證交所統計暫時無法取得');
 const data=parseInstitutional(await r.json(),market.sessionDate);
 return {...market,...(data||{}),flowCheckedAt:new Date().toISOString()};
}
