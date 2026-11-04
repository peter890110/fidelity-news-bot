import {dateIn} from './market-data.js';
const num=v=>Number(String(v).replaceAll(',',''));
const date=v=>`${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}`;
const HEADERS={'user-agent':'Mozilla/5.0 FinancialBriefPrototype/0.7'};
async function get(url){const r=await fetch(url,{headers:HEADERS,signal:AbortSignal.timeout(13000)});if(!r.ok)throw Error(`來源回應 ${r.status}`);return r;}
const funds=[
 {id:'FTH13',name:'富達全球動能多元基金',shareClass:'A股累計美元',currency:'USD'},
 {id:'FTZW6',name:'富達全球優質債券基金',shareClass:'A股累計美元',currency:'USD',risk:'本基金有相當比重投資於非投資等級之高風險債券'},
 {id:'FTZN10',name:'富達日本價值基金',shareClass:'A股累計美元避險',currency:'USD'},
 {id:'FTZF8',name:'富達亞洲成長趨勢基金',shareClass:'A股累計美元',currency:'USD'},
 {id:'ACFD02',name:'富達台灣成長基金',shareClass:'A股累積型新臺幣',currency:'TWD'}
];
export function parseNavSeries(body,now=new Date()){
 const [ds,vs]=body.trim().split(/\s+/),dates=ds?.split(',')||[],values=vs?.split(',')||[];
 if(dates.length!==values.length)throw Error('淨值日期與數值長度不符');
 return dates.flatMap((d,i)=>/^\d{8}$/.test(d)&&Number.isFinite(num(values[i]))&&num(values[i])>0&&date(d)<=dateIn(now,'Asia/Taipei')?[{date:date(d),value:num(values[i])}]:[]).sort((a,b)=>a.date.localeCompare(b.date));
}
async function fund(f){
 const type=f.id.startsWith('AC')?'wr':'wb',sourceUrl=`https://mmafund.sinopac.com/w/${type}/${type}02.djhtm?a=${f.id}`;
 const r=await get(sourceUrl);const page=new TextDecoder('big5').decode(await r.arrayBuffer());
 // Validate the fund identity and share class before accepting its series.
 const expected=f.name.replace('富達','');
 if(!page.includes(expected)||!page.includes(f.currency==='TWD'?'累積':'累計'))throw Error('無法核對基金級別');
 if(f.id==='FTZN10'&&!page.includes('美元避險'))throw Error('無法核對避險級別');
 const url=`https://mmafund.sinopac.com/w/bcd/${type==='wr'?'tBCDNavList':'BCDNavList'}.djbcd?a=${f.id}&b=1`;
 const series=parseNavSeries(await (await get(url)).text());if(series.length<2)throw Error('淨值不足兩筆');
 const latest=series.at(-1),prev=series.at(-2),change=latest.value-prev.value;
 return {...f,status:'ok',sourceUrl,source:'永豐銀行／嘉實資訊',nav:latest.value,date:latest.date,previousDate:prev.date,change,changePct:change/prev.value*100,history:series.slice(-30),checkedAt:new Date().toISOString()};
}
const instruments=[
 {id:'otc',symbol:'^TWOII',name:'櫃買指數',unit:'點'},
 {id:'usd-twd',symbol:'TWD=X',name:'美元／新臺幣',unit:'TWD / USD'},
 {id:'usd-jpy',symbol:'JPY=X',name:'美元／日圓',unit:'JPY / USD'},
 {id:'treasury',symbol:'^TNX',name:'美國10年期公債殖利率',unit:'%',yield:true},
 {id:'gold',symbol:'GC=F',name:'黃金期貨',unit:'美元／盎司'},
 {id:'oil',symbol:'CL=F',name:'WTI原油期貨',unit:'美元／桶'}
];
async function instrument(f){
 if(f.id==='otc'){const sourceUrl='https://www.tpex.org.tw/openapi/v1/tpex_index';const rows=await(await get(sourceUrl)).json();const series=rows.filter(r=>/^\d{8}$/.test(r.Date)&&date(r.Date)<dateIn(new Date(),'Asia/Taipei')).sort((a,b)=>a.Date.localeCompare(b.Date));const r=series.at(-1);if(!r||!Number.isFinite(num(r.Close)))throw Error('櫃買收盤尚未公布');const value=num(r.Close),change=num(r.Change);return {...f,status:'ok',value,change,changePct:change/(value-change)*100,date:date(r.Date),source:'櫃買中心',sourceUrl,history:series.slice(-30).map(r=>({date:date(r.Date),value:num(r.Close)}))};}
 const sourceUrl=`https://finance.yahoo.com/quote/${encodeURIComponent(f.symbol)}/history/`;
 let body,error;
 for(const host of ['query1.finance.yahoo.com','query2.finance.yahoo.com'])try{body=await(await get(`https://${host}/v8/finance/chart/${encodeURIComponent(f.symbol)}?range=3mo&interval=1d`)).json();break;}catch(e){error=e;}
 if(!body)throw error;
 const result=body.chart?.result?.[0],quotes=result?.indicators?.quote?.[0]?.close;
 const today=dateIn(new Date(),'UTC');
 const series=(result?.timestamp||[]).flatMap((stamp,i)=>Number.isFinite(quotes?.[i])?[{sessionDate:dateIn(new Date(stamp*1000),'UTC'),close:quotes[i]}]:[]).filter(x=>x.sessionDate<today).sort((a,b)=>a.sessionDate.localeCompare(b.sessionDate));
 const latest=series.at(-1);if(!latest)throw Error('收盤資料不足');
 const idx=series.findIndex(x=>x.sessionDate===latest.sessionDate),prev=series[idx-1];if(!prev)throw Error('前期資料不足');
 return {...f,status:'ok',value:latest.close,date:latest.sessionDate,change:latest.close-prev.close,changePct:(latest.close/prev.close-1)*100,history:series.slice(Math.max(0,idx-29),idx+1).map(x=>({date:x.sessionDate,value:x.close})),source:'Yahoo Finance',sourceUrl,checkedAt:new Date().toISOString()};
}
async function breadth(sessionDate){
 const sourceUrl=`https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${sessionDate.replaceAll('-','')}&type=ALL`;
 const body=await(await get(sourceUrl)).json();if(body.stat!=='OK'||body.date!==sessionDate.replaceAll('-',''))throw Error('市場廣度日期不一致');
 const table=body.tables?.find(t=>t.title==='漲跌證券數合計');const read=name=>{const row=table?.data?.find(r=>String(r[0]).startsWith(name));return row?num(String(row[2]).split('(')[0]):null;};
 return {date:sessionDate,advancers:read('上漲'),decliners:read('下跌'),unchanged:read('持平'),scope:'上市股票',source:'臺灣證券交易所',sourceUrl,status:'ok'};
}
let cached=null,pending=null;
export async function dashboardData(markets,force=false){
 if(pending)return pending;
 if(cached&&!force&&Date.now()-Date.parse(cached.checkedAt)<300000)return cached;
 pending=(async()=>{
  const jobs=[...funds.map(f=>fund(f)),...instruments.map(f=>instrument(f)),breadth(markets.taiwan.sessionDate)],results=await Promise.allSettled(jobs);
  const unwrap=(r,meta)=>r.status==='fulfilled'?r.value:{...meta,status:'error',error:r.reason?.message||'讀取未完成'};
  cached={checkedAt:new Date().toISOString(),funds:results.slice(0,5).map((r,i)=>unwrap(r,funds[i])),macro:results.slice(5,11).map((r,i)=>unwrap(r,instruments[i])),breadth:unwrap(results[11],{scope:'上市股票'})};return cached;
 })().finally(()=>{pending=null;});return pending;
}
