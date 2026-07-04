import requests
url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=AQ.Ab8_FakeKeyForTesting12345"
try:
    resp = requests.post(url, json={"contents":[{"parts":[{"text":"hello"}]}]})
    print(f"Status: {resp.status_code}")
    print(f"Body: {resp.text}")
except Exception as e:
    print(f"Exception: {e}")
