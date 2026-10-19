export const NEWS_HOURS=6;
export const ARTICLES_PER_SOURCE=3;
export const NEWS_WINDOW_MS=NEWS_HOURS*60*60*1000;
const macro=/總經|經濟|央行|通膨|物價|利率|GDP|IMF|PPI|CPI|聯準會|Fed\b|升息|降息|財政|貿易|出口|進口|景氣|失業|就業|關稅|原油|油價/i;
const finance=/財經|金融|匯率|匯市|台幣|貨幣|公債|美債|殖利率|股市|台股|美股|證券|銀行|金控|資本市場|櫃買|IPO|ETF|基金|投信|融資|籌資/i;
const industry=/產業|半導體|晶片|台積電|聯發科|輝達|電機|HBM|記憶體|伺服器|資料中心|光通訊|供應鏈|車用|汽車|電動車|鴻海|研華|群光|金居|產能|擴產|擴廠|封裝|PCB|載板|銅箔|HVLP|鋼鐵|製鐵|航運|運價|SCFI|機器人|營收|財報|獲利|資本支出|資安|工業運算/i;
export function categoryFor(title,body='') {
 if(macro.test(title))return 'macro';
 if(finance.test(title))return 'finance';
 if(industry.test(title))return 'industry';
 if(macro.test(body))return 'macro';
 return industry.test(body)?'industry':'finance';
}
export function isWithinNewsWindow(publishedAt,now=Date.now()) {
 const stamp=Date.parse(publishedAt);
 // Missing/ambiguous dates and future dates are never usable as publication evidence.
 return typeof publishedAt==='string'&&/(?:Z|[+-]\d\d:\d\d|GMT|UTC)$/i.test(publishedAt)&&Number.isFinite(stamp)&&stamp<=now&&now-stamp<=NEWS_WINDOW_MS;
}
export function isFinanceNews(title,body=''){const text=title+' '+body;return macro.test(text)||finance.test(text)||industry.test(text);}
export function eligibleArticle(article,now=Date.now()) {
 return article.publicationVerified===true&&isWithinNewsWindow(article.publishedAt,now)&&isFinanceNews(article.originalTitle||article.title,article.financeEvidence||'');
}
export function freshArticles(articles=[],now=Date.now()) {return articles.filter(a=>eligibleArticle(a,now));}
export function enforceNewsWindow(report,now=Date.now()) {
 const articles=['udn','ctee'].flatMap(key=>freshArticles(report.articles,now).filter(a=>a.sourceKey===key).slice(0,ARTICLES_PER_SOURCE));
 return {...report,articles,candidates:[],newsWindowHours:NEWS_HOURS,windowStart:new Date(now-NEWS_WINDOW_MS).toISOString(),windowEnd:new Date(now).toISOString(),
  sourceCounts:{udn:articles.filter(a=>a.sourceKey==='udn').length,ctee:articles.filter(a=>a.sourceKey==='ctee').length}};
}
