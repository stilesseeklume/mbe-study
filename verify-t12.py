import json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/index.html"
PROGRESS = "http://localhost:8931/progress.html"
MOCK = "http://localhost:9001/tts"

SEED = """
(() => {
  const day = 86400000, now = Date.now();
  const s = {
    apiEndpoint: '%s',
    page: 10, completed: [],
    lookupLog: {standing:{word:'standing',page:10,count:3},mootness:{word:'mootness',page:10,count:1},ripeness:{word:'ripeness',page:10,count:1}},
    reviewQueue: [
      {id:'w:standing',word:'standing',type:'word',source:'lookup',status:'mastered',streak:5},
      {id:'w:mootness',word:'mootness',type:'word',source:'saved',status:'reviewing',streak:2},
      {id:'c:stake',word:'a concrete, personal stake',type:'chunk',source:'corrected',page:10,status:'reviewing',streak:0}
    ],
    readingLog: [
      {page:9,section:'p9-b2',words:75,seconds:40,wpm:113,pass:3,verified:true,date:now-day},
      {page:10,section:'p10-b4',words:62,seconds:28,wpm:133,pass:3,verified:true,date:now},
      {page:10,section:'p10-b16',words:16,seconds:5,wpm:600,pass:3,verified:false,date:now}
    ],
    retellLog: {10:{0:{answer:'ans',feedback:{term_accuracy:72,rewrite:'rw'},time:now}}},
    badges: []
  };
  localStorage.setItem('usbar-studio-v2', JSON.stringify(s));
})()
""" % MOCK

def state(page):
    return json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/Users/zhenliu/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell")
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script("localStorage.setItem('usbar-sync-skipped','1');")
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL)
    page.wait_for_selector(".word-token", timeout=15000)
    page.evaluate(SEED)
    page.reload()
    page.wait_for_selector(".word-token", timeout=15000)
    if page.locator("#enterStudio").is_visible():
        page.click("#enterStudio")

    # 1) progress link in rail
    assert page.locator("#progressLink").is_visible(), "progress link missing in rail"

    # 2) badge auto-grant: click a word (save event) -> motion_granted + lead_foot earned
    page.click('.page-item[data-page="10"]')
    page.wait_for_timeout(300)
    page.locator('.word-token').first.click()
    page.wait_for_timeout(1200)  # 600ms debounce + evaluate
    badges = state(page)["badges"]
    assert "motion_granted" in badges, f"motion_granted not granted: {badges}"
    assert "lead_foot" in badges, f"lead_foot not granted: {badges}"
    assert "sustained" not in badges and "case_closed" not in badges, f"over-grant: {badges}"

    # 3) progress.html renders all sections
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(PROGRESS)
    pg.wait_for_selector("#stats", timeout=15000)
    stats = pg.inner_text("#stats")
    assert "TIMED READS" in stats and "STREAK" in stats, f"stats labels missing: {stats[:80]}"
    pipe = pg.inner_text("#pipe")
    for token in ["查过的词", "复习中", "已毕业"]:
        assert token in pipe, f"pipe stage missing: {token}"
    # numbers: lookup>=3 (word click added one), reviewing=2(+1 new lookup->reviewing? click enqueues 'reviewing')
    assert pg.locator("#wpm polyline").count() == 1, "wpm chart polyline missing"
    assert "120–150" in pg.inner_text("#wpm"), "wpm target band label missing"
    assert pg.locator("#acc polyline").count() == 1, "acc chart polyline missing"
    arsenal = pg.inner_text("#arsenal")
    assert "a concrete, personal stake" in arsenal, f"arsenal chunk missing: {arsenal[:80]}"
    assert "第 10 页" in arsenal, "arsenal source page missing"
    unlocked = pg.locator(".badge-card:not(.locked)").count()
    locked = pg.locator(".badge-card.locked").count()
    assert unlocked == 2 and locked == 4, f"badge wall wrong: {unlocked} unlocked / {locked} locked"
    badge_count = pg.inner_text("#badgeCount")
    assert "2 / 6" in badge_count, f"badge count wrong: {badge_count}"
    tag = pg.inner_text("#syncTag")
    assert "本地数据" in tag or "同步" in tag, f"sync tag odd: {tag}"

    hard = [e for e in errors if "favicon" not in e.lower()]
    assert not hard, f"console errors: {hard}"
    print("T12 ALL PASS")
    browser.close()
