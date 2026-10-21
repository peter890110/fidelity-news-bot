import {NEWS_WINDOW_MS,ARTICLES_PER_SOURCE,freshArticles} from './news-policy.js';
import {plainTitle,plainPoint,articleText,marketLines,marketText,reportText} from './report-text.js';
const $ = id => document.getElementById(id);
const time = value => new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
let current;
let toastTimer;
let expiryTimer;
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function icon(name){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('aria-hidden','true');const u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href',`#i-${name}`);s.append(u);return s;}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3300);}
async function copyText(text,label){
 if(!text){render();toast('這篇新聞已超過六小時，已移除。');return;}
 const focused=document.activeElement;
 const selection=document.createElement('textarea');
 selection.value=text;selection.readOnly=true;selection.setAttribute('aria-hidden','true');
 Object.assign(selection.style,{position:'fixed',left:'-9999px',top:'0'});
 document.body.append(selection);selection.select();
 let copied=false;
 try{copied=document.execCommand('copy');}catch{}
 selection.remove();focused?.focus({preventScroll:true});
 if(!copied){try{await navigator.clipboard.writeText(text);copied=true;}catch{}}
 if(copied)toast(`已複製${label}`);
 else{$('copy-text').value=text;$('copy-dialog').showModal();$('copy-text').focus();$('copy-text').select();}
}
function copyButton(text,label){const button=el('button','copy-brief',label);button.type='button';button.append(icon('copy'));button.addEventListener('click',()=>copyText(text(),label.replace('複製','')));return button;}
function renderMarket(id,market){
 const box=$(id),area=box.querySelector('.market-content');area.replaceChildren();
 box.querySelector('.session-date').textContent=`${market.sessionDate} 收盤${id==='us'?'・美東':''}｜${market.status==='unverified'?'留存資料・待核對':'前一交易日'}`;
 if(market.status==='unverified')area.append(el('p','market-warning',market.verificationError));
 const list=el('ul','market-list'),lines=marketLines(id,market);
 lines.forEach((text,i)=>{const li=el('li',i===lines.length-1?'market-recap':'',text);if(text.includes('待公布'))li.classList.add('market-pending');list.append(li)});
 area.append(list,copyButton(()=>marketText(id,market),`複製${market.label}`));
}
function renderArticles(key,articles){
 const container=$(key);container.replaceChildren();
 if(!articles.length){
  const d=current.sourceDiagnostics?.[key];
  const message=d?.status==='error'||d?.fetchFailed||d?.summaryFailed
   ?'新聞來源讀取或整理未完成，請重新更新；這不代表六小時內沒有相關新聞。'
   :$('focus').value!=='all'?'目前分類沒有已完成整理的新聞，可切換「全部」查看。':'尚未取得六小時內已核對的新聞，請按上方按鈕重新查詢。';
  container.append(el('p','news-empty',message));return;
 }
 articles.forEach(a=>{
  const article=el('article','article');article.dataset.id=a.id;
  article.append(el('h3','article-title',plainTitle(a.title)));
  const points=el('ol','points');
  a.points.slice(0,3).forEach(p=>{const li=el('li','point');li.append(el('p','',plainPoint(p)));points.append(li)});
  article.append(points,copyButton(()=>articleText(a),'複製標題與三個重點'));container.append(article);
 });
}
function filteredArticles(){return freshArticles(current.articles).filter(a=>$('focus').value==='all'||(a.category||'finance')===$('focus').value);}
function render(){
 const filtered=filteredArticles();
 renderMarket('taiwan',current.markets.taiwan);renderMarket('us',current.markets.us);
 for(const [key,section] of [['udn','economic'],['ctee','commercial']]){
  const items=filtered.filter(a=>a.sourceKey===key);$(section).hidden=false;
  $(section).querySelector('.section-top>span').textContent=`最近六小時 ${items.length} 篇／目標 ${ARTICLES_PER_SOURCE} 篇`;
  const nav=document.querySelector(`.section-nav a[href="#${section}"]`);nav.hidden=false;nav.querySelector('b').textContent=items.length;
  renderArticles(key,items);
 }
 $('filter-empty').hidden=filtered.length>0||$('focus').value==='all';
 const now=Date.now(),all=freshArticles(current.articles,now),start=new Date(now-NEWS_WINDOW_MS).toISOString();
 const counts={udn:all.filter(a=>a.sourceKey==='udn').length,ctee:all.filter(a=>a.sourceKey==='ctee').length};
 $('updated').textContent=`發布範圍 ${time(start)} — ${time(new Date(now).toISOString())}（台北時間） · 經濟日報 ${counts.udn} 篇／工商時報 ${counts.ctee} 篇`;
 const notices=[...(current.notes||[])];
 if((counts.udn<ARTICLES_PER_SOURCE||counts.ctee<ARTICLES_PER_SOURCE)&&!notices.length)notices.push('目前已核對的新聞尚未補足每家三篇；仍僅採用原始發布時間在六小時內的報導。');
 $('notice').hidden=!notices.length;$('notice').textContent=notices.join(' ');
 clearTimeout(expiryTimer);
 if(all.length){const next=Math.min(...all.map(a=>Date.parse(a.publishedAt)+NEWS_WINDOW_MS+1));expiryTimer=setTimeout(render,Math.max(1,next-Date.now()));}
 $('copy').disabled=false;
}
async function load(){try{const r=await fetch('/api/report',{cache:'no-store',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error();current=await r.json();render()}catch{$('updated').textContent='報告載入未完成，請按上方按鈕重試。'}}
async function refresh(){
 const button=$('refresh');button.disabled=true;button.classList.add('loading');button.querySelector('span').textContent='正在更新新聞與盤後資料…';
 try{const r=await fetch('/api/refresh',{method:'POST',signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error();current=await r.json();render();toast(current.rateLimited?'一分鐘內已完成查詢，顯示最近結果':current.added?`已更新 ${current.added} 篇新聞重點`:`已完成查詢：最近六小時內 ${freshArticles(current.articles).length} 篇`)}
 catch{if(current)render();toast('查詢暫時未完成，僅保留仍在六小時內的新聞。')}
 finally{button.disabled=false;button.classList.remove('loading');button.querySelector('span').textContent='獲取最新財經解析'}
}
$('refresh').addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{if(current)render()});
window.addEventListener('focus',()=>{if(current)render()});
$('focus').addEventListener('change',()=>{if(current)render()});
$('copy').addEventListener('click',()=>copyText(reportText(current,filteredArticles()),'完整報告'));
load();
