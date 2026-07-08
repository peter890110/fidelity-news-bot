import os
import re
import json
import base64
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
import concurrent.futures
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
from googlenewsdecoder import gnewsdecoder

# Load env variables if .env exists
load_dotenv()

app = Flask(__name__, template_folder='templates')

# Feed URLs
FEEDS = {
    "economic_daily": {
        "name": "經濟日報",
        "url": "https://news.google.com/rss/search?q=site:money.udn.com&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    },
    "commercial_times": {
        "name": "工商時報",
        "url": "https://news.google.com/rss/search?q=site:ctee.com.tw&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    },
    "global_market": {
        "name": "國際與美股財經",
        "url": "https://news.google.com/rss/search?q=fed+OR+semiconductor+OR+nvidia+OR+earnings+OR+macro+market&hl=zh-TW&gl=TW&ceid=TW:zh-Hant"
    }
}

def decode_google_news_url(url):
    """Attempt to decode base64 encoded Google News URL to actual publisher URL."""
    try:
        if "news.google.com/rss/articles/" in url:
            decoded = gnewsdecoder(url)
            if decoded.get("status"):
                return decoded["decoded_url"]
    except Exception:
        pass
    return url

def parse_pub_date(date_str):
    """Parse Google News RSS pubDate string into a timezone-naive UTC datetime object."""
    if not date_str:
        return None
    # Example format: "Fri, 03 Jul 2026 17:35:44 GMT"
    # Try parsing GMT
    for fmt in ("%a, %d %b %Y %H:%M:%S GMT", "%a, %d %b %Y %H:%M:%S %Z", "%a, %d %b %Y %H:%M:%S %z"):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    # Fallback to general parsing if possible
    try:
        # Simple slicing for standard RSS dates if formats mismatch slightly
        clean_str = date_str.split('+')[0].strip()
        return datetime.strptime(clean_str, "%a, %d %b %Y %H:%M:%S")
    except Exception:
        return None

def fetch_feed_articles(feed_key, feed_info):
    """Fetch and parse a single Google News RSS feed."""
    articles = []
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    try:
        response = requests.get(feed_info["url"], headers=headers, timeout=10)
        if response.status_code != 200:
            print(f"Error fetching {feed_info['name']}: HTTP {response.status_code}")
            return articles
        
        # Parse XML
        root = ET.fromstring(response.content)
        channel = root.find('channel')
        if channel is None:
            return articles
            
        for item in channel.findall('item'):
            title_elem = item.find('title')
            link_elem = item.find('link')
            pub_date_elem = item.find('pubDate')
            source_elem = item.find('source')
            
            title = title_elem.text if title_elem is not None else ""
            link = link_elem.text if link_elem is not None else ""
            pub_date_str = pub_date_elem.text if pub_date_elem is not None else ""
            source = source_elem.text if source_elem is not None else feed_info["name"]
            
            pub_date = parse_pub_date(pub_date_str)
            
            articles.append({
                "title": title,
                "link": link,
                "pub_date_str": pub_date_str,
                "pub_date": pub_date,
                "source": source,
                "feed_source": feed_info["name"],
                "feed_key": feed_key
            })
    except Exception as e:
        print(f"Error fetching/parsing feed {feed_info['name']}: {e}")
    return articles

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/news', methods=['POST'])
def get_news():
    data = request.json or {}
    api_key = data.get('api_key') or os.environ.get('GEMINI_API_KEY')
    model = data.get('model') or 'gemini-1.5-flash'
    timeframe_hours = int(data.get('hours', 24))
    
    if not api_key:
        return jsonify({"error": "請提供 Gemini API Key。您可以在設定中填寫，或在伺服器端環境變數中設定 GEMINI_API_KEY。"}), 400
        
    print(f"Fetching feeds... (Timeframe filter: {timeframe_hours} hours)")
    
    # Fetch feeds in parallel
    all_articles = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(fetch_feed_articles, key, info): key for key, info in FEEDS.items()}
        for future in concurrent.futures.as_completed(futures):
            all_articles.extend(future.result())
            
    print(f"Total articles fetched: {len(all_articles)}")
    
    # Filter articles by time limit (e.g. last 12 or 24 hours)
    filtered_articles = []
    now_utc = datetime.utcnow()
    
    # Check if it's Monday in Taiwan time (UTC+8)
    now_tw = now_utc + timedelta(hours=8)
    is_monday = now_tw.weekday() == 0
    is_monday_morning_exception = is_monday and timeframe_hours <= 24
    friday_articles_found = 0
    
    for art in all_articles:
        if art["pub_date"] is None:
            # If parsing failed, keep it but warn
            filtered_articles.append(art)
            continue
            
        age_hours = (now_utc - art["pub_date"]).total_seconds() / 3600.0
        
        # If within the user-specified limit, always include
        if age_hours <= timeframe_hours:
            filtered_articles.append(art)
        # If Monday morning exception, also include Friday afternoon articles
        # Friday is 3 days ago from Monday. 3 days = 72 hours. Let's capture 48 to 80 hours ago.
        elif is_monday_morning_exception and 48 <= age_hours <= 80:
            title = art["title"]
            # Only keep weekend/Friday articles that are likely about market close
            if any(k in title for k in ["收盤", "盤後", "法人", "外資", "非農", "指數", "道瓊", "台股", "美股"]):
                filtered_articles.append(art)
                friday_articles_found += 1
            
    print(f"Articles within last {timeframe_hours} hours: {len(filtered_articles) - friday_articles_found}")
    if is_monday_morning_exception:
        print(f"Monday Exception: Added {friday_articles_found} Friday closing articles.")
    
    # Group articles by source to ensure we have representation
    economic_daily_articles = [a for a in filtered_articles if a["feed_key"] == "economic_daily"]
    commercial_times_articles = [a for a in filtered_articles if a["feed_key"] == "commercial_times"]
    other_articles = [a for a in filtered_articles if a["feed_key"] not in ("economic_daily", "commercial_times")]
    
    # Limit number of articles sent to Gemini to prevent token overflow
    # Pick top 20 latest articles for each group
    economic_daily_articles = sorted(economic_daily_articles, key=lambda x: x["pub_date"] or datetime.min, reverse=True)[:20]
    commercial_times_articles = sorted(commercial_times_articles, key=lambda x: x["pub_date"] or datetime.min, reverse=True)[:20]
    other_articles = sorted(other_articles, key=lambda x: x["pub_date"] or datetime.min, reverse=True)[:30]
    
    prompt_articles = economic_daily_articles + commercial_times_articles + other_articles
    
    if not prompt_articles:
        return jsonify({"error": f"在過去 {timeframe_hours} 小時內沒有找到任何新聞，請嘗試擴大時間範圍（如 24 小時）。"}), 404
        
    # Format articles for prompt
    formatted_list = ""
    for idx, art in enumerate(prompt_articles):
        # Strip potential HTML or extra source suffix in titles like " - 經濟日報"
        clean_title = art["title"]
        if " - " in clean_title:
            clean_title = clean_title.rsplit(" - ", 1)[0]
        formatted_list += f"[{idx}] 來源: {art['source']} ({art['feed_source']}) | 標題: {clean_title} | 連結: {art['link']} | 時間: {art['pub_date_str']}\n"

    monday_rule = ""
    if is_monday_morning_exception:
        monday_rule = f"""
★ 【週一特例規則】：今天是週一，為確保盤後數據完整，新聞列表中已特別加入上週五的收盤新聞。
請注意：
- `post_market_reports` 區塊：請大方使用列表中上週五的盤後收盤數據來統整。
- `news_headlines` 區塊：【絕對只能】挑選時間在過去 {timeframe_hours} 小時內的最新新聞，嚴禁挑選上週五的舊聞作為頭條。
"""

    # Define the system prompt instruction
    prompt = f"""
你是一位服務於「富達投信 (Fidelity Investments)」的首席專業總體經濟與財經分析師。
你的受眾是「內部的高階基金經理人 (Fund Managers) 與機構投資者」，他們需要的是「極度專業、具備深度、且能影響投資決策 (Actionable & Market-moving)」的硬核財經新聞。
請從以下提供的今日新聞列表中，嚴格篩選出 5 到 7 則最符合機構投資者標準的重大新聞。

篩選與分析規則：
1. **內容聚焦（極度重要）**：
   - 必須挑選「總體經濟數據與預測、大盤指數與債市走勢、全球央行貨幣政策、重大地緣政治、重量級產業鏈趨勢（如 AI、半導體整體趨勢）」等具備「宏觀（Macro）廣泛影響力」的實質新聞。
   - 【嚴格排除散戶炒作與農場文】：絕對不准挑選散戶熱衷的無聊炒作、標題殺人法（Clickbait）、網路鄉民熱議、或是缺乏基本面支撐的純題材炒作新聞。
   - 【嚴格排除民生與微觀新聞】：絕對不准挑選民生消費小事（如：中油油價調整）、非金融市場相關的瑣碎新聞。
   - 【嚴格排除一般個股新聞】：除非是「台積電 (TSMC)、輝達 (Nvidia)、蘋果 (Apple)」這類能牽動全球或全台大盤走向的「超級巨頭權值股」，且新聞內容涉及「重大財報、資本支出、技術突破」等基本面巨變，否則「絕對不准」挑選單一公司的募資、人事異動或營運等一般個股新聞。
2. **來源限制**：
   - 必須挑選至少一則來自「經濟日報」的新聞。
   - 必須挑選至少一則來自「工商時報」的新聞。
3. **時效性**：
   - 原則上僅篩選過去 {timeframe_hours} 小時內的新聞。{monday_rule}
4. **輸出格式與語言**：
   - 必須完全使用繁體中文（Traditional Chinese）回答。
   - 必須依據指定的 JSON 格式將新聞分為四大板塊：
     a) `taiwan_market`: 第一板塊。必須包含「三大法人各別買賣超與合計買賣超（如：外資及陸資買賣超、投信買賣超、自營商買賣超、合計買賣超）」以及「台股盤後100字統整」。若新聞無明確數據，請從現有新聞中提煉大盤方向。
     b) `us_market`: 第二板塊。必須包含「美股四大指數的收盤表現（以 % 呈現，如：道瓊指數 +x.xx%）」以及「美股盤後100字統整」。
     c) `economic_daily_news`: 第三板塊。請從「經濟日報」中挑選 2 則最重大的財經新聞，並各提供 1~2 點條列式重點整理。
     d) `commercial_times_news`: 第四板塊。請從「工商時報」中挑選 2 則最重大的財經新聞，並各提供 1~2 點條列式重點整理。
   - 請精確使用提供的原網址。

以下是今日的新聞列表：
{formatted_list}
"""

    # Gemini REST API Call
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": prompt
                    }
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {
                    "taiwan_market": {
                        "type": "OBJECT",
                        "properties": {
                            "institutional_trading": {
                                "type": "ARRAY",
                                "items": {"type": "STRING"},
                                "description": "三大法人各別與合計買賣超，例如：'外資及陸資：買超 xxx 億'、'投信：...'、'自營商：...'、'合計：...'"
                            },
                            "summary": {
                                "type": "STRING",
                                "description": "台股盤後100字統整"
                            }
                        },
                        "required": ["institutional_trading", "summary"]
                    },
                    "us_market": {
                        "type": "OBJECT",
                        "properties": {
                            "indices_performance": {
                                "type": "ARRAY",
                                "items": {"type": "STRING"},
                                "description": "美股四大指數收盤表現(以%呈現)，例如：'道瓊指數：+x.xx%'、'那斯達克：-x.xx%'"
                            },
                            "summary": {
                                "type": "STRING",
                                "description": "美股盤後100字統整"
                            }
                        },
                        "required": ["indices_performance", "summary"]
                    },
                    "economic_daily_news": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "headline": {"type": "STRING"},
                                "points": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"},
                                    "description": "1, 2點條列式重點整理"
                                },
                                "link": {"type": "STRING"}
                            },
                            "required": ["headline", "points", "link"]
                        }
                    },
                    "commercial_times_news": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "headline": {"type": "STRING"},
                                "points": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"},
                                    "description": "1, 2點條列式重點整理"
                                },
                                "link": {"type": "STRING"}
                            },
                            "required": ["headline", "points", "link"]
                        }
                    }
                },
                "required": ["taiwan_market", "us_market", "economic_daily_news", "commercial_times_news"]
            }
        }
    }
    
    headers = {
        "Content-Type": "application/json"
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=90)
        if response.status_code != 200:
            print(f"Gemini API Error: {response.text}")
            return jsonify({"error": f"Gemini API 回傳錯誤 ({response.status_code}): {response.text}"}), 502
            
        result = response.json()
        
        # Extract text from response
        try:
            candidates = result.get("candidates", [])
            if not candidates:
                return jsonify({"error": "Gemini API 未回傳任何候選結果"}), 502
            
            content_text = candidates[0]["content"]["parts"][0]["text"]
            
            # Post-process: Decode only the URLs chosen by Gemini to save time
            try:
                result_data = json.loads(content_text)
                for key in ["economic_daily_news", "commercial_times_news"]:
                    if key in result_data:
                        for article in result_data[key]:
                            orig_link = article.get("link", "")
                            if orig_link:
                                article["link"] = decode_google_news_url(orig_link)
                content_text = json.dumps(result_data, ensure_ascii=False)
            except Exception as e:
                print(f"Error decoding URLs in JSON: {e}")
            
            # The API returns structured JSON based on our responseSchema
            return content_text, 200, {'Content-Type': 'application/json'}
            
        except (KeyError, IndexError) as e:
            return jsonify({"error": f"解析 Gemini API 回傳內容時發生錯誤: {str(e)}", "raw_response": result}), 502
            
    except requests.exceptions.Timeout:
        return jsonify({"error": "Gemini API 請求逾時，請稍後再試。"}), 504
    except Exception as e:
        return jsonify({"error": f"伺服器內部錯誤: {str(e)}"}), 500

if __name__ == '__main__':
    # Start on port 8010 to avoid conflicting standard ports
    app.run(host='127.0.0.1', port=8010, debug=True)
