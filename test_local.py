import requests

url = "http://127.0.0.1:8010/api/news"
# Use a timeframe of 48 hours to ensure we get some news to feed to Gemini
payload = {
    "hours": "48"
}
try:
    resp = requests.post(url, json=payload, timeout=60)
    print(f"Status: {resp.status_code}")
    print(f"Body: {resp.text}")
except Exception as e:
    print(f"Exception: {e}")
