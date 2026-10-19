const number = value => Number(String(value).replaceAll(',',''));
const format = value => Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const direction = value => value>0?'上漲':value<0?'下跌':'持平';
export const dateIn = (now,zone) => new Intl.DateTimeFormat('sv-SE',{timeZone:zone}).format(now);
const shortDate = date => `${Number(date.slice(5,7))}月${Number(date.slice(8))}日`;
const compact = date => date.replaceAll('-','');
const headers = {'user-agent':'Mozilla/5.0 FinancialBriefPrototype/0.4'};
async function json(url) {
 const r=await fetch(url,{signal:AbortSignal.timeout(10000),headers});
 if(!r.ok)throw new Error(`市場資料回應 ${r.status}`);
 return r.json();
}
export function parseInstitutional(data,sessionDate) {
 if(data.stat!=='OK'||data.date!==compact(sessionDate)||!Array.isArray(data.data))return null;
 const row=predicate=>data.data.filter(r=>predicate(String(r[0])));
 const amount=rows=>rows.reduce((sum,r)=>sum+number(r[3]),0);
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
 const url=`https://www.twse.com.tw/fund/BFI82U?response=json&dayDate=${compact(market.sessionDate)}&type=day`;
 const data=parseInstitutional(await json(url),market.sessionDate);
 return {...market,...(data||{}),flowCheckedAt:new Date().toISOString()};
}
// Actual exchange sessions account for holidays, unlike a weekday-only calculation.
export function parseTaiwanSessions(data) {
 if(data.stat!=='OK'||!Array.isArray(data.data))throw new Error('證交所交易日資料尚未公布');
 return data.data.flatMap(r=>{
  const parts=String(r[0]).match(/^(\d{2,3})\/(\d{2})\/(\d{2})$/);
  if(!parts)return [];
  const sessionDate=`${Number(parts[1])+1911}-${parts[2]}-${parts[3]}`;
  const close=number(r[4]),change=number(r[5]),turnoverBillions=number(r[2])/1e8;
  return [close,change,turnoverBillions].every(Number.isFinite)?[{sessionDate,close,change,turnoverBillions,changePct:change/(close-change)*100}]:[];
 });
}
export function previousTaiwanSession(sessions,now=new Date()) {
 return sessions.filter(x=>x.sessionDate<dateIn(now,'Asia/Taipei')).sort((a,b)=>b.sessionDate.localeCompare(a.sessionDate))[0];
}
function taiwanSummary(session,sectors) {
 const sorted=sectors.sort((a,b)=>b.changePct-a.changePct),strongest=sorted[0],weakest=sorted.at(-1);
 const breadth=strongest&&weakest?`${strongest.name}${direction(strongest.changePct)}${format(Math.abs(strongest.changePct))}%，${weakest.name}${direction(weakest.changePct)}${format(Math.abs(weakest.changePct))}%，類股表現存在差異。`:'';
 return `${shortDate(session.sessionDate)}加權指數收在${format(session.close)}點，${direction(session.change)}${format(Math.abs(session.change))}點，漲跌幅${session.changePct>=0?'+':''}${session.changePct.toFixed(2)}%，全日成交金額${format(session.turnoverBillions)}億元。${breadth}觀察這次收盤，除指數漲跌外，也應配合成交規模與法人買賣方向，判斷市場參與情形。類股指數的漲跌反映當日價格變化，個別公司的表現仍可能不同。後續可持續追蹤權值股、資金流向及國際市場變化，確認當日走勢能否延續。`;
}
export async function fetchTaiwanMarket(previous,now=new Date()) {
 const today=dateIn(now,'Asia/Taipei');
 let session;
 for(let offset=0;offset<3&&!session;offset++) {
  const month=new Date(`${today.slice(0,7)}-01T00:00:00Z`);month.setUTCMonth(month.getUTCMonth()-offset);
  const data=await json(`https://www.twse.com.tw/exchangeReport/FMTQIK?response=json&date=${compact(month.toISOString().slice(0,10))}`);
  if(data.stat==='OK')session=previousTaiwanSession(parseTaiwanSessions(data),now);
 }
 if(!session)throw new Error('無法核對台股前一交易日');
 const url=`https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${compact(session.sessionDate)}&type=ALL`;
 const daily=await json(url);
 if(daily.stat!=='OK'||daily.date!==compact(session.sessionDate))throw new Error('台股收盤日期不一致');
 const priceTable=daily.tables?.find(t=>/價格指數\(臺灣證券交易所\)/.test(t.title));
 const sectors=(priceTable?.data||[]).filter(r=>/類指數$/.test(r[0])&&Number.isFinite(number(r[4]))).map(r=>({name:r[0],changePct:number(r[4])}));
 const same=previous?.sessionDate===session.sessionDate;
 const market={label:'台股盤後',...session,flowPublished:same&&previous.flowPublished||false,netFlowBillions:same?previous.netFlowBillions:null,flow:same?previous.flow:[],flowDate:session.sessionDate,
  summary:previous?.sessionDate===session.sessionDate?previous.summary:taiwanSummary(session,sectors),url,sourceLabel:'臺灣證券交易所',sources:[{label:'證交所收盤統計',url},{label:'證交所三大法人統計',url:`https://www.twse.com.tw/fund/BFI82U?response=json&dayDate=${compact(session.sessionDate)}&type=day`}],
  verifiedFor:today,status:'verified',checkedAt:now.toISOString()};
 try {return await fetchInstitutional(market);}catch {return market;}
}
const instruments=[['道瓊工業指數','^DJI'],['納斯達克指數','^IXIC'],['S&P 500指數','^GSPC'],['費城半導體指數','^SOX']];
export function parseUSSeries(data) {
 const result=data.chart?.result?.[0],closes=result?.indicators?.quote?.[0]?.close;
 if(!Array.isArray(result?.timestamp)||!Array.isArray(closes))throw new Error('美股歷史資料不足');
 return result.timestamp.flatMap((stamp,i)=>Number.isFinite(closes[i])?[{sessionDate:dateIn(new Date(stamp*1000),'America/New_York'),close:closes[i]}]:[]).sort((a,b)=>a.sessionDate.localeCompare(b.sessionDate));
}
export function previousUSSession(series,now=new Date()) {
 const taipeiToday=dateIn(now,'Asia/Taipei'),nyToday=dateIn(now,'America/New_York');
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const minutes=Number(parts.find(p=>p.type==='hour').value)*60+Number(parts.find(p=>p.type==='minute').value);
 // Exclude intraday bars and allow the closing print to finish updating.
 return series.filter(x=>x.sessionDate<taipeiToday&&(x.sessionDate<nyToday||(x.sessionDate===nyToday&&minutes>=16*60+15))).at(-1);
}
async function fetchUSSeries(symbol) {
 let error;
 for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com']) {
  try {return parseUSSeries(await json(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`));}
  catch(e){error=e;}
 }
 throw error;
}
function usSummary(date,indices) {
 const [dow,nasdaq,sp,sox]=indices,positive=indices.filter(x=>x.changePct>0).length;
 const movement=positive===4?'四大指數同步收高':positive===0&&indices.every(x=>x.changePct<0)?'四大指數同步收低':'四大指數漲跌互見';
 const tech=nasdaq.changePct<dow.changePct?'科技股指數表現弱於道瓊，科技類股承受的價格壓力相對較大。':'科技股指數表現優於道瓊，科技類股的相對表現較強。';
 return `美東${shortDate(date)}${movement}。道瓊收在${format(dow.close)}點，納斯達克收在${format(nasdaq.close)}點，標普500收在${format(sp.close)}點，費城半導體收在${format(sox.close)}點。${tech}觀察這次收盤，應同時比較大型股、科技股與半導體的強弱，並配合成交及後續財報確認走勢。單日指數變動仍不足以判定中期趨勢，後續可留意類股表現是否擴散，以及主要經濟數據公布後的市場反應。`;
}
export async function fetchUSMarket(previous,now=new Date()) {
 const histories=await Promise.all(instruments.map(([,symbol])=>fetchUSSeries(symbol)));
 const latest=histories.map(h=>previousUSSession(h,now));
 if(latest.some(x=>!x)||!latest.every(x=>x.sessionDate===latest[0].sessionDate))throw new Error('美股四大指數交易日期不一致');
 const sessionDate=latest[0].sessionDate;
 let indices=histories.map((h,i)=>{
  const current=latest[i],prev=h.filter(x=>x.sessionDate<sessionDate).at(-1);
  if(!prev||prev.close<=0)throw new Error('美股前次收盤價不足');
  return {name:instruments[i][0],symbol:instruments[i][1],close:current.close,changePct:(current.close/prev.close-1)*100};
 });
 // Retain the cross-checked published close for that exact session; future sessions use fetched history.
 const researchedClose=previous?.researchedClose;
 if(researchedClose?.sessionDate===sessionDate)indices=researchedClose.indices;
 return {label:'美股盤後',sessionDate,indices,researchedClose,summary:previous?.sessionDate===sessionDate?previous.summary:usSummary(sessionDate,indices),
  verifiedFor:dateIn(now,'Asia/Taipei'),status:'verified',checkedAt:now.toISOString(),
  sources:[...(researchedClose?.sessionDate===sessionDate?researchedClose.sources:[]),...instruments.map(([label,symbol])=>({label,url:`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/history/`}))]};
}
export async function refreshMarkets(markets,now=new Date()) {
 const keys=['taiwan','us'];
 const results=await Promise.allSettled([fetchTaiwanMarket(markets.taiwan,now),fetchUSMarket(markets.us,now)]);
 return Object.fromEntries(keys.map((key,i)=>[key,results[i].status==='fulfilled'?results[i].value:
  {...markets[key],status:'unverified',verificationError:'暫時無法核對前一交易日，以下為上次留存資料。',checkedAt:now.toISOString()}]));
}
