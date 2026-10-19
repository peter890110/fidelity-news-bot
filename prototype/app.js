import {plainTitle,plainPoint,articleText,marketLines,marketText,reportText} from './report-text.js';
const $ = id => document.getElementById(id);
const time = value => new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
let current;
let toastTimer;
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function icon(name){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('aria-hidden','true');const u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href',`#i-${name}`);s.append(u);return s;}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3300);}
async function copyText(text,label){
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
 articles.forEach(a=>{
  const article=el('article','article');article.dataset.id=a.id;
  article.append(el('h3','article-title',plainTitle(a.title)));
  const points=el('ol','points');
  a.points.slice(0,3).forEach(p=>{const li=el('li','point');li.append(el('p','',plainPoint(p)));points.append(li)});
  article.append(points,copyButton(()=>articleText(a),'複製標題與三個重點'));container.append(article);
 });
}
function filteredArticles(){return current.articles.filter(a=>$('focus').value==='all'||a.topic===$('focus').value);}
function render(){
 const filtered=filteredArticles();
 renderMarket('taiwan',current.markets.taiwan);renderMarket('us',current.markets.us);
 for(const [key,section] of [['udn','economic'],['ctee','commercial']]){
  const items=filtered.filter(a=>a.sourceKey===key);$(section).hidden=!items.length;
  $(section).querySelector('.section-top>span').textContent=`精選 ${items.length} 篇`;
  const nav=document.querySelector(`.section-nav a[href="#${section}"]`);nav.hidden=!items.length;
  renderArticles(key,items);
 }
 $('filter-empty').hidden=filtered.length>0;
 const stamp=current.checkedAt||current.preparedAt;
 $('updated').textContent=`${current.reportDate.replaceAll('-',' / ')} · 經濟日報 2 篇／工商時報 2 篇 · ${current.checkedAt?'新聞查詢':'報告整理'} ${time(stamp)}（台北時間）`;
 const hours=Number($('range').value),old=filtered.filter(a=>Date.now()-Date.parse(a.publishedAt)>hours*3600000).length;
 const notices=[...(current.notes||[])];
 if(old)notices.push(`所選 ${hours} 小時內的完整整理不足，保留 ${old} 篇較早報導。`);
 if(filtered.some(a=>a.sourceStatus==='cached'))notices.push('部分新聞暫時無法讀取，保留上次整理的重點。');
 $('notice').hidden=!notices.length;$('notice').textContent=notices.join(' ');
 $('copy').disabled=false;
}
async function load(){try{const r=await fetch('/api/report',{cache:'no-store'});if(!r.ok)throw Error();current=await r.json();render()}catch{$('updated').textContent='報告載入未完成，請按上方按鈕重試。'}}
async function refresh(){
 const button=$('refresh');button.disabled=true;button.classList.add('loading');button.querySelector('span').textContent='正在更新新聞與盤後資料…';
 try{const r=await fetch(`/api/refresh?hours=${$('range').value}`,{method:'POST',signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error();current=await r.json();render();toast(current.rateLimited?'一分鐘內已完成查詢，顯示最近結果':current.added?`已更新 ${current.added} 篇新聞重點`:`已重新查詢，保留 ${current.articles.length} 篇完整整理`)}
 catch{toast('查詢暫時未完成，已保留現有報告。')}
 finally{button.disabled=false;button.classList.remove('loading');button.querySelector('span').textContent='獲取最新財經解析'}
}
$('refresh').addEventListener('click',refresh);
$('range').addEventListener('change',()=>{if(current)render()});
$('focus').addEventListener('change',()=>{if(current)render()});
$('copy').addEventListener('click',()=>copyText(reportText(current,filteredArticles()),'完整報告'));
load();
