export const NEWS_HOURS=6;
export const NEWS_WINDOW_MS=NEWS_HOURS*60*60*1000;
const finance=/財經|金融|經濟|央行|通膨|物價|利率|匯率|GDP|IMF|PPI|CPI|公債|美債|殖利率|聯準會|Fed\b|升息|降息|貨幣|財政|貿易|出口|進口|景氣|失業|就業|股市|台股|美股|證券|銀行|資本市場/i;
export function isWithinNewsWindow(publishedAt,now=Date.now()) {
 const stamp=Date.parse(publishedAt);
 // Missing/ambiguous dates and future dates are never usable as publication evidence.
 return typeof publishedAt==='string'&&/(?:Z|[+-]\d\d:\d\d|GMT|UTC)$/i.test(publishedAt)&&Number.isFinite(stamp)&&stamp<=now&&now-stamp<=NEWS_WINDOW_MS;
}
export function isFinanceNews(title,body=''){return finance.test(title+' '+body);}
export function eligibleArticle(article,now=Date.now()) {
 return article.publicationVerified===true&&isWithinNewsWindow(article.publishedAt,now)&&isFinanceNews(article.originalTitle||article.title,article.financeEvidence||'');
}
export function freshArticles(articles=[],now=Date.now()) {return articles.filter(a=>eligibleArticle(a,now));}
export function enforceNewsWindow(report,now=Date.now()) {
 const articles=freshArticles(report.articles,now);
 return {...report,articles,candidates:[],newsWindowHours:NEWS_HOURS,windowStart:new Date(now-NEWS_WINDOW_MS).toISOString(),windowEnd:new Date(now).toISOString(),
  sourceCounts:{udn:articles.filter(a=>a.sourceKey==='udn').length,ctee:articles.filter(a=>a.sourceKey==='ctee').length}};
}
