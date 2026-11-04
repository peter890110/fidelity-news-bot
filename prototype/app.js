import {NEWS_WINDOW_MS,ARTICLES_PER_SOURCE,freshArticles} from './news-policy.js';
import {plainTitle,plainPoint,articleText,marketLines,marketText,reportText} from './report-text.js';
const $ = id => document.getElementById(id);
const time = value => new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
let current;
let dashboardData;
let dashboardError=false;
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
const number = (value,digits=2) => typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
const signed = (value,suffix='') => typeof value==='number'&&Number.isFinite(value)?`${value>0?'+':''}${number(value)}${suffix}`:'待公布';
function sparkline(history){
 const values=(history||[]).map(x=>x.value).filter(Number.isFinite);if(values.length<2)return null;
 const lo=Math.min(...values),hi=Math.max(...values),range=hi-lo||1;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 240 52');svg.setAttribute('class','sparkline');svg.setAttribute('role','img');svg.setAttribute('aria-label',`最近${values.length}筆數值走勢，最低${number(lo,4)}，最高${number(hi,4)}`);
 const line=document.createElementNS(svg.namespaceURI,'polyline');line.setAttribute('points',values.map((v,i)=>`${i/(values.length-1)*236+2},${48-(v-lo)/range*44}`).join(' '));line.setAttribute('class',values.at(-1)>=values[0]?'spark-up':'spark-down');svg.append(line);return svg;
}
function marketState(m){return m.status==='verified'?'已核對收盤':'留存資料・待核對';}
function dataCard({label,value,delta,date,unit='',note='',history,sourceUrl,error=false}){
 const card=el('article',`data-card${error?' data-error':''}`);card.append(el('h4','',label),el('strong','data-value',value));
 if(delta!==undefined)card.append(el('p',`data-change ${typeof delta==='number'?(delta<0?'down':delta>0?'up':''):''}`,typeof delta==='number'?signed(delta,'%'):delta));
 const spark=sparkline(history);if(spark)card.append(spark);
 card.append(el('p','data-date',[date,unit].filter(Boolean).join(' · ')));if(note)card.append(el('p','data-note',note));
 if(sourceUrl){const a=el('a','data-source','資料來源');a.href=sourceUrl;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}return card;
}
function renderDashboard(){
 const root=$('dashboard-content');const markets=current?.markets||dashboardData?.markets;if(!root||!markets)return;root.replaceChildren();const tw=markets.taiwan,us=markets.us;
 const section=(title,detail,cls='')=>{const s=el('section','data-section '+cls);s.append(el('h3','',title),el('p','data-section-note',detail));const grid=el('div','data-grid');s.append(grid);root.append(s);return grid;};
 const flowReady=tw.flowPublished!==false&&(!tw.flowDate||tw.flowDate===tw.sessionDate);
 const grid=section('台股市場',`${tw.sessionDate} 收盤 · ${marketState(tw)} · 紅漲綠跌`);
 grid.append(dataCard({label:'加權指數',value:number(tw.close),delta:tw.changePct,date:tw.sessionDate,unit:'點',note:`日漲跌 ${signed(tw.change)} 點`,sourceUrl:tw.url}));
 const otc=dashboardData?.macro?.find(x=>x.id==='otc');grid.append(dataCard({label:'櫃買指數',value:otc?.status==='ok'?number(otc.value):'—',delta:otc?.status==='ok'?otc.changePct:undefined,date:otc?.date,unit:'點',note:otc?.status==='error'?'來源讀取未完成':!otc?'查詢中…':'櫃買市場',history:otc?.history,sourceUrl:otc?.sourceUrl}));
 grid.append(dataCard({label:'成交金額（上市）',value:number(tw.turnoverBillions)+' 億',date:tw.sessionDate,unit:'新臺幣',note:marketState(tw),sourceUrl:tw.url}));
 const breadth=dashboardData?.breadth;grid.append(dataCard({label:'上漲／下跌家數（上市股票）',value:breadth?.status==='ok'?`${breadth.advancers}／${breadth.decliners}`:'—',date:breadth?.date,note:breadth?.status==='ok'?`持平 ${breadth.unchanged} 家`:'資料查詢中或未完成',sourceUrl:breadth?.sourceUrl}));
 for(const [name,label]of [['外資','外資買賣超（上市）'],['合計','三大法人合計（上市）']]){const v=flowReady?(name==='合計'?tw.netFlowBillions:(tw.flow||[]).find(f=>f.name===name)?.value):null;grid.append(dataCard({label,value:Number.isFinite(v)?signed(v)+' 億':'待公布',date:tw.flowDate||tw.sessionDate,unit:'新臺幣',note:Number.isFinite(v)?`${v<0?'賣超':v>0?'買超':'買賣平衡'} · ${marketState(tw)}`:'法人資料待公布',sourceUrl:tw.sources?.find(x=>x.label.includes('法人'))?.url}));}
 const ug=section('美股四大指數',`${us.sessionDate} 收盤（美東） · ${marketState(us)}`,'us-cards');
 for(const i of us.indices||[])ug.append(dataCard({label:i.name,value:number(i.close),delta:i.changePct,date:us.sessionDate,unit:'點',sourceUrl:us.sources?.find(x=>x.label===i.name)?.url}));
 const mg=section('全球總經市場','匯率、殖利率與商品期貨 · 已完成日線（UTC日期），各卡日期可能不同');
 if(dashboardData){for(const m of dashboardData.macro.filter(x=>x.id!=='otc'))mg.append(dataCard({label:m.name,value:m.status==='ok'?number(m.value,m.yield?3:2):'—',delta:m.status==='ok'?(m.yield?`${signed(m.change*100)} bps`:m.changePct):undefined,date:m.date,unit:m.unit,note:m.status==='error'?'來源讀取未完成':m.yield?'日變動以基點表示':'',history:m.history,sourceUrl:m.sourceUrl,error:m.status==='error'}));}else mg.append(el('p','chart-empty',dashboardError?'市場來源暫時讀取未完成，請重新更新。':'正在查詢匯率、利率與商品資料…'));
 const fg=section('富達基金淨值','日漲跌以本次與前一次公布淨值比較，非即時價格或含息總報酬。','fund-section');
 if(dashboardData){for(const f of dashboardData.funds){const card=dataCard({label:f.name,value:f.status==='ok'?number(f.nav,4):'—',date:f.date,unit:f.currency==='TWD'?'新臺幣':'美元',note:f.shareClass,history:f.history,sourceUrl:f.sourceUrl,error:f.status==='error'});
  const line=el('p',`fund-daily data-change ${f.change<0?'down':f.change>0?'up':''}`,f.status==='ok'?`日漲跌 ${f.change>0?'+':''}${number(f.change,4)}（${signed(f.changePct,'%')}）`:'淨值來源讀取未完成');card.insertBefore(line,card.querySelector('.data-date'));if(f.previousDate)card.append(el('p','data-note',`比較基準 ${f.previousDate}`));if(f.risk)card.append(el('p','fund-risk',f.risk));fg.append(card);}}else fg.append(el('p','chart-empty',dashboardError?'基金淨值來源暫時讀取未完成，請重新更新。':'正在核對五檔基金的級別與最新淨值…'));
 $('email-export').disabled=!dashboardData;
 $('email-copy').disabled=!dashboardData;
 root.append(el('p','dashboard-footnote',`市場資料依各卡標示範圍，上市與上櫃不混加。迷你線圖為最多30筆實際日資料，非10年百分位。${dashboardData?'淨值與總經查詢時間 '+time(dashboardData.checkedAt)+'（台北）':''}`));
}
async function loadDashboard(){try{const r=await fetch('/api/dashboard',{cache:'no-store',signal:AbortSignal.timeout(40000)});if(!r.ok)throw Error();dashboardData=await r.json();dashboardError=false;}catch{dashboardError=true;}renderDashboard();}
function render(){
 const filtered=filteredArticles();
 renderDashboard();
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
 if(all.length){const next=Math.min(...all.map(a=>Date.parse(a.publishedAt)+NEWS_WINDOW_MS+1));expiryTimer=setTimeout(render,Math.max(1,Math.min(60000,next-Date.now())));}
 $('copy').disabled=false;
}
async function load(){try{const r=await fetch('/api/report',{cache:'no-store',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error();current=await r.json();render()}catch{$('updated').textContent='報告載入未完成，請按上方按鈕重試。'}}
async function refresh(){
 loadDashboard();
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
loadDashboard();

function makeEmailImage(sections,title){
 const width=800,rowHeight=138,rows=sections.reduce((n,s)=>n+Math.ceil(s.cards.length/2),0),height=100+sections.length*50+rows*rowHeight+60;
 const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
 const write=(str,x,y,size=14,color='#18334e',bold=false)=>{ctx.fillStyle=color;ctx.font=`${bold?'600':'400'} ${size}px "PingFang TC","Microsoft JhengHei",Arial,sans-serif`;ctx.fillText(str,x,y);};
 write(title,24,38,25,'#102b46',true);write('資料快照 '+time(new Date().toISOString())+'（台北時間）',24,65,12,'#64748b');let y=92;
 for(const section of sections){write(section.title,24,y+21,18,'#0067a5',true);y+=44;
  section.cards.forEach((card,i)=>{const x=24+(i%2)*384,top=y+Math.floor(i/2)*rowHeight;ctx.strokeStyle='#dbe3ec';ctx.lineWidth=1;ctx.strokeRect(x,top,368,rowHeight-12);
   write(card.label,x+12,top+24,13,'#3b5067');write(card.value,x+12,top+57,26,'#102b46',true);
   if(card.points){const points=card.points.split(' ').map(p=>p.split(',').map(Number));ctx.strokeStyle=points.at(-1)[1]<=points[0][1]?'#c54354':'#168362';ctx.lineWidth=1.5;ctx.beginPath();points.forEach(([px,py],j)=>{const xx=x+240+px/240*110,yy=top+39+py/52*29;j?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.stroke();}
   const change=card.change;write(change,x+12,top+82,13,change.includes('-')?'#168362':change.includes('+')?'#c54354':'#52677b');write(card.date,x+12,top+103,11,'#52677b');
   if(card.share)write(card.share,x+12,top+119,10,'#52677b');
  });y+=Math.ceil(section.cards.length/2)*rowHeight;
 }
 write('日漲跌以各卡資料日期為準，非即時行情。基金日漲跌非含息總報酬。',24,height-32,11,'#64748b');
 if(title.includes('基金'))write('全球優質債券基金有相當比重投資於非投資等級之高風險債券。',24,height-15,10,'#64748b');
 return canvas;
}
function showEmailExport(){
 const sections=emailSections();
 const target=$('email-images');target.replaceChildren();
 for(const [title,items,filename]of [['市場與總經數據',sections.slice(0,3),'market-dashboard'],['富達基金淨值',sections.slice(3),'fidelity-funds']]){
  const canvas=makeEmailImage(items,title),url=canvas.toDataURL('image/png'),block=el('section','email-image');block.append(el('h3','',title));const link=el('a','secondary','下載 PNG 圖片');link.href=url;link.download=`${filename}-${new Date().toISOString().slice(0,10)}.png`;block.append(link);const img=el('img');img.src=url;img.alt=title+'郵件用快照';block.append(img);target.append(block);
 }
 $('email-dialog').showModal();
}
$('email-export').addEventListener('click',showEmailExport);
$('email-close').addEventListener('click',()=>$('email-dialog').close());

function emailSections(){return [...document.querySelectorAll('#dashboard-content .data-section')].map(s=>({title:s.querySelector('h3').textContent,cards:[...s.querySelectorAll('.data-card')].map(c=>({label:c.querySelector('h4').textContent,value:c.querySelector('.data-value').textContent,change:c.querySelector('.data-change')?.textContent||c.querySelector('.data-note')?.textContent||'',date:c.querySelector('.data-date').textContent,share:c.querySelector('.fund-daily')?c.querySelector('.data-note')?.textContent:'',points:c.querySelector('.sparkline polyline')?.getAttribute('points')}))}));}
async function copyEmailDashboard(){
 const buttons=[$('email-copy'),$('email-copy-dialog')];buttons.forEach(b=>{b.disabled=true;b.textContent='正在複製…';});
 try{
  const canvas=makeEmailImage(emailSections(),'市場總經與富達基金快照');
  if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('clipboard-unavailable');
  const blob=new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('image-failed')),'image/png'));
  await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
  toast('已複製全部圖表，請到 Outlook 內文按 ⌘V／Ctrl+V 貼上');
 }catch{toast('瀏覽器未允許圖片複製。請允許剪貼簿權限後重試，或使用郵件版預覽。');}
 finally{buttons.forEach(b=>{b.disabled=false;b.textContent='一鍵複製全部圖表';});}
}
$('email-copy').addEventListener('click',copyEmailDashboard);
$('email-copy-dialog').addEventListener('click',copyEmailDashboard);
