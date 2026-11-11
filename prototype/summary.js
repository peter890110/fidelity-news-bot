import {cleanArticleText} from './article-clean.js';
// Source-only extractive summarisation. No category prose, invented analysis or
// padding. Keep complete original sentences so names, numbers and attribution
// remain auditable against this article rather than a topic-level template.
export const SUMMARY_VERSION='source-only-v2';
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
 if(sentences.reduce((n,s)=>n+length(s),0)>850){
  const terms=[...new Set((title.match(/[\p{Script=Han}]{2,}|[A-Za-z]{2,}/gu)||[]).flatMap(t=>t.length>4?[...t].slice(0,-1).map((_,i)=>t.slice(i,i+2)):[t]))];
  const ranked=sentences.map((s,index)=>({s,index,score:(index===0?12:0)+terms.filter(t=>s.includes(t)).length*2+(/\d/.test(s)?3:0)+(/表示|指出|預估|預計|宣布|營收|獲利|成長|年增|年減|訂單|利率|通膨/.test(s)?2:0)})).filter(x=>length(x.s)<=300).sort((a,b)=>b.score-a.score||a.index-b.index);
  const chosen=[];let size=0;
  for(const row of ranked)if(size+length(row.s)<=850){chosen.push(row);size+=length(row.s);}
  sentences=chosen.sort((a,b)=>a.index-b.index).map(x=>x.s);
 }
 if(sentences.length<3)throw new Error('原文有效資訊不足三點，不產生填充摘要');
 // Each point starts with the next unused sentence. Target 200–300 characters
 // only when the source supports it; reserve at least one sentence per point.
 const points=[];let cursor=0;
 for(let i=0;i<3;i++){
  let text='';
  while(cursor<sentences.length-(2-i)){
   const next=sentences[cursor];
   if(length(text+next)>300)break;
   text+=next;cursor++;
   if(length(text)>=200)break;
   // Distribute short sources across all three points, without duplicating text.
   const remaining=sentences.slice(cursor).reduce((n,s)=>n+length(s),0);
   if(length(text)>=remaining/(2-i||1))break;
  }
  if(!text)throw new Error('原文句子無法在三點各300字內完整呈現');
  points.push({heading:'',text});
 }
 return {points,topic:topicFor(title,paragraphs.join(' ')),mode:'原文重點摘錄',summaryVersion:SUMMARY_VERSION,preparedAt:new Date().toISOString()};
}
