import json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/teacher.html"
DAY = 86400000
NOW = 1787652000000  # fixed-ish; bucket math uses Date.now() anyway

def rows_from(state):
    return [{"key": k, "value": v, "updated_at": "2026-08-25T00:00:00Z"} for k, v in state.items()]

STATE = {
    "completed": [10, 20],
    "notes": [], "savedWords": ["standing"],
    "retellLog": {
        "10": {"0": {"answer": "The plaintiff must show injury.", "feedback": {"term_accuracy": 82, "rewrite": "A plaintiff must allege a concrete injury."}, "time": 1787650000000},
               "1": {"answer": "old answer", "feedback": {"term_accuracy": 70, "rewrite": "old rewrite"}, "time": 1787560000000}},
        "11": {"0": {"answer": "earlier attempt", "feedback": {"term_accuracy": 60, "rewrite": "earlier rewrite"}, "time": 1787652000000 - 21 * DAY}}
    },
    "profile": {"date": 1787600000000, "wpm": 96, "retellBaseline": 72, "vocabCoverage": 65, "config": {}},
    "readingLog": [
        {"page": 9, "section": "p9-b2", "words": 75, "seconds": 40, "wpm": 113, "verified": True, "date": 1787650000000},
        {"page": 10, "section": "p10-b4", "words": 62, "seconds": 28, "wpm": 133, "verified": True, "date": 1787640000000},
        {"page": 10, "section": "p10-b16", "words": 16, "seconds": 5, "wpm": 600, "verified": False, "date": 1787630000000}
    ],
    "zhExpand": {"total": 9, "byPage": {}},
    "lookupLog": {
        "standing": {"word": "standing", "page": 10, "count": 4},
        "mootness": {"word": "mootness", "page": 10, "count": 1},
        "ripeness": {"word": "ripeness", "page": 10, "count": 2}
    },
    "_activity": {"last_active": "2026-08-25T01:00:00Z"}
}

EVENTS = [
    {"kind": "calibration", "detail": {"text": "wpm 96 · retell 72 · vocab 65%"}, "created_at": "2026-08-25T01:00:00Z"},
    {"kind": "reading", "detail": {"text": "p10 133wpm"}, "created_at": "2026-08-25T00:50:00Z"},
    {"kind": "review", "detail": {"text": "3/4"}, "created_at": "2026-08-25T00:40:00Z"}
]

STUB = """
window.CloudSync = {
  configured: () => true,
  ready: () => Promise.resolve(),
  isLoggedIn: () => true,
  isTeacher: () => true,
  email: () => 'teacher@usbar.study',
  onStatus: () => {},
  logout: () => {},
  fetchState: () => Promise.resolve(%s),
  fetchEvents: () => Promise.resolve(%s)
};
""" % (json.dumps(rows_from(STATE)), json.dumps(EVENTS))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/Users/zhenliu/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell")
    page = browser.new_page()
    page.add_init_script("localStorage.setItem('usbar-sync-skipped','1');")
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.route("**/assets/cloud-sync.js*", lambda route: route.fulfill(content_type="application/javascript", body=STUB))
    page.goto(URL)
    page.wait_for_selector("#board:not([hidden])", timeout=10000)

    # stats: trial-scoped completion
    stats = page.inner_text("#stats")
    assert "试运行 10 页" in stats, f"trial label missing: {stats[:100]}"
    assert "COMPLETED" in stats

    # feed with new event kinds + detail
    feed = page.inner_text("#feed")
    for tok in ["完成了校准测试", "wpm 96 · retell 72 · vocab 65%", "完成了一次净读计时", "p10 133wpm", "完成了一轮复习"]:
        assert tok in feed, f"feed missing: {tok}"

    # quality: cards + trend
    q = page.inner_text("#quality")
    for tok in ["她的原文", "AI 重写", "The plaintiff must show injury.", "A plaintiff must allege a concrete injury.", "本周", "3 周前", "▲"]:
        assert tok in q, f"quality missing: {tok}"
    assert page.locator("#quality .rq-card").count() == 2, "expect 2 page cards"

    # speed: profile mini-stats + reads
    sp = page.inner_text("#speed")
    for tok in ["96", "72", "65%", "133 wpm", "未验证", "已验证", "120–150"]:
        assert tok in sp, f"speed missing: {tok}"

    # signals: zh expand + hot lookup
    sig = page.inner_text("#signals")
    for tok in ["中文参考展开", "standing", "查 4 次", "未习得"]:
        assert tok in sig, f"signals missing: {tok}"
    assert page.locator("#signals .chip.hot").count() == 1, "hot chip count wrong"
    # mootness(1)/ripeness(2) present too
    assert "mootness" in sig and "ripeness" in sig, "top5 lookups incomplete"

    hard = [e for e in errors if "favicon" not in e.lower()]
    assert not hard, f"console errors: {hard}"
    print("T13 ALL PASS")
    browser.close()
