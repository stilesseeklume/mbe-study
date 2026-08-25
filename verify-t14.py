import json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8931"
MOCK = "http://localhost:9001/tts"
ANSWER = "The plaintiff must show a personal stake and a real injury caused by the defendant that the court can fix."

def state(page):
    return json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/Users/zhenliu/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell")
    ctx = browser.new_context()
    page = ctx.new_page()
    page.add_init_script(f"""
      localStorage.setItem('usbar-sync-skipped','1');
      if(!localStorage.getItem('usbar-studio-v2'))localStorage.setItem('usbar-studio-v2', JSON.stringify({{apiEndpoint:'{MOCK}'}}));
    """)
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    # ---- 1) welcome: today queue (fresh, no profile) ----
    page.goto(f"{BASE}/index.html")
    page.wait_for_selector(".word-token", timeout=15000)
    tq = page.inner_text("#todayQueue")
    assert "第 9 页" in tq and "3 条复述待完成" in tq, f"todayQueue wrong: {tq}"

    # ---- 2) calibration wizard (skim -> fast branch) ----
    page.click("#calibWelcome")
    page.click("#cbStart"); page.wait_for_timeout(250); page.click("#cbDone")
    for i, a in enumerate([2, 1, 3]):
        page.check("input[name=q%d][value='%d']" % (i, a))
    page.click("#cbNext"); page.wait_for_selector("#cbRetell")
    page.fill("#cbRetell", ANSWER)
    page.click("#cbGrade"); page.wait_for_selector("#cbNext2", timeout=8000)
    page.click("#cbNext2")
    calib = json.load(open("assets/calibration.json"))
    for i, q in enumerate(calib["vocab"]):
        page.check("input[name=v%d][value='%d']" % (i, q["answer"]))
    page.click("#cbFin")
    page.wait_for_function("() => JSON.parse(localStorage.getItem('usbar-studio-v2')||'{}').profile != null", timeout=10000)
    page.wait_for_load_state("load")
    prof = state(page)["profile"]
    assert prof["vocabCoverage"] == 100 and prof["config"]["audioLoop"] is False, f"profile wrong: {prof}"

    # ---- 3) today queue click -> first incomplete page 9 (simulate fresh session) ----
    page.evaluate("sessionStorage.removeItem('usbar-welcome-seen')")
    page.reload()
    page.wait_for_selector(".word-token", timeout=15000)
    page.wait_for_selector("#todayQueue:visible", timeout=15000)
    page.click("#todayQueue")
    page.wait_for_timeout(400)
    assert "第 9 页" in page.inner_text("#crumb"), f"todayQueue nav failed: {page.inner_text('#crumb')}"

    # ---- 4) page 10: lookup + zh expand + save word + timed read (skim) ----
    page.click('.page-item[data-page="10"]')
    page.wait_for_timeout(400)
    page.locator('.word-token:text-is("Standing")').first.click()
    page.wait_for_timeout(200)
    page.locator(".zh-toggle").first.click()
    page.wait_for_timeout(150)
    page.locator('.word-token:text-is("Mootness")').first.click()
    page.wait_for_timeout(200)
    page.click("#saveWord")
    page.wait_for_timeout(200)
    page.locator(".study-block.en:not(.heading) .trBtn").first.click()
    page.wait_for_selector("#trDone", timeout=5000)
    page.click("#trDone")  # instant -> skim, verified:false
    page.wait_for_timeout(400)
    rl = state(page)["readingLog"]
    assert len(rl) == 1 and rl[0]["verified"] is False, f"timed read wrong: {rl}"
    assert state(page)["zhExpand"]["total"] == 1, "zh expand not logged"

    # ---- 5) enable audioLoop -> reload -> loopBar (三遍法) ----
    s = state(page); s["profile"]["config"]["audioLoop"] = True
    page.evaluate("s => localStorage.setItem('usbar-studio-v2', JSON.stringify(s))", s)
    page.reload()
    page.wait_for_selector(".word-token", timeout=15000)
    page.wait_for_timeout(400)
    assert page.locator("#loopBar").count() == 1, "loopBar missing after audioLoop=true"

    # ---- 6) 3 retells via mock grade -> completion gate -> page done ----
    for i in range(3):
        page.wait_for_selector(f"#rtA{i}", timeout=8000)
        page.fill(f"#rtA{i}", ANSWER)
        page.click(f"#rtB{i}")
        page.wait_for_selector(f"#rtA{i}[disabled]", timeout=8000)
    page.wait_for_timeout(300)
    assert 10 in state(page)["completed"], f"completion gate failed: {state(page).get('completed')}"
    q = {i["id"]: i for i in state(page)["reviewQueue"]}
    assert any(k.startswith("c:") for k in q), "corrected chunk not enqueued"

    # ---- 7) review session ----
    page.click("#reviewEntry")
    page.wait_for_selector("#reviewHost #retellCard", timeout=5000)
    n = 0
    while "Review Done" not in page.inner_text("#reviewHost"):
        is_cloze = page.evaluate("!!document.querySelector('#reviewHost input#rvIn')")
        word = page.inner_text("#reviewHost .concept").strip()
        page.fill("#rvIn", word if is_cloze else f"The court applies {word} in this case today.")
        page.click("#rvGo")
        page.wait_for_timeout(1300)
        n += 1
        assert n < 12, "review loop runaway"

    # ---- 8) progress.html ----
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.goto(f"{BASE}/progress.html")
    pg.wait_for_selector("#stats", timeout=15000)
    stats = pg.inner_text("#stats")
    assert "LOOKUPS" in stats and "MASTERED" in stats
    assert pg.locator(".badge-card:not(.locked)").count() == 1, "expected only motion_granted unlocked"
    assert "Motion Granted" in pg.inner_text("#badges")
    assert "a concrete, personal stake" in pg.inner_text("#arsenal"), "arsenal missing chunk"
    assert pg.locator("#wpm polyline").count() == 1
    assert "72" in pg.inner_text("#acc") or pg.locator("#acc polyline").count() == 1

    # ---- 9) teacher.html with stub fed by the real final store ----
    final_store = state(page)
    rows = json.dumps([{"key": k, "value": v, "updated_at": "2026-08-25T00:00:00Z"} for k, v in final_store.items() if not k.startswith("_") and k != "apiEndpoint"])
    stub = f"""
    window.CloudSync = {{
      configured: () => true, ready: () => Promise.resolve(),
      isLoggedIn: () => true, isTeacher: () => true,
      email: () => 'teacher@usbar.study', onStatus: () => {{}}, logout: () => {{}},
      fetchState: () => Promise.resolve({rows}),
      fetchEvents: () => Promise.resolve([{json.dumps([{"kind": "review", "detail": {"text": "3/3"}, "created_at": "2026-08-25T01:00:00Z"}])}][0])
    }};
    """
    th = ctx.new_page()
    th.add_init_script("localStorage.setItem('usbar-sync-skipped','1');")
    th.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    th.route("**/assets/cloud-sync.js*", lambda route: route.fulfill(content_type="application/javascript", body=stub))
    th.goto(f"{BASE}/teacher.html")
    th.wait_for_selector("#board:not([hidden])", timeout=10000)
    stats_t = th.inner_text("#stats")
    assert "1" in stats_t.split("COMPLETED")[1][:20], f"completed not 1: {stats_t[:150]}"
    quality = th.inner_text("#quality")
    assert "她的原文" in quality and "AI 重写" in quality and "72" in quality
    speed = th.inner_text("#speed")
    assert "未验证" in speed and "120–150" in speed
    signals = th.inner_text("#signals")
    assert "中文参考展开" in signals and "standing" in signals and "查 1 次" in signals
    assert th.locator("#signals .chip.hot").count() == 0, "standing(1 lookup) should not be hot"

    hard = [e for e in errors if "favicon" not in e.lower()]
    assert not hard, f"console errors: {hard}"
    print("T14 ALL PASS (full student path)")
    browser.close()
