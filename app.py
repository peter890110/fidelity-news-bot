import os
import requests
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
import concurrent.futures
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv

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
你是一位專業的中文總體經濟與財經分析助理。
請從以下提供的今日新聞列表中，篩選出 5 到 7 則最能影響總體經濟與大盤走向（Market-moving）的重大新聞。

篩選與分析規則：
1. **內容聚焦（極度重要）**：
   - 必須挑選「總體經濟數據、大盤指數走勢、央行貨幣政策、大型產業鏈趨勢（如 AI、半導體整體趨勢）」等 General 且具廣泛影響力的新聞。
   - 【絕對禁止】挑選政治、體育、娛樂、社會等「非財經」領域的新聞！嚴格排除冷門個股、利基型題材、名人八卦或與大盤連動度低的微觀新聞。若該新聞與總體經濟或股市完全無關，請直接捨棄。
2. **來源限制**：
   - 必須挑選至少一則來自「經濟日報」的新聞。
   - 必須挑選至少一則來自「工商時報」的新聞。
3. **時效性**：
   - 原則上僅篩選過去 {timeframe_hours} 小時內的新聞。{monday_rule}
4. **輸出格式與語言**：
   - 必須完全使用繁體中文（Traditional Chinese）回答。
   - 必須依據指定的 JSON 格式將新聞分為兩大類：
     a) `post_market_reports`: 盤後統整報告。請務必包含〈美股盤後〉與〈台股盤後〉兩個區塊：
        - 〈美股盤後〉：必須包含「四大指數表現（道瓊、那斯達克、S&P 500、費城半導體）」以及「昨日走勢分析」。
        - 〈台股盤後〉：必須包含「成交量」、「三大法人買賣超資訊」，以及「今日領軍強勢股表現」。
        若新聞列表中缺少確切數據，請盡可能從現有總經新聞中提煉大盤方向。內文請拆分為多個重點短句（bullet points）。
     b) `news_headlines`: 各報重大新聞頭條。摘要需擴充至約 100 字，並拆分成 2-3 點有邏輯的段落重點（numbered points）。
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
                    "post_market_reports": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "title": {
                                    "type": "STRING",
                                    "description": "例如：〈美股盤後〉特斯拉跌逾7%... 或重大總經統整標題"
                                },
                                "bullet_points": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"},
                                    "description": "該統整報告的重點短句列表，例如：主要指數表現：道瓊指數上漲... 或 其他盤勢觀察。"
                                }
                            },
                            "required": ["title", "bullet_points"]
                        }
                    },
                    "news_headlines": {
                        "type": "ARRAY",
                        "items": {
                            "type": "OBJECT",
                            "properties": {
                                "source": {
                                    "type": "STRING",
                                    "description": "新聞來源媒體名稱（例如：經濟日報、工商時報）"
                                },
                                "headline": {
                                    "type": "STRING",
                                    "description": "新聞標題"
                                },
                                "numbered_points": {
                                    "type": "ARRAY",
                                    "items": {"type": "STRING"},
                                    "description": "約 100 字的新聞深度摘要，拆分為 2 到 3 個重點句子，用於編號呈現。"
                                },
                                "link": {
                                    "type": "STRING",
                                    "description": "新聞列表中對應的完整超連結"
                                }
                            },
                            "required": ["source", "headline", "numbered_points", "link"]
                        }
                    }
                },
                "required": ["post_market_reports", "news_headlines"]
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
