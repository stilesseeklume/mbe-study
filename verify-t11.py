import json, re
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/index.html"
MOCK = "http://localhost:9001/tts"
FAST_PROFILE = {"date": 1787652000000, "wpm": 150, "retellBaseline": 70, "vocabCoverage": 80,
                "config": {"audioLoop": False, "retellCount": 3, "reviewDaily": 10, "timReading": "optional", "timedReading": "optional"}}

def state(page):
    return json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))

def longest_word(text):
    words = re.findall(r"[A-Za-z][A-Za-z'’-]{5,}", text)
    return max(words, key=len) if words else ""

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/Users/zhenliu/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell")
    page = browser.new_page()
    page.add_init_script(f"""
      localStorage.setItem('usbar-sync-skipped','1');
      if(!localStorage.getItem('usbar-studio-v2'))localStorage.setItem('usbar-studio-v2', JSON.stringify({{apiEndpoint:'{MOCK}'}}));
    """)
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL)
    page.wait_for_selector(".word-token", timeout=15000)
    if page.locator("#enterStudio").is_visible():
        page.click("#enterStudio")

    course = json.load(open("assets/course-content.json"))
    page.click('.page-item[data-page="10"]')
    page.wait_for_timeout(400)

    # 1) default (no profile) -> loopBar visible, every EN paragraph has ⏱
    assert page.locator("#loopBar").count() == 1, "loopBar missing for default profile"
    blocks = page.locator(".study-block.en:not(.heading)")
    n = blocks.count()
    assert n >= 5, f"too few EN blocks: {n}"
    assert page.locator(".trBtn").count() == n, f"trBtn not on all EN blocks: {page.locator('.trBtn').count()}/{n}"
    assert page.locator(".study-block.heading .trBtn").count() == 0, "trBtn leaked to heading block"

    # 2) quit records nothing
    blocks.first.locator(".trBtn").click()
    page.wait_for_selector("#trDone", timeout=5000)
    assert "words" in page.inner_text("body"), "word count missing in timed layer"
    page.click("#trQuit")
    page.wait_for_timeout(300)
    assert state(page).get("readingLog", []) == [], "quit recorded a session"

    # 3) skim path: instant finish -> wpm>400 -> record without cloze, verified:false
    sec_id = page.locator(".study-block.en:not(.heading)").first.get_attribute("data-block")
    page.locator(f".study-block[data-block='{sec_id}'] .trBtn").click()
    page.wait_for_selector("#trDone", timeout=5000)
    page.click("#trDone")
    page.wait_for_timeout(400)
    log = state(page)["readingLog"]
    assert len(log) == 1 and log[0]["verified"] is False and log[0]["wpm"] > 400, f"skim path wrong: {log}"
    assert log[0]["section"] == sec_id and log[0]["pass"] == 3, f"section/pass wrong: {log[0]}"

    # 4) cloze path: read slowly (12s) -> wpm<400 -> spell-back key -> verified:true
    page.locator(f".study-block[data-block='{sec_id}'] .trBtn").click()
    page.wait_for_selector("#trDone", timeout=5000)
    page.wait_for_timeout(12000)
    page.click("#trDone")
    page.wait_for_selector("#trKey", timeout=5000)
    raw = next(b["text"] for pg in course["pages"] for b in pg["blocks"] if b["id"] == sec_id)
    key = longest_word(raw)
    page.fill("#trKey", key)
    page.click("#trOk")
    page.wait_for_timeout(400)
    log = state(page)["readingLog"]
    assert len(log) == 2 and log[1]["verified"] is True and 0 < log[1]["wpm"] < 400, f"cloze path wrong: {log}"

    # 5) switch page -> buttons persist (usbar:page refresh)
    page.click('.page-item[data-page="11"]')
    page.wait_for_timeout(400)
    assert page.locator(".trBtn").count() == page.locator(".study-block.en:not(.heading)").count(), "trBtn missing after page switch"

    # 6) fast profile (audioLoop:false) -> loopBar hidden
    s = state(page); s["profile"] = FAST_PROFILE
    page.evaluate("s => localStorage.setItem('usbar-studio-v2', JSON.stringify(s))", s)
    page.reload()
    page.wait_for_selector(".word-token", timeout=15000)
    page.wait_for_timeout(300)
    assert page.locator("#loopBar").count() == 0, "loopBar should hide when audioLoop:false"
    assert page.locator(".trBtn").count() > 0, "trBtn should remain regardless of profile"

    hard = [e for e in errors if "favicon" not in e.lower()]
    assert not hard, f"console errors: {hard}"
    print("T11 ALL PASS")
    browser.close()
