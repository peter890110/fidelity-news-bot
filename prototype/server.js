import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createMacroBrief, topicFor } from './summary.js';
import { fetchInstitutional } from './market-data.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const seed = JSON.parse(await fs.readFile(path.join(root, 'report.json'), 'utf8'));
let report = structuredClone(seed);
try { report = JSON.parse(await fs.readFile(path.join(root, 'latest.json'), 'utf8')); } catch {}
report.markets = structuredClone(seed.markets);
report.layoutVersion = seed.layoutVersion;
let flowChecking = null;
let lastFlowCheck = 0;
async function checkMarketFlows() {
 if(flowChecking)return flowChecking;
 if(Date.now()-lastFlowCheck<60000)return;
 lastFlowCheck=Date.now();
 flowChecking=fetchInstitutional(report.markets.taiwan).then(m=>{report.markets.taiwan=m;}).catch(()=>{}).finally(()=>{flowChecking=null;});
 return flowChecking;
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
  const r = await fetch(url,{...options,signal:AbortSignal.timeout(10000),headers:{'user-agent':UA,...options.headers}});
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
async function feed(source) {
  const q=`site:${source.domain} (央行 OR 通膨 OR 利率 OR 匯率 OR GDP OR IMF OR 經濟成長) when:7d`;
  const xml=await fetchText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>({title:xmlTag(m[1],'title').replace(/\s*-\s*工商時報$/,'').replace(/\s*-\s*經濟日報$/,''),url:xmlTag(m[1],'link'),publishedAt:xmlTag(m[1],'pubDate'),sourceKey:source.key,source:source.name})).filter(x=>x.title&&x.url&&Number.isFinite(Date.parse(x.publishedAt))&&Date.parse(x.publishedAt)<=Date.now()+60000);
}
async function resolveLink(url) {
  if (!url.startsWith('https://news.google.com/')) return canonical(url);
  const id=new URL(url).pathname.split('/').at(-1);
  const html=await fetchText(`https://news.google.com/rss/articles/${id}?hl=zh-TW&gl=TW&ceid=TW:zh-Hant`);
  const sig=html.match(/data-n-a-sg="([^"]+)"/)?.[1],ts=html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sig||!ts) throw new Error('無法取得新聞原文連結');
  const ctx=[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0];
  const envelope=[[["Fbv4je",JSON.stringify(['garturlreq',ctx,id,Number(ts),sig]),null,'0']]];
  const raw=await fetchText('https://news.google.com/_/DotsSplashUi/data/batchexecute',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({'f.req':JSON.stringify(envelope)}).toString()});
  const rows=JSON.parse(raw.slice(raw.indexOf('\n\n')+2));
  const row=rows.find(x=>x[0]==='wrb.fr'&&x[1]==='Fbv4je');
  if (!row) throw new Error('無法解析原文連結');
  return canonical(JSON.parse(row[2])[1]);
}
function score(a,hours) {
  const age=(Date.now()-Date.parse(a.publishedAt))/3600000;
  let n=(age<=hours?35:0)+Math.max(0,24-age)*.4;
  for (const t of ['央行','通膨','利率','匯率','經濟成長','GDP','IMF','PPI','CPI','貿易','出口']) if(a.title.includes(t)) n+=5;
  for (const t of ['ETF','配息','基金','概念股','飆股','房價','抽獎','ASIC','營收']) if(a.title.includes(t))n-=15;
  return n;
}
function sameStory(a,b) {return a.title.replace(/[\s\p{P}\p{S}]/gu,'').includes(b.originalTitle.replace(/[\s\p{P}\p{S}]/gu,''));}
async function updateSource(source,hours) {
  const items=await feed(source);
  const old=report.articles.filter(x=>x.sourceKey===source.key);
  // Keep the complete, researched selection while it is still inside the requested window.
  const freshKnown=old.filter(x=>Date.now()-Date.parse(x.publishedAt)<=hours*3600000);
  const ranked=items.sort((a,b)=>score(b,hours)-score(a,hours));
  const selected=[...freshKnown];
  for(const a of ranked.slice(0,8)) {
    if(selected.length>=2)break;
    if(selected.some(x=>sameStory(a,x)))continue;
    try {
      const url=await resolveLink(a.url);
      const host=new URL(url).hostname;
      if (!host.endsWith(source.domain))continue;
      const parsed=parseArticle(await fetchText(url),url);
      const found=known.get(url);
      const article=found ? {...found} : {...a,id:createHash('sha256').update(url).digest('hex').slice(0,12),title:parsed.title||a.title,originalTitle:parsed.title||a.title,url,publishedAt:parsed.publishedAt||a.publishedAt,topic:topicFor(parsed.title,parsed.body),...createMacroBrief(parsed.title,parsed.paragraphs)};
      if(selected.some(x=>x.url===url))continue;
      selected.push({...article,contentHash:parsed.hash,checkedAt:new Date().toISOString()});
    } catch { /* Try the next public article; do not replace a complete brief with a title. */ }
  }
  for (const a of old) if(selected.length<2&&!selected.some(x=>x.id===a.id))selected.push(a);
  const checked=await Promise.all(selected.slice(0,2).map(async a=>{
    try {const parsed=parseArticle(await fetchText(a.url),a.url);return {...a,checkedAt:new Date().toISOString(),sourceStatus:'ok',contentHash:parsed.hash,sourceChanged:Boolean(a.contentHash&&a.contentHash!==parsed.hash)};}
    catch {return {...a,sourceStatus:'cached'};}
  }));
  return {articles:checked,discovered:items.length,candidates:ranked.slice(0,5).map(a=>({title:a.title,url:a.url,publishedAt:a.publishedAt,source:source.name}))};
}
async function refreshReport(hours) {
  const result=await Promise.allSettled([...sources.map(s=>updateSource(s,hours)),checkMarketFlows()]);
  const notes=[];let discovered=0;let candidates=[];
  const articles=sources.flatMap((s,i)=>{
    if(result[i].status==='fulfilled'){discovered+=result[i].value.discovered;candidates.push(...result[i].value.candidates);return result[i].value.articles;}
    notes.push(`${s.name}查詢暫時受限，保留上次完整整理`);return report.articles.filter(a=>a.sourceKey===s.key);
  });
  const before=new Set(report.articles.map(x=>x.id));
  const added=articles.filter(x=>!before.has(x.id)).length;
  report={...report,reportDate:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date()),articles,checkedAt:new Date().toISOString(),discovered,candidates,notes,added};
  // Atomic persistence: a failed request never erases the last useful report.
  await fs.writeFile(path.join(root,'latest.json.tmp'),JSON.stringify(report,null,2));
  await fs.rename(path.join(root,'latest.json.tmp'),path.join(root,'latest.json'));
  return report;
}
function send(res,status,data,type='application/json; charset=utf-8') {
 res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-robots-tag':'noindex, nofollow'});res.end(typeof data==='string'?data:JSON.stringify(data));
}
async function handle(req,res) {
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/healthz'&&req.method==='GET'){send(res,200,{status:'ok'});return;}
 if(u.pathname==='/robots.txt'&&req.method==='GET'){send(res,200,'User-agent: *\nDisallow: /\n','text/plain; charset=utf-8');return;}
 if(u.pathname==='/api/report'&&req.method==='GET'){await checkMarketFlows();send(res,200,report);return;}
 if(u.pathname==='/api/refresh'&&req.method==='POST'){
  const n=Number(u.searchParams.get('hours')||24);const hours=[12,24,72,168].includes(n)?n:24;
  if(!refreshing&&Date.now()-lastRefreshStarted<60000){send(res,200,{...report,rateLimited:true});return;}
  if(!refreshing){lastRefreshStarted=Date.now();refreshing=refreshReport(hours).finally(()=>{refreshing=null;});}
  send(res,200,await refreshing);return;
 }
 const file=['/','/market-v2'].includes(u.pathname)?'index.html':u.pathname.slice(1);
 const types={'index.html':'text/html; charset=utf-8','style.css':'text/css; charset=utf-8','app.js':'text/javascript; charset=utf-8'};
 if(req.method!=='GET'||!types[file]){send(res,404,{error:'找不到頁面'});return;}
 send(res,200,await fs.readFile(path.join(root,file),'utf8'),types[file]);
}
http.createServer((req,res)=>handle(req,res).catch(e=>{console.error(e.message);if(!res.headersSent)send(res,500,{error:'更新暫時未完成，請稍後再試'});})).listen(PORT,HOST,()=>console.log(`Server listening on ${HOST}:${PORT}`));
