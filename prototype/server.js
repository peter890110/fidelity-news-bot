import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createMacroBrief, topicFor } from './summary.js';
import { refreshMarkets, dateIn } from './market-data.js';
import {NEWS_HOURS,ARTICLES_PER_SOURCE,categoryFor,isWithinNewsWindow,isFinanceNews,freshArticles,enforceNewsWindow} from './news-policy.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const seed = JSON.parse(await fs.readFile(path.join(root, 'report.json'), 'utf8'));
let report = structuredClone(seed);
try { report = JSON.parse(await fs.readFile(path.join(root, 'latest.json'), 'utf8')); } catch {}
// Keep persisted sessions across restarts. Re-check dates on every new reporting day.
if(report.layoutVersion!==seed.layoutVersion)report.markets=structuredClone(seed.markets);
report.layoutVersion=seed.layoutVersion;
report=enforceNewsWindow(report);
let marketChecking=null;
let lastMarketCheck=0;
let lastMarketDay='';
async function checkMarkets() {
 if(marketChecking)return marketChecking;
 const day=dateIn(new Date(),'Asia/Taipei');
 if(lastMarketDay===day&&Date.now()-lastMarketCheck<300000)return;
 lastMarketDay=day;lastMarketCheck=Date.now();
 marketChecking=refreshMarkets(report.markets).then(markets=>{report.markets=markets;report.reportDate=day;}).finally(()=>{marketChecking=null;});
 return marketChecking;
}
let refreshing = null;
let lastRefreshStarted = 0;
const sources = [{ key:'udn', name:'經濟日報', domain:'money.udn.com' }, { key:'ctee', name:'工商時報', domain:'ctee.com.tw' }];
const known = new Map(seed.articles.map(a => [a.url, a]));
const UA = 'Mozilla/5.0 (compatible; FinancialBriefPrototype/0.2)';

export function clean(s='') {
  return s.replace(/<!\[CDATA\[|\]\]>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'')
    .replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"')
    .replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,c)=>String.fromCodePoint(Number(c))).replace(/\s+/g,' ').trim();
}
const xmlTag = (s,n) => clean(s.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`))?.[1] || '');
const canonical = u => { const x = new URL(u); x.search='';x.hash='';return x.href; };
async function fetchText(url,options={}) {
  const {deadline,...request}=options;
  const timeout=Math.max(1,Math.min(8000,(deadline||Date.now()+8000)-Date.now()));
  const r = await fetch(url,{...request,signal:AbortSignal.timeout(timeout),headers:{'user-agent':UA,...options.headers}});
  if (!r.ok) throw new Error(`來源回應 ${r.status}`);
  return r.text();
}
function meta(html,key) {
  return clean([...html.matchAll(/<meta\b[^>]*>/gi)].find(x=>new RegExp(`(?:name|property)=["']${key}["']`,'i').test(x[0]))?.[0].match(/content=["']([^"']*)["']/i)?.[1]||'');
}
export function parseArticle(html,url) {
  const isUdn = new URL(url).hostname==='money.udn.com';
  const block = isUdn ? html.match(/<section\b[^>]*id\s*=\s*["']article_body["'][^>]*>([\s\S]*?)<\/section>/i)?.[1]
    : html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  const paragraphs = [...(block||'').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>clean(m[1])).filter(s=>s.length>20);
  if (!paragraphs.length || paragraphs.join('').length<120) throw new Error('未取得足夠的公開新聞內文');
  let date = meta(html,'article:published_time') || html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
  if (date && !/[Z+]|-\d\d:\d\d$/.test(date.slice(10))) date=date.replace(' ','T')+'+08:00';
  return { title:meta(html,'og:title').split(' | ')[0], paragraphs, body:paragraphs.join('\n'), publishedAt:date, hash:createHash('sha256').update(paragraphs.join('\n')).digest('hex') };
}
export async function feed(source,deadline) {
  const q=`site:${source.domain} when:6h`;
  const xml=await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`,{deadline});
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>({title:xmlTag(m[1],'title').replace(/\s*-\s*工商時報$/,'').replace(/\s*-\s*經濟日報$/,''),url:xmlTag(m[1],'link'),publishedAt:xmlTag(m[1],'pubDate'),sourceKey:source.key,source:source.name})).filter(x=>x.title&&x.url&&isWithinNewsWindow(x.publishedAt)&&isFinanceNews(x.title));
}
// Publisher links avoid Google's extra redirect requests and indexing delay.
export function publisherLinks(html,source) {
 const seen=new Set();const out=[];
 for(const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)){
  try{
   const url=canonical(new URL(m[1],`https://${source.domain}`).href),u=new URL(url);
   if(u.hostname!==source.domain&&!u.hostname.endsWith('.'+source.domain))continue;
   if(!(source.key==='udn'?/\/money\/story\/\d+\/\d+$/:/\/news\/\d+-\d+$/).test(u.pathname)||seen.has(url))continue;
   const title=clean(m[2]);if(!title||!isFinanceNews(title))continue;
   seen.add(url);out.push({title,url,sourceKey:source.key,source:source.name});
  }catch{}
 }
 return out;
}
async function discover(source,deadline) {
 const pages=source.key==='udn'?['https://money.udn.com/rank/newest/1001/0/1','https://money.udn.com/money/index']:['https://www.ctee.com.tw/livenews'];
 const results=await Promise.allSettled([feed(source,deadline),...pages.map(async u=>publisherLinks(await fetchText(u,{deadline}),source))]);
 const items=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
 if(!items.length&&results.every(r=>r.status==='rejected'))throw new Error('來源清單無法讀取');
 const unique=[...new Map(items.map(a=>[a.url,a])).values()];
 return {items:unique,discoveryErrors:results.filter(r=>r.status==='rejected').length};
}
async function resolveLink(url,deadline) {
  if (!url.startsWith('https://news.google.com/')) return canonical(url);
  const id=new URL(url).pathname.split('/').at(-1);
  const html=await fetchText(`https://news.google.com/rss/articles/${id}?hl=zh-TW&gl=TW&ceid=TW:zh-Hant`,{deadline});
  const sig=html.match(/data-n-a-sg="([^"]+)"/)?.[1],ts=html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sig||!ts) throw new Error('無法取得新聞原文連結');
  const ctx=[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0];
  const envelope=[[["Fbv4je",JSON.stringify(['garturlreq',ctx,id,Number(ts),sig]),null,'0']]];
  const raw=await fetchText('https://news.google.com/_/DotsSplashUi/data/batchexecute',{deadline,method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({'f.req':JSON.stringify(envelope)}).toString()});
  const rows=JSON.parse(raw.slice(raw.indexOf('\n\n')+2));
  const row=rows.find(x=>x[0]==='wrb.fr'&&x[1]==='Fbv4je');
  if (!row) throw new Error('無法解析原文連結');
  return canonical(JSON.parse(row[2])[1]);
}
function score(a) {
 const age=a.publishedAt?(Date.now()-Date.parse(a.publishedAt))/3600000:0;
 let n=Math.max(0,NEWS_HOURS-age);
 for(const t of ['央行','通膨','利率','匯率','經濟成長','GDP','IMF','PPI','CPI','貿易','出口'])if(a.title.includes(t))n+=5;
 return n;
}
export async function updateSource(source) {
 const deadline=Date.now()+40000;
 const {items,discoveryErrors}=await discover(source,deadline);
 const stats={discovered:items.length,attempted:0,verified:0,fetchFailed:0,summaryFailed:0,outsideWindow:0,notFinance:0,discoveryErrors};
 const errors=[];const verified=[];
 const ranked=items.filter(a=>!a.publishedAt||isWithinNewsWindow(a.publishedAt)).sort((a,b)=>score(b)-score(a));
 // Direct publisher links are cheap; inspect them before redirect-based links.
 const direct=ranked.filter(a=>!a.url.startsWith('https://news.google.com/'));
 const indirect=ranked.filter(a=>a.url.startsWith('https://news.google.com/'));
 const first=['macro','industry','finance'].map(category=>indirect.find(a=>categoryFor(a.title)===category)).filter(Boolean);
 const queue=[...direct.slice(0,24),...first,...indirect.filter(a=>!first.includes(a)).slice(0,33)];
 let cursor=0;
 async function worker(){
  while(cursor<queue.length&&Date.now()<deadline){
   if(verified.length>=9&&['macro','industry','finance'].every(c=>verified.some(a=>a.category===c)))return;
   const candidate=queue[cursor++];stats.attempted++;let stage='fetch';
   try {
   const url=await resolveLink(candidate.url,deadline),host=new URL(url).hostname;
   if(host!==source.domain&&!host.endsWith('.'+source.domain))continue;
   if(verified.some(a=>a.url===url))continue;
   const parsed=parseArticle(await fetchText(url,{deadline}),url);
   // The publisher's ORIGINAL publication time is mandatory. Never substitute
   // RSS indexing time, modified time, or our own query time for an old story.
   if(!isWithinNewsWindow(parsed.publishedAt)){stats.outsideWindow++;continue;}
   if(!isFinanceNews(parsed.title,parsed.body)){stats.notFinance++;continue;}
   stage='summary';
   const found=known.get(url);
   const brief=found&&found.contentHash===parsed.hash?{points:found.points,mode:found.mode}:createMacroBrief(parsed.title,parsed.paragraphs);
   if(verified.some(a=>a.url===url))continue;
   verified.push({...candidate,...brief,id:createHash('sha256').update(url).digest('hex').slice(0,12),url,
    title:parsed.title||candidate.title,originalTitle:parsed.title||candidate.title,
    publishedAt:parsed.publishedAt,publicationVerified:true,financeEvidence:parsed.title+' '+parsed.body.slice(0,1500),
    category:found?.category||categoryFor(parsed.title,parsed.body),topic:topicFor(parsed.title,parsed.body),contentHash:parsed.hash,checkedAt:new Date().toISOString(),sourceStatus:'ok'});
   stats.verified++;
  }catch(e){stats[stage==='summary'?'summaryFailed':'fetchFailed']++;if(errors.length<5)errors.push({stage,message:e.message});}
  }
 }
 await Promise.all(Array.from({length:6},worker));
 const usable=freshArticles(verified).sort((a,b)=>score(b)-score(a));const selected=[];
 for(const category of ['macro','industry','finance']){const a=usable.find(a=>a.category===category);if(a)selected.push(a);}
 for(const a of usable)if(selected.length<ARTICLES_PER_SOURCE&&!selected.some(b=>b.url===a.url))selected.push(a);
 // Previously verified stories may survive a transient fetch failure ONLY while
 // their actual publication time remains inside the same rolling six hours.
 for(const a of freshArticles(report.articles).filter(a=>a.sourceKey===source.key).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))){
  if(selected.length>=ARTICLES_PER_SOURCE)break;
  if(!selected.some(x=>x.url===a.url))selected.push(a);
 }
 console.info(JSON.stringify({event:'news-source-refresh',source:source.key,...stats,selected:selected.length,errors}));
 return {articles:freshArticles(selected),discovered:items.length,stats,errors};
}
async function refreshReport() {
 const before=new Set(freshArticles(report.articles).map(x=>x.id));
 const result=await Promise.allSettled([...sources.map(updateSource),checkMarkets()]);
 const notes=[];let discovered=0;const sourceDiagnostics={};
 const articles=sources.flatMap((s,i)=>{
  if(result[i].status==='fulfilled'){
   const value=result[i].value;discovered+=value.discovered;sourceDiagnostics[s.key]={...value.stats,errors:value.errors,status:value.articles.length>=ARTICLES_PER_SOURCE?'ok':(value.stats.fetchFailed||value.stats.summaryFailed?'partial':'insufficient')};
   if(value.articles.length<ARTICLES_PER_SOURCE&&(value.stats.fetchFailed||value.stats.summaryFailed))notes.push(`${s.name}找到 ${value.discovered} 筆候選，但部分原文讀取或整理失敗，尚未補足三篇；並非沒有相關新聞。`);
   return value.articles;
  }
  sourceDiagnostics[s.key]={status:'error',message:result[i].reason?.message||'來源查詢失敗'};
  notes.push(`${s.name}本次查詢受限；僅顯示六小時內已核對的報導。`);
  return freshArticles(report.articles).filter(a=>a.sourceKey===s.key);
 });
 report=enforceNewsWindow({...report,reportDate:dateIn(new Date(),'Asia/Taipei'),articles,checkedAt:new Date().toISOString(),discovered,sourceDiagnostics,notes});
 report.added=report.articles.filter(a=>!before.has(a.id)).length;
 await fs.writeFile(path.join(root,'latest.json.tmp'),JSON.stringify(report,null,2));
 await fs.rename(path.join(root,'latest.json.tmp'),path.join(root,'latest.json'));
 return report;
}
function startRefresh(){
 if(!refreshing){lastRefreshStarted=Date.now();refreshing=refreshReport().finally(()=>{refreshing=null;});}
 return refreshing;
}
function send(res,status,data,type='application/json; charset=utf-8') {
 res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-robots-tag':'noindex, nofollow'});res.end(typeof data==='string'?data:JSON.stringify(data));
}
async function handle(req,res) {
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/healthz'&&req.method==='GET'){send(res,200,{status:'ok'});return;}
 if(u.pathname==='/robots.txt'&&req.method==='GET'){send(res,200,'User-agent: *\nDisallow: /\n','text/plain; charset=utf-8');return;}
 if(u.pathname==='/api/report'&&req.method==='GET'){
  if(!lastRefreshStarted||Date.now()-lastRefreshStarted>=300000)await startRefresh();
  else await checkMarkets();
  report=enforceNewsWindow(report);send(res,200,report);return;
 }
 if(u.pathname==='/api/refresh'&&req.method==='POST'){
  // The six-hour limit is fixed; query parameters cannot widen it.
  if(!refreshing&&Date.now()-lastRefreshStarted<60000){report=enforceNewsWindow(report);send(res,200,{...report,rateLimited:true});return;}
  await startRefresh();report=enforceNewsWindow(report);send(res,200,report);return;
 }
 const file=['/','/market-v2','/market-v3','/news-6h'].includes(u.pathname)?'index.html':u.pathname.slice(1);
 const types={'index.html':'text/html; charset=utf-8','style.css':'text/css; charset=utf-8','app.js':'text/javascript; charset=utf-8','report-text.js':'text/javascript; charset=utf-8','news-policy.js':'text/javascript; charset=utf-8'};
 if(req.method!=='GET'||!types[file]){send(res,404,{error:'找不到頁面'});return;}
 send(res,200,await fs.readFile(path.join(root,file),'utf8'),types[file]);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))http.createServer((req,res)=>handle(req,res).catch(e=>{console.error(e.message);if(!res.headersSent)send(res,500,{error:'更新暫時未完成，請稍後再試'});})).listen(PORT,HOST,()=>console.log(`Server listening on ${HOST}:${PORT}`));
