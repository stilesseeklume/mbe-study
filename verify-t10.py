import json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/index.html"
MOCK = "http://localhost:9001/tts"
RETELL = "Standing requires a personal injury, and plaintiffs seeking injunctive relief must show a likelihood of future harm."

def state(page):
    return json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))

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

    # 1) welcome shows calibration entry when no profile
    assert page.locator("#calibWelcome").is_visible(), "welcome calibration entry missing"

    # 2) open wizard from welcome
    page.click("#calibWelcome")
    page.wait_for_selector("#calibWiz", timeout=5000)
    assert "CALIBRATION 1/3" in page.inner_text("#calibWiz"), "step1 not shown"
    assert page.locator("#calibEntry").count() == 1, "sidebar entry missing"

    # 3) start reading, then reload -> wizard resumes with article visible
    page.click("#cbStart")
    page.reload()
    page.wait_for_selector("#calibWiz", timeout=10000)
    assert page.locator("#cbArticle").is_visible(), "resume failed: article not shown"

    # 4) finish reading instantly (high wpm), comprehension gate
    page.click("#cbDone")
    page.wait_for_selector("input[name=q0]", timeout=5000)
    for i, ans in enumerate([2, 1, 3]):
        page.check(f"input[name=q{i}][value='{ans}']")
    page.click("#cbNext")
    page.wait_for_selector("#cbRetell", timeout=5000)

    # 5) comprehension gate rejects <2/3 is covered by unit logic; retell via mock grader
    page.fill("#cbRetell", RETELL)
    page.click("#cbGrade")
    page.wait_for_selector("#cbNext2", timeout=8000)
    assert "72" in page.inner_text("#cbFb"), "baseline score not rendered"
    page.click("#cbNext2")
    page.wait_for_selector("input[name=v0]", timeout=5000)

    # 6) answer all vocab correctly from the published JSON
    calib = json.load(open("assets/calibration.json"))
    for i, q in enumerate(calib["vocab"]):
        page.check(f"input[name=v{i}][value='{q['answer']}']")
    page.click("#cbFin")
    page.wait_for_function("() => {const s=JSON.parse(localStorage.getItem('usbar-studio-v2')||'{}');return s.profile!=null}", timeout=10000)
    page.wait_for_load_state("load")

    prof = state(page)["profile"]
    assert prof["wpm"] > 130, f"wpm not fast-branch: {prof['wpm']}"
    assert prof["retellBaseline"] == 72, f"retell baseline wrong: {prof['retellBaseline']}"
    assert prof["vocabCoverage"] == 100, f"vocab coverage wrong: {prof['vocabCoverage']}"
    assert prof["config"]["audioLoop"] is False and prof["config"]["reviewDaily"] == 10, f"config wrong: {prof['config']}"
    assert page.locator("#calibWiz").count() == 0, "wizard still present after completion"

    # 7) recal entry appears; 4-week gate asks confirm, accept -> profile cleared, wizard reopens
    assert page.locator("#calibEntry").text_content().strip() == "↻ 重新校准", "recal entry missing"
    page.once("dialog", lambda d: d.accept())
    page.click("#calibEntry")
    page.wait_for_function("() => {const s=JSON.parse(localStorage.getItem('usbar-studio-v2')||'{}');return s.profile===null}", timeout=10000)
    page.wait_for_selector("#calibWiz", timeout=10000)

    hard = [e for e in errors if "favicon" not in e.lower()]
    assert not hard, f"console errors: {hard}"
    print("T10 ALL PASS")
    browser.close()
