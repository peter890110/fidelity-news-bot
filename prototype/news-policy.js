export const NEWS_HOURS=6;
export const ARTICLES_PER_SOURCE=3;
export const NEWS_WINDOW_MS=NEWS_HOURS*60*60*1000;
const macro=/總經|經濟|央行|通膨|物價|利率|GDP|IMF|PPI|CPI|聯準會|Fed\b|升息|降息|財政|貿易|出口|進口|景氣|失業|就業|關稅|原油|油價/i;
const finance=/財經|金融|匯率|匯市|台幣|貨幣|公債|美債|債券|殖利率|股市|台股|美股|證券|銀行|金控|資本市場|櫃買|興櫃|IPO|ETF|基金|投信|融資|籌資|聯貸|授信|放款|貸款/i;
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
export function isFinanceNews(title,body=''){
 if(/工安|身亡|墜落|車禍|凶殺|命案/.test(title)&&!/營收|財報|停工|停產|產能|供應|損失|成本|影響/.test(title))return false;
 const text=title+' '+body;return macro.test(text)||finance.test(text)||industry.test(text);
}
export function eligibleArticle(article,now=Date.now()) {
 return article.publicationVerified===true&&isWithinNewsWindow(article.publishedAt,now)&&isFinanceNews(article.originalTitle||article.title,article.financeEvidence||'');
}
export function freshArticles(articles=[],now=Date.now()) {return articles.filter(a=>eligibleArticle(a,now));}
export function enforceNewsWindow(report,now=Date.now()) {
 const articles=['udn','ctee'].flatMap(key=>freshArticles(report.articles,now).filter(a=>a.sourceKey===key).slice(0,ARTICLES_PER_SOURCE));
 return {...report,articles,candidates:[],newsWindowHours:NEWS_HOURS,windowStart:new Date(now-NEWS_WINDOW_MS).toISOString(),windowEnd:new Date(now).toISOString(),
  sourceCounts:{udn:articles.filter(a=>a.sourceKey==='udn').length,ctee:articles.filter(a=>a.sourceKey==='ctee').length}};
}

// Editorial priority, not a claim about company size or index membership.
const taiwanCompanies=/台積電|聯發科|鴻海|廣達|緯創|緯穎|台達電|日月光|聯電|聯詠|瑞昱|南亞科|華邦電|群聯|欣興|南電|景碩|台光電|台燿|聯茂|奇鋐|雙鴻|智邦|中華電|中鋼|台塑|南亞|長榮|陽明|萬海|國泰金|富邦金|中信金|玉山金|兆豐金|台新新光金|統一|台泥|和碩|仁寶|華碩|宏碁/;
const macroFocus=/總經|經濟成長|GDP|央行|聯準會|Fed\b|通膨|CPI|PPI|利率|升息|降息|關稅|貿易|出口|進口|景氣|失業率|就業數據|就業市場|非農|財政|匯率|匯市|新台幣|台幣|公債|美債|殖利率|油價|原油|PMI/i;
const businessEvent=/營收|財報|獲利|盈餘|EPS|訂單|資本支出|投資|擴廠|擴產|產能|量產|併購|收購|法說|供應鏈|出貨/i;
export function editorialPriority(title,body=''){
 // Title is the primary evidence: incidental macro words in promotional copy
 // must not lift a product pitch above an actual economic release.
 if(/婚外情|緋聞|八卦|私生活|中共.*代表|競賽.*獎/.test(title))return -100;
 if(/配置價值|配置契機|雙重契機|收益契機|投資首選/.test(title))return -30;
 if(/高股息|高填息|配息|填息|買進名單|飆股|存股|申購|募集|抽獎/.test(title)&&/ETF|基金|投信|\d{4,6}/.test(title))return -30;
 if(macroFocus.test(title))return 100;
 if(taiwanCompanies.test(title)&&businessEvent.test(title+' '+body))return 70;
 if(/產業|半導體|供應鏈|伺服器|記憶體|航運|金融/.test(title)&&businessEvent.test(title))return 40;
 return 0;
}
