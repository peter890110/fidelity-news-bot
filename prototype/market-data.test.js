import test from 'node:test';
import assert from 'node:assert/strict';
import {previousTaiwanSession,previousUSSession,validateTaiwanDaily,fetchUSMarket,taiwanSummary,usSummary,parseInstitutional} from './market-data.js';
import {latestMarkets,marketText} from './report-text.js';

test('previous Taiwan session excludes today and handles a weekend',()=>{
 const rows=['2026-11-20','2026-11-23','2026-11-24','2026-11-25'].map(sessionDate=>({sessionDate}));
 assert.equal(previousTaiwanSession(rows,new Date('2026-11-25T01:00:00Z')).sessionDate,'2026-11-24');
 assert.equal(previousTaiwanSession(rows,new Date('2026-11-23T01:00:00Z')).sessionDate,'2026-11-20');
});
test('New York session must have finished before a US daily bar is usable',()=>{
 const series=['2026-11-23','2026-11-24'].map(sessionDate=>({sessionDate,close:100}));
 assert.equal(previousUSSession(series,new Date('2026-11-24T20:00:00Z')).sessionDate,'2026-11-23');
 assert.equal(previousUSSession(series,new Date('2026-11-25T01:00:00Z')).sessionDate,'2026-11-24');
});
test('Taiwan monthly and daily reports must agree on date, close and signed change',()=>{
 const session={sessionDate:'2026-11-24',close:100,change:-2,changePct:-1.96};
 const daily={stat:'OK',date:'20261124',tables:[{title:'價格指數(臺灣證券交易所)',data:[['發行量加權股價指數','100','<p>-</p>','2','-1.96']]}]};
 assert.ok(validateTaiwanDaily(session,daily));
 assert.throws(()=>validateTaiwanDaily({...session,close:101},daily),/不一致/);
 assert.throws(()=>validateTaiwanDaily({...session,change:2},daily),/不一致/);
});
test('blank institutional numbers cannot be published as zero',()=>{
 const data={stat:'OK',date:'20261124',data:[['外資及陸資','100','80','20'],['投信','20','10','10'],['自營商','30','20','10'],['合計','150','110','40']]};
 assert.equal(parseInstitutional(data,'2026-11-24').netFlowBillions,40/1e8);
 data.data[0][1]='';assert.equal(parseInstitutional(data,'2026-11-24'),null);
});
test('market copy uses current check, suppresses unverified old numbers and no canned analysis',()=>{
 const old={checkedAt:'2026-11-24T01:00:00Z',sessionDate:'2026-11-23'},fresh={checkedAt:'2026-11-25T01:00:00Z',sessionDate:'2026-11-24'};
 assert.equal(latestMarkets({taiwan:old,us:old},{taiwan:fresh,us:fresh}).taiwan.sessionDate,'2026-11-24');
 assert.doesNotMatch(marketText('taiwan',{...old,label:'台股盤後',status:'unverified',close:98765}),/98765/);
 const tw=taiwanSummary({sessionDate:'2026-11-24',close:100,change:1,changePct:1,turnoverBillions:10},[]);
 assert.doesNotMatch(tw,/後續|應配合|留意|確認當日/);assert.equal((tw.match(/。/g)||[]).length,1);
 const us=usSummary('2026-11-24',[{name:'測試指數',close:100,changePct:1}]);assert.doesNotMatch(us,/財報|後續|風險偏好/);
});
test('US recalculation cannot reuse seeded closes or stale summaries',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({chart:{result:[{timestamp:[Date.parse('2026-11-23T14:30:00Z')/1000,Date.parse('2026-11-24T14:30:00Z')/1000],indicators:{quote:[{close:[100,102]}]}}]}}));
 try{
  const r=await fetchUSMarket({sessionDate:'2026-11-24',summary:'過期評論',researchedClose:{sessionDate:'2026-11-24',indices:[{close:99999}]}},new Date('2026-11-25T01:00:00Z'));
  assert.ok(r.indices.every(x=>x.close===102));assert.doesNotMatch(r.summary,/過期評論/);assert.equal(r.comparisonDate,'2026-11-23');
 }finally{globalThis.fetch=original;}
});
