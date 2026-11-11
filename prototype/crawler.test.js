import {cleanArticleText} from './article-clean.js';
import {plainPoint} from './report-text.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMacroBrief} from './summary.js';
import {updateSource,publisherLinks} from './server.js';
import {editorialPriority,eligibleArticle,isWithinNewsWindow,isFinanceNews,NEWS_WINDOW_MS} from './news-policy.js';

test('six-hour policy rejects expired, future and unverified articles',()=>{
 const now=Date.now();
 assert.equal(isWithinNewsWindow(new Date(now-NEWS_WINDOW_MS).toISOString(),now),true);
 assert.equal(isWithinNewsWindow(new Date(now-NEWS_WINDOW_MS-1).toISOString(),now),false);
 assert.equal(isWithinNewsWindow(new Date(now+1).toISOString(),now),false);
 assert.equal(eligibleArticle({title:'半導體產業合作',publishedAt:new Date(now).toISOString()},now),false);
 assert.equal(isFinanceNews('台積電工安意外工人身亡','半導體公司事故'),false);
 assert.equal(isFinanceNews('京華廣場聯貸案獲准展延'),true);
 assert.equal(publisherLinks('<a href="/news/20261021700405-430704">伺服器營收</a>',{key:'ctee',domain:'ctee.com.tw'})[0].url,'https://www.ctee.com.tw/news/20261021700405-430704');
});

test('publisher article discovery works when Google is rate limited',async()=>{
 const original=globalThis.fetch;const stamp=new Date(Date.now()-60000).toISOString();
 globalThis.fetch=async url=>{
  const u=String(url);
  if(u.includes('google.com'))return new Response('rate limited',{status:429});
  const title=u.includes('700405')?'伺服器產業公布營收':u.includes('700478')?'經濟成長與GDP展望':'銀行金融業務調整';
  return new Response(`<meta property="og:title" content="${title}"><meta property="article:published_time" content="${stamp}"><article>${paragraphs.map(p=>`<p>${p}</p>`).join('')}</article>`);
 };
 try{
  const r=await updateSource({key:'ctee',name:'工商時報',domain:'ctee.com.tw'});
  assert.equal(r.articles.length,3);
  assert.equal(r.stats.discoveryErrors,1);
  assert.equal(r.stats.fetchFailed,0);
  assert.ok(r.articles.every(a=>eligibleArticle(a)));
 }finally{globalThis.fetch=original;}
});

const paragraphs=[
 '半導體業者宣布啟動新產品合作計畫，雙方將結合工程團隊進行設計與測試，並依產品驗證結果規劃後續導入。',
 '合作範圍涵蓋產品開發及生產流程改善，目前尚未公布訂單金額。公司表示將持續與合作夥伴討論量產安排，實際進度仍以後續公告為準。',
 '相關產品將用於資料中心與伺服器，公司持續投入研發與工程資源。產業需求與客戶驗證進度將影響新產品出貨，現階段沒有揭露具體銷售目標。',
 '公司指出，產品品質與供應穩定是合作的重要條件，未來將持續追蹤驗證結果。後續發展需觀察實際導入情況，以及產品規格是否符合客戶要求。',
 '產業參與者認為，工程整合與合作分工有助於產品開發，但不同應用的需求仍有差異，需要依照客戶產品規畫持續調整。'
];
test('industry news without a predefined macro metric still gets three usable points',()=>{
 const brief=createMacroBrief('半導體產業宣布產品合作',paragraphs);
 assert.equal(brief.points.length,3);
 for(const p of brief.points)assert.ok([...p.text].length>0&&[...p.text].length<=300);
});

test('crawler fills three categories despite expired articles and blocked pages; reports failures',async()=>{
 const original=globalThis.fetch;const now=Date.now();
 const titles=['央行政策影響經濟','半導體產業宣布合作','銀行金融業務調整','央行舊聞','銀行未來新聞','金融受限新聞'];
 const links=titles.map((title,i)=>`<a href="https://money.udn.com/money/story/5607/${100+i}">${title}</a>`).join('');
 assert.equal(publisherLinks(links,{key:'udn',domain:'money.udn.com'}).length,6);
 globalThis.fetch=async url=>{
  const u=String(url);
  if(u.includes('news.google.com'))return new Response('<rss><channel/></rss>');
  if(u.includes('/rank/')||u.endsWith('/money/index'))return new Response(links);
  const i=Number(u.split('/').at(-1))-100;
  if(i===5)return new Response('blocked',{status:403});
  const stamp=new Date(i===3?now-NEWS_WINDOW_MS-10000:i===4?now+3600000:now-60000).toISOString();
  return new Response(`<meta property="og:title" content="${titles[i]}"><meta property="article:published_time" content="${stamp}"><section id="article_body">${paragraphs.map(p=>`<p>${p}</p>`).join('')}</section>`);
 };
 try{
  const r=await updateSource({key:'udn',name:'經濟日報',domain:'money.udn.com'});
  assert.equal(r.articles.length,3);
  assert.deepEqual(new Set(r.articles.map(a=>a.category)),new Set(['macro','industry','finance']));
  assert.equal(r.stats.outsideWindow,2);
  assert.equal(r.stats.fetchFailed,1);
  assert.equal(r.stats.summaryFailed,0);
  assert.ok(r.errors.some(e=>e.message.includes('403')));
  assert.ok(r.articles.every(a=>eligibleArticle(a)));
 }finally{globalThis.fetch=original;}
});


test('summary consists only of distinct sentences from its own source; no topic padding',()=>{
 const a=createMacroBrief('半導體產業宣布產品合作',paragraphs);
 const other=paragraphs.map(p=>p.replaceAll('公司','甲銀行').replaceAll('產品','金融服務').replaceAll('半導體','銀行'));
 const b=createMacroBrief('銀行金融業務調整',other);
 for(const [brief,source] of [[a,paragraphs],[b,other]]){
  const all=source.join('');
  const used=[];
  for(const point of brief.points){
   for(const sentence of point.text.match(/[^。！？]+[。！？]*/gu)){
    assert.ok(all.includes(sentence));assert.ok(!used.includes(sentence));used.push(sentence);
   }
   assert.equal(point.heading,'');
   assert.doesNotMatch(point.text,/報導指出|產業消息應先區分|新應用能否轉成長期收入|實際方向仍須/);
  }
 }
 assert.ok(a.points.every(p=>!b.points.some(q=>q.text===p.text)));
 assert.throws(()=>createMacroBrief('不足',['只有一句簡短內容，沒有其他新聞資訊可用。']));
});


test('editorial ranking prioritises macro and Taiwan business events over promotion and gossip',()=>{
 assert.ok(editorialPriority('央行公布利率決策')>editorialPriority('台積電營收創新高'));
 assert.ok(editorialPriority('台積電營收創新高')>editorialPriority('ETF高股息配息吸金'));
 assert.ok(editorialPriority('台積電營收創新高')>editorialPriority('黃仁勳婚外情公司涉貿易黑名單'));
});


test('publisher navigation is removed without deleting surrounding article facts',()=>{
 const junk='（閱讀全文： 讚啦! 台積電Q3配息9元 10月營收續寫新高 ）';
 const input='台積電公布季度財報。'+junk+'公司維持原定資本支出計畫。';
 const expected='台積電公布季度財報。公司維持原定資本支出計畫。';
 assert.equal(cleanArticleText(input),expected);
 assert.equal(plainPoint({text:input}),expected);
 assert.equal(cleanArticleText('閱讀全文：台積電Q3配息9元'), '');
 assert.equal(cleanArticleText('營收年增20%。延伸閱讀：其他公司新聞'), '營收年增20%。');
 assert.equal(cleanArticleText('營收年增20%。\n分享本文\n訂閱電子報'), '營收年增20%。');
});


test('three points balance available source facts to at least 150 characters when feasible',()=>{
 const source=Array.from({length:9},(_,i)=>`第${i+1}項公司營運資訊：`+'本季合併營收與海外客戶訂單數據依公司公告列示，董事會已確認投資時程，後續出貨維持原定計畫。');
 const result=createMacroBrief('公司營收與訂單',source);
 assert.equal(result.points.length,3);
 for(const point of result.points){assert.ok([...point.text].length>=150);assert.ok([...point.text].length<=300);}
 assert.equal(result.points.map(p=>p.text).join(''),source.join(''));
});
