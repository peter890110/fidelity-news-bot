// Shared by article extraction, summarisation, display and clipboard output.
const marker='(?:閱讀全文|全文閱讀|延伸閱讀|推薦閱讀|相關閱讀|相關新聞|推薦文章|更多新聞|看更多)';
export function cleanArticleText(value=''){
 let text=String(value);
 // Remove the whole navigation bracket, including its linked article title.
 text=text.replace(new RegExp('[（(【\\[]\\s*'+marker+'[\\s\\S]*?[）)】\\]]','gu'),'');
 // Unbracketed recommendations occupy their own line or trail the article.
 text=text.split(/\r?\n/).map(line=>line.replace(new RegExp('(?:^|(?<=[。！？])\\s*|\\s+[►▶》→])'+marker+'[\\s\\S]*$','u'),''))
  .filter(line=>!/^\s*(?:分享(?:本文|文章)?|訂閱(?:電子報|新聞)?|加入(?:LINE|會員)|追蹤我們|立即訂閱|廣告)\s*[：:｜|]?/i.test(line)).join('\n');
 return text.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
