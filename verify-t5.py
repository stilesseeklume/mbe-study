import json, subprocess, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/index.html"

def token_button(page, word):
    return page.locator(f'.word-token:text-is("{word}")').first

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/Users/zhenliu/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell")
    page = browser.new_page()
    page.add_init_script("localStorage.setItem('usbar-sync-skipped','1')")
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL)
    page.wait_for_selector(".word-token", timeout=15000)
    # dismiss welcome if present
    wel = page.locator("#enterStudio")
    if wel.is_visible():
        wel.click()
    page.evaluate("sessionStorage.setItem('usbar-welcome-seen','1')")
    page.click('.page-item[data-page="9"]')
    page.wait_for_timeout(300)

    # 1) overlay hit: standing on page 9
    token_button(page, "standing").click()
    page.wait_for_timeout(300)
    view = page.inner_html("#wordView")
    assert "standing (n.)" in view, "overlay display not shown"
    assert "<b>本页法律含义</b>" in view, "legal block missing"
    assert "<b>通用义陷阱</b>" in view, "general trap block missing"
    assert "诉讼资格" in view, "legal translation missing"
    assert "PAGE 09" in view, "dynamic page label missing"

    log = json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))["lookupLog"]
    assert log["standing"]["count"] == 1 and log["standing"]["page"] == 9, f"first lookup wrong: {log.get('standing')}"

    # 2) same word again -> count 2
    token_button(page, "standing").click()
    page.wait_for_timeout(200)
    log = json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))["lookupLog"]
    assert log["standing"]["count"] == 2, f"repeat lookup count wrong: {log['standing']}"

    # 3) normal word: government -> no legal block, still logged
    token_button(page, "government").click()
    page.wait_for_timeout(200)
    view = page.inner_html("#wordView")
    assert "<b>本页法律含义</b>" not in view, "legal block should not appear for plain word"
    assert "<b>通用义陷阱</b>" not in view, "trap block should not appear for plain word"
    log = json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))["lookupLog"]
    assert log.get("government", {}).get("count") == 1, f"government lookup missing: {log.get('government')}"

    # 4) switch to page 16: sovereign hits overlay, page label updates
    page.click('.page-item[data-page="16"]')
    page.wait_for_timeout(300)
    token_button(page, "sovereign").click()
    page.wait_for_timeout(200)
    view = page.inner_html("#wordView")
    assert "主权豁免" in view or "主权" in view, "page16 overlay not hit"
    assert "PAGE 16" in view, "page label did not update"
    log = json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))["lookupLog"]
    assert log.get("sovereign", {}).get("page") == 16, f"sovereign page wrong: {log.get('sovereign')}"

    # 5) reload: lookupLog persists (and would sync)
    page.reload()
    page.wait_for_selector(".word-token", timeout=15000)
    log = json.loads(page.evaluate("localStorage.getItem('usbar-studio-v2')"))["lookupLog"]
    assert log["standing"]["count"] == 2 and log["sovereign"]["page"] == 16, "lookupLog not persisted"

    hard = [e for e in errors if "favicon" not in e.lower()]
    assert not hard, f"console errors: {hard}"
    print("T5 ALL PASS")
    browser.close()
