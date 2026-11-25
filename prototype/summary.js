import {plainPoint} from './report-text.js';
import {cleanArticleText} from './article-clean.js';
// Source-only extractive summarisation. No category prose, invented analysis or
// padding. Keep complete original sentences so names, numbers and attribution
// remain auditable against this article rather than a topic-level template.
export const SUMMARY_VERSION='source-only-v6-clean';
function matchTopic(text) {
 if(/半導體|晶片|台積電|輝達|機器人|伺服器|擴廠|擴產|光通訊/.test(text))return '產業動態';
 if(/匯率|匯市|新台幣|台幣|人民幣|日圓/.test(text))return '匯率與資金';
 if(/通膨|PPI|CPI|物價/.test(text))return '通膨與利率';
 if(/GDP|經濟成長|經濟預測/.test(text))return '經濟成長';
 if(/IMF|全球景氣|全球經濟/.test(text))return '全球景氣';
 return '貨幣與貿易';
}
export function topicFor(title,body=''){return matchTopic(title+' '+body);}
const length=s=>[...s.replace(/\s/gu,'')].length;
export function createMacroBrief(title,paragraphs) {
 // Paragraph boundaries carry discourse context. Never flatten the article
 // into sentences and cut it into three equal-sized pieces.
 const blocks=paragraphs.map(p=>plainPoint(cleanArticleText(p))).filter(Boolean);
 const dependent=/^(?:[「「“]?)(?:此外|不過|但是|然而|因此|所以|其中|這(?:項|個|些|次|也|將|是)|此(?:外|項|案|次|舉)|他|她|它|該(?:公司|行|案|項)|也|而(?:且|這|他|其)|同時|另外|至於|對此|上述|前述)/u;
 const terms=[...new Set(title.match(/[A-Za-z]{2,}|[\p{Script=Han}]{2}/gu)||[])];
 const candidates=[];
 for(let start=0;start<blocks.length;start++){
  if(dependent.test(blocks[start]))continue;
  let text='';
  for(let end=start;end<Math.min(blocks.length,start+8);end++){
   text+=blocks[end];
   if(length(text)>300)break;
   if(length(text)<150||/[，、；：,;:]$/.test(text))continue;
   candidates.push({start,end,text,score:terms.filter(t=>text.includes(t)).length*3+(start===0?8:0)+(end===start?5:0)-Math.abs(length(text)-190)/30});
  }
 }
 // Bound combination search on unusually long publisher pages.
 candidates.sort((a,b)=>b.score-a.score).splice(60);
 candidates.sort((a,b)=>a.start-b.start||a.end-b.end);
 const sameFact=(a,b)=>{
  if(a.end>=b.start)return true;
  const aa=new Set(a.text.match(/[^。！？]+[。！？]*/gu)||[]);
  return (b.text.match(/[^。！？]+[。！？]*/gu)||[]).some(s=>aa.has(s));
 };
 // Pick independent, non-overlapping paragraph groups. A third point is
 // optional; do not divide an otherwise complete second point to manufacture it.
 let best=null;
 for(let a=0;a<candidates.length;a++)for(let b=a+1;b<candidates.length;b++){
  const x=candidates[a],y=candidates[b];if(sameFact(x,y))continue;
  const pair=[x,y];const pairScore=x.score+y.score;
  if(!best||best.items.length<2||best.items.length===2&&pairScore>best.score)best={items:pair,score:pairScore};
  for(let c=b+1;c<candidates.length;c++){
   const z=candidates[c];if(sameFact(x,z)||sameFact(y,z))continue;
   const score=pairScore+z.score;
   if(best.items.length<3||score>best.score)best={items:[x,y,z],score};
  }
 }
 if(!best)throw new Error('原文不足兩個獨立且各至少150字的重點，改選其他新聞');
 const points=best.items.map(item=>({heading:'',text:item.text}));
 return {points,topic:topicFor(title,paragraphs.join(' ')),mode:'原文重點摘錄',summaryVersion:SUMMARY_VERSION,preparedAt:new Date().toISOString()};
}
