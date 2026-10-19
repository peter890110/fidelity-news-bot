import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createMacroBrief, topicFor } from './summary.js';
import { refreshMarkets, dateIn } from './market-data.js';
import {NEWS_HOURS,isWithinNewsWindow,isFinanceNews,freshArticles,enforceNewsWindow} from './news-policy.js';

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
async function feed(source,deadline) {
  const q=`site:${source.domain} (央行 OR 通膨 OR 利率 OR 匯率 OR GDP OR IMF OR 經濟成長) when:6h`;
  const xml=await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`,{deadline});
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>({title:xmlTag(m[1],'title').replace(/\s*-\s*工商時報$/,'').replace(/\s*-\s*經濟日報$/,''),url:xmlTag(m[1],'link'),publishedAt:xmlTag(m[1],'pubDate'),sourceKey:source.key,source:source.name})).filter(x=>x.title&&x.url&&isWithinNewsWindow(x.publishedAt)&&isFinanceNews(x.title));
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
 const age=(Date.now()-Date.parse(a.publishedAt))/3600000;
 let n=Math.max(0,NEWS_HOURS-age);
 for(const t of ['央行','通膨','利率','匯率','經濟成長','GDP','IMF','PPI','CPI','貿易','出口'])if(a.title.includes(t))n+=5;
 return n;
}
async function updateSource(source) {
 const deadline=Date.now()+30000;
 const items=await feed(source,deadline);
 const selected=[];
 const ranked=items.filter(a=>isWithinNewsWindow(a.publishedAt)).sort((a,b)=>score(b)-score(a));
 for(const candidate of ranked.slice(0,8)) {
  if(selected.length>=2||Date.now()>=deadline)break;
  try {
   const url=await resolveLink(candidate.url,deadline),host=new URL(url).hostname;
   if(host!==source.domain&&!host.endsWith('.'+source.domain))continue;
   if(selected.some(a=>a.url===url))continue;
   const parsed=parseArticle(await fetchText(url,{deadline}),url);
   // The publisher's ORIGINAL publication time is mandatory. Never substitute
   // RSS indexing time, modified time, or our own query time for an old story.
   if(!isWithinNewsWindow(parsed.publishedAt)||!isFinanceNews(parsed.title,parsed.body))continue;
   const found=known.get(url);
   const brief=found&&found.contentHash===parsed.hash?{points:found.points,mode:found.mode}:createMacroBrief(parsed.title,parsed.paragraphs);
   selected.push({...candidate,...brief,id:createHash('sha256').update(url).digest('hex').slice(0,12),url,
    title:parsed.title||candidate.title,originalTitle:parsed.title||candidate.title,
    publishedAt:parsed.publishedAt,publicationVerified:true,financeEvidence:parsed.title,
    topic:topicFor(parsed.title,parsed.body),contentHash:parsed.hash,checkedAt:new Date().toISOString(),sourceStatus:'ok'});
  }catch { /* An unreadable or unverified story is omitted, never replaced with an older one. */ }
 }
 // Previously verified stories may survive a transient fetch failure ONLY while
 // their actual publication time remains inside the same rolling six hours.
 for(const a of freshArticles(report.articles).filter(a=>a.sourceKey===source.key).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))){
  if(selected.length>=2)break;
  if(!selected.some(x=>x.url===a.url))selected.push(a);
 }
 return {articles:freshArticles(selected),discovered:items.length};
}
async function refreshReport() {
 const before=new Set(freshArticles(report.articles).map(x=>x.id));
 const result=await Promise.allSettled([...sources.map(updateSource),checkMarkets()]);
 const notes=[];let discovered=0;
 const articles=sources.flatMap((s,i)=>{
  if(result[i].status==='fulfilled'){discovered+=result[i].value.discovered;return result[i].value.articles;}
  notes.push(`${s.name}本次查詢受限；僅顯示六小時內已核對的報導。`);
  return freshArticles(report.articles).filter(a=>a.sourceKey===s.key);
 });
 report=enforceNewsWindow({...report,reportDate:dateIn(new Date(),'Asia/Taipei'),articles,checkedAt:new Date().toISOString(),discovered,notes});
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
http.createServer((req,res)=>handle(req,res).catch(e=>{console.error(e.message);if(!res.headersSent)send(res,500,{error:'更新暫時未完成，請稍後再試'});})).listen(PORT,HOST,()=>console.log(`Server listening on ${HOST}:${PORT}`));
