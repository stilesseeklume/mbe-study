import json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/index.html"
MOCK = "http://localhost:9001/tts"
ANSWER = "The plaintiff must show a personal stake and a real injury caused by the defendant that the court can fix."

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
    wel = page.locator("#enterStudio")
    if wel.is_visible():
        wel.click()
    page.evaluate("sessionStorage.setItem('usbar-welcome-seen','1')")

    # 1) page 9 shows 3 retell tasks
    page.click('.page-item[data-page="9"]')
    page.wait_for_selector("#retellCard", timeout=5000)
    assert page.locator("#retellCard .retell-task").count() == 3, "expected 3 tasks"
    assert "0/3" in page.inner_text("#retellCard .sub"), "progress sub wrong"

    # 2) complete blocked before retells
    page.click("#completePage")
    page.wait_for_timeout(200)
    state = json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))
    assert 9 not in state["completed"], "page completed without retells"
    assert "复述" in page.inner_text("#toast"), "gate toast missing"

    # 3) short answer rejected
    page.fill("#rtA0", "too short")
    page.click("#rtB0")
    page.wait_for_timeout(200)
    assert not page.locator("#rtA0").is_disabled(), "short answer should not lock textarea"

    # 4) grade 3 tasks via mock -> auto complete
    for i in range(3):
        page.fill(f"#rtA{i}", ANSWER)
        page.click(f"#rtB{i}")
        page.wait_for_selector(f"#rtA{i}[disabled]", timeout=5000)
    page.wait_for_timeout(400)
    state = json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))
    assert 9 in state["completed"], "auto-complete after 3 retells failed"
    log = state["retellLog"]["9"]
    assert len(log) == 3 and log["0"]["feedback"]["term_accuracy"] == 72, f"retellLog wrong: {log}"
    assert "1 / 10" == page.inner_text("#progressText"), "progress text wrong"
    assert "1/3" not in page.inner_text("#retellCard .sub"), "sub progress not updated"

    # 5) graded feedback visible
    fb = page.inner_text("#retellCard .retell-fb")
    assert "72" in fb and "personal stake" in fb, "feedback panel wrong"

    # 6) reload: persisted + disabled
    page.reload()
    page.wait_for_selector("#retellCard", timeout=10000)
    assert page.locator("#retellCard textarea[disabled]").count() == 3, "graded answers not locked after reload"

    # 7) page 7 (TOC, no tasks): complete allowed directly
    page.click('.page-item[data-page="7"]')
    page.wait_for_timeout(300)
    assert page.locator("#retellCard .retell-task").count() == 0, "TOC page should have no tasks"
    page.click("#completePage")
    page.wait_for_timeout(200)
    state = json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))
    assert 7 in state["completed"], "taskless page complete blocked"
    assert "2 / 10" == page.inner_text("#progressText"), "progress after TOC complete wrong"

    hard = [e for e in errors if "favicon" not in e.lower()]
    assert not hard, f"console errors: {hard}"
    print("T8 ALL PASS")
    browser.close()
