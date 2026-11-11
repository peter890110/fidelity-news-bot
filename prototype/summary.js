import {cleanArticleText} from './article-clean.js';
// Source-only extractive summarisation. No category prose, invented analysis or
// padding. Keep complete original sentences so names, numbers and attribution
// remain auditable against this article rather than a topic-level template.
export const SUMMARY_VERSION='source-only-v3';
function matchTopic(text) {
 if(/半導體|晶片|台積電|輝達|機器人|伺服器|擴廠|擴產|光通訊/.test(text))return '產業動態';
 if(/匯率|匯市|新台幣|台幣|人民幣|日圓/.test(text))return '匯率與資金';
 if(/通膨|PPI|CPI|物價/.test(text))return '通膨與利率';
 if(/GDP|經濟成長|經濟預測/.test(text))return '經濟成長';
 if(/IMF|全球景氣|全球經濟/.test(text))return '全球景氣';
 return '貨幣與貿易';
}
export function topicFor(title,body=''){return matchTopic(title+' '+body);}
const length=s=>[...s].length;
export function createMacroBrief(title,paragraphs) {
 const seen=new Set();
 let sentences=paragraphs.flatMap(p=>cleanArticleText(p).match(/[^。！？]+[。！？]*/gu)||[])
  .map(s=>s.trim()).filter(s=>{
   if(length(s)<12||/訂閱|延伸閱讀|廣告|推薦閱讀|看更多|立即加入|版權所有/.test(s)||seen.has(s))return false;
   seen.add(s);return true;
  });
 // For long articles, prefer title-related facts and numerical disclosures
 // across the full body, then restore source order for coherent attribution.
 if(sentences.reduce((n,s)=>n+length(s),0)>650){
  const terms=[...new Set((title.match(/[\p{Script=Han}]{2,}|[A-Za-z]{2,}/gu)||[]).flatMap(t=>t.length>4?[...t].slice(0,-1).map((_,i)=>t.slice(i,i+2)):[t]))];
  const ranked=sentences.map((s,index)=>({s,index,score:(index===0?12:0)+terms.filter(t=>s.includes(t)).length*2+(/\d/.test(s)?3:0)+(/表示|指出|預估|預計|宣布|營收|獲利|成長|年增|年減|訂單|利率|通膨/.test(s)?2:0)})).filter(x=>length(x.s)<=300).sort((a,b)=>b.score-a.score||a.index-b.index);
  const chosen=[];let size=0;
  for(const row of ranked)if(size+length(row.s)<=650){chosen.push(row);size+=length(row.s);}
  sentences=chosen.sort((a,b)=>a.index-b.index).map(x=>x.s);
 }
 if(sentences.length<3)throw new Error('原文有效資訊不足三點，不產生填充摘要');
 // Choose three consecutive groups together, rather than greedily consuming
 // text in points one and two and leaving a short final point. Never pad.
 const sums=[0];for(const sentence of sentences)sums.push(sums.at(-1)+length(sentence));
 const cost=n=>Math.max(0,150-n)**2*100+(n-180)**2;
 let best=null;
 for(let a=1;a<sentences.length-1;a++)for(let b=a+1;b<sentences.length;b++){
  const sizes=[sums[a],sums[b]-sums[a],sums.at(-1)-sums[b]];
  if(sizes.some(n=>n>300))continue;
  const value=sizes.reduce((n,size)=>n+cost(size),0);
  if(!best||value<best.value)best={a,b,value};
 }
 if(!best)throw new Error('原文句子無法在三點各300字內完整呈現');
 const points=[sentences.slice(0,best.a),sentences.slice(best.a,best.b),sentences.slice(best.b)]
  .map(group=>({heading:'',text:group.join('')}));
 return {points,topic:topicFor(title,paragraphs.join(' ')),mode:'原文重點摘錄',summaryVersion:SUMMARY_VERSION,preparedAt:new Date().toISOString()};
}
