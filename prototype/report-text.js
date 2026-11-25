import {cleanArticleText} from './article-clean.js';
import {freshArticles,eligibleArticle} from './news-policy.js';
const money=value=>Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const net=value=>value==null?'買賣超待公布':`${value<0?'賣超':value>0?'買超':'買賣超'}${money(Math.abs(value))}億元`;
export const plainTitle=title=>title.replace(/\s*(?:\||｜|-)\s*(?:經濟日報|工商時報).*$/,'').trim();
export const plainPoint=point=>cleanArticleText(typeof point==='string'?point:point.text).replace(/報導指出[，,：:]?\s*/g,'').replace(/(?:總經解讀|總經觀察|延伸觀察|原文數據|另見數據)：/g,'').trim();
export function articleText(article) {
 if(!eligibleArticle(article))return '';
 return [plainTitle(article.title),...article.points.slice(0,3).map((p,i)=>`${i+1}. ${plainPoint(p)}`)].join('\n\n');
}
export function marketLines(id,market) {
 if(id==='us')return [
  '主要指數表現：'+market.indices.map(m=>`${m.name}${m.changePct>0?'上漲':m.changePct<0?'下跌':'持平'}：${Math.abs(m.changePct).toFixed(2)}%`).join('；')+'。',
  '美股最新交易日走勢，'+market.summary
 ];
 const values=new Map((market.flow||[]).map(x=>[x.name,x.value]));
 return [
  `上市全日成交金額${money(market.turnoverBillions)}億元；三大法人合計${net(market.netFlowBillions)}。`,
  '觀察三大法人今天籌碼動向，'+['外資','自營商','投信'].map(name=>`${name}${net(values.get(name))}`).join('；')+'。',
  '台股最新交易日走勢，'+market.summary
 ];
}
export function marketText(id,market) {
 if(market.status==='unverified')return `${market.label}｜資料尚未核對完成，暫不提供留存數字供複製`;
 const warning=market.status==='unverified'?`\n${market.verificationError}`:'';
 return `${market.label}｜${market.sessionDate} 收盤${warning}\n\n`+marketLines(id,market).map(t=>'• '+t).join('\n\n');
}
export function reportText(report,articles=report.articles) {
 return [marketText('taiwan',report.markets.taiwan),marketText('us',report.markets.us),
  ...['經濟日報','工商時報'].flatMap(source=>{
   const selected=freshArticles(articles).filter(a=>a.source===source);
   return selected.length?[source,...selected.map(articleText)]:[];
  })].join('\n\n');
}

// Report and dashboard requests finish independently; use the latest actual
// market check consistently for both the visible cards and copied report.
export function latestMarkets(...sets){
 const usable=sets.filter(Boolean);if(!usable.length)return null;
 return Object.fromEntries(['taiwan','us'].map(key=>[key,usable.map(s=>s[key]).filter(Boolean).sort((a,b)=>(Date.parse(b.checkedAt)||0)-(Date.parse(a.checkedAt)||0))[0]]));
}
