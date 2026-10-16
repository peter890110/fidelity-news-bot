const $ = id => document.getElementById(id);
const time = value => new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
let current;
let toastTimer;
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function icon(name){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('aria-hidden','true');const u=document.createElementNS('http://www.w3.org/2000/svg','use');u.setAttribute('href',`#i-${name}`);s.append(u);return s;}
function link(url,label,cls='source-link'){const a=el('a',cls,label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.append(icon('external'));return a;}
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3300);}
function renderMarket(id,market){
 const box=$(id),area=box.querySelector('.market-content');area.replaceChildren();box.querySelector('.session-date').textContent=`${market.sessionDate} 收盤${id==='us'?'・美東':''}`;
 const metrics=el('div','market-metrics');
 market.metrics.forEach(m=>{const cell=el('div','metric');cell.append(el('div','metric-label',m.label),el('div','metric-value',m.value),el('div',`metric-change ${m.direction}`,m.change));metrics.append(cell)});area.append(metrics);
 if(market.flow){area.append(el('h3','',market.subheading));const flows=el('div','flows');market.flow.forEach(f=>{const row=el('div','',f.name);row.append(el('strong',f.value<0?'down':'up',`${f.value<0?'賣超':'買超'} ${Math.abs(f.value).toLocaleString('en-US',{minimumFractionDigits:2})} 億元`));flows.append(row)});area.append(flows)}
 area.append(el('h3','','盤後重點統整'),el('p','market-summary',market.summary),link(market.url,`${market.sourceLabel}・來源`));
}
function renderArticles(key,articles){
 const container=$(key);container.replaceChildren();
 articles.forEach(a=>{
  const article=el('article','article');article.dataset.id=a.id;
  const meta=el('div','article-meta');meta.append(el('span','topic',a.topic),el('span','','／'),el('time','',time(a.publishedAt)),el('span','',a.author||a.source));if(a.mode?.includes('規則'))meta.append(el('span','', '數據整理／總經觀察'));article.append(meta);
  const heading=el('h3','article-title');heading.append(link(a.url,`- ${a.title}`,''));article.append(heading);
  const points=el('ol','points');a.points.forEach(p=>{const li=el('li','point');li.append(el('h4','',p.heading),el('p','',p.text));points.append(li)});article.append(points);
  const foot=el('div','article-foot');foot.append(link(a.url,`閱讀${a.source}原文`),el('span','word-count',a.points.map(p=>`${[...p.text.replace(/\s/g,'')].length} 字`).join(' ／ ')));article.append(foot);container.append(article);
 });
}
function render(){
 const focus=$('focus').value;
 const filtered=current.articles.filter(a=>focus==='all'||a.topic===focus);
 renderMarket('taiwan',current.markets.taiwan);renderMarket('us',current.markets.us);
 for(const [key,section] of [['udn','economic'],['ctee','commercial']]){
  const items=filtered.filter(a=>a.sourceKey===key);$(section).hidden=!items.length;
  $(section).querySelector('.section-top>span').textContent=`精選 ${items.length} 篇`;
  const nav=document.querySelector(`.section-nav a[href="#${section}"]`);nav.hidden=!items.length;
  renderArticles(key,items);
 }
 $('filter-empty').hidden=filtered.length>0;
 const stamp=current.checkedAt||current.preparedAt;
 $('updated').textContent=`${current.reportDate.replaceAll('-',' / ')} · 經濟日報 2 篇／工商時報 2 篇 · ${current.checkedAt?'來源查詢':'報告整理'} ${time(stamp)}（台北時間）`;
 const hours=Number($('range').value),old=filtered.filter(a=>Date.now()-Date.parse(a.publishedAt)>hours*3600000).length;
 const notices=[...(current.notes||[])];
 if(old)notices.push(`所選 ${hours} 小時內的完整整理不足，保留 ${old} 篇較早報導；每篇均註明發布時間。`);
 if(filtered.some(a=>a.sourceStatus==='cached'))notices.push('部分原文暫時無法讀取，保留上次查閱完成的重點。');
 if(filtered.some(a=>a.sourceChanged))notices.push('部分原文有更新，請一併查看原文的最新說明。');
 $('notice').hidden=!notices.length;$('notice').textContent=notices.join(' ');
 $('discovery').hidden=!current.candidates?.length;
 if(current.candidates?.length){$('discovered-count').textContent=`・本次共找到 ${current.discovered} 篇`;$('candidates').replaceChildren();current.candidates.forEach(a=>{const row=link(a.url,a.title,'');row.prepend(el('span','',`${a.source}・${time(a.publishedAt)}`));$('candidates').append(row)})}
 $('copy').disabled=false;
}
async function load(){try{const r=await fetch('/api/report',{cache:'no-store'});if(!r.ok)throw Error();current=await r.json();render()}catch{$('updated').textContent='報告載入未完成，請按上方按鈕重試。'}}
async function refresh(){
 const button=$('refresh');button.disabled=true;button.classList.add('loading');button.querySelector('span').textContent='正在查詢新聞來源…';
 try{const r=await fetch(`/api/refresh?hours=${$('range').value}`,{method:'POST',signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error();current=await r.json();render();toast(current.rateLimited?'一分鐘內已完成來源查詢，顯示最近結果':current.added?`已更新 ${current.added} 篇新聞重點`:`已重新查詢來源，${current.articles.length} 篇完整整理已保留`)}
 catch{toast('來源查詢暫時未完成，已保留現有報告。')}
 finally{button.disabled=false;button.classList.remove('loading');button.querySelector('span').textContent='獲取最新財經解析'}
}
function reportText(){
 const lines=['AI 財經新聞分析助手',`報告日期：${current.reportDate}`,''];
 for(const key of ['taiwan','us']){const m=current.markets[key];lines.push(m.label+'｜'+m.sessionDate,m.metrics.map(v=>`${v.label}：${v.value} ${v.change}`).join('\n'),m.summary,`來源：${m.url}`,'')}
 for(const name of ['經濟日報','工商時報']){lines.push(name,'');current.articles.filter(a=>a.source===name).forEach(a=>{lines.push(a.title,`發布：${time(a.publishedAt)}`,...a.points.map((p,i)=>`${i+1}. ${p.heading}\n${p.text}`),`來源：${a.url}`,'')})}
 return lines.join('\n\n');
}
$('refresh').addEventListener('click',refresh);
$('range').addEventListener('change',()=>{if(current)render()});
$('focus').addEventListener('change',()=>{if(current)render()});
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(reportText());toast('已複製完整報告，包含 4 篇新聞與來源');$('copy').querySelector('use').setAttribute('href','#i-check');setTimeout(()=>$('copy').querySelector('use').setAttribute('href','#i-copy'),2000)}catch{toast('瀏覽器未允許複製，請選取報告文字複製。')}});
load();
