import json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8931/index.html"
MOCK = "http://localhost:9001/tts"
ANSWER = "The plaintiff must show a personal stake and a real injury caused by the defendant that the court can fix."

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
    wel = page.locator("#enterStudio")
    if wel.is_visible():
        wel.click()

    page.click('.page-item[data-page="9"]')
    page.wait_for_timeout(300)

    # 1) lookup enqueues with context
    page.locator('.word-token:text-is("standing")').first.click()
    page.wait_for_timeout(200)
    q = {i["id"]: i for i in state(page)["reviewQueue"]}
    assert "w:standing" in q and q["w:standing"]["source"] == "lookup", f"lookup enqueue wrong: {list(q)}"
    assert "standing" in q["w:standing"]["contextSentence"], "context sentence missing"

    # 2) saved word enqueues (new word: mootness)
    page.locator('.word-token:text-is("mootness")').first.click()
    page.wait_for_timeout(200)
    page.click("#saveWord")
    page.wait_for_timeout(200)
    q = {i["id"]: i for i in state(page)["reviewQueue"]}
    assert q["w:mootness"]["source"] == "saved", f"saved source wrong: {q.get('w:mootness')}"

    # 3) corrected chunk enqueues after retell grading
    page.fill("#rtA0", ANSWER)
    page.click("#rtB0")
    page.wait_for_selector("#rtA0[disabled]", timeout=5000)
    q = {i["id"]: i for i in state(page)["reviewQueue"]}
    chunk = [k for k in q if k.startswith("c:")]
    assert chunk and q[chunk[0]]["type"] == "chunk", f"chunk missing: {list(q)}"

    # 4) badge shows due count (3 items)
    n = page.locator("#reviewEntry .n").inner_text().strip()
    assert n == "3", f"badge wrong: {n}"

    # 5) mastery graduation path: pre-set standing streak to 4, reload so in-memory store picks it up
    page.evaluate("""() => {const s=JSON.parse(localStorage.getItem('usbar-studio-v2'));
      s.reviewQueue.find(x=>x.id==='w:standing').streak=4;
      localStorage.setItem('usbar-studio-v2',JSON.stringify(s));}""")
    page.reload()
    page.wait_for_selector(".word-token", timeout=15000)
    page.wait_for_timeout(400)
    if page.evaluate("!!document.querySelector('#welcome:not(.hidden)')"):
        page.evaluate("document.querySelector('#enterStudio').click()")

    # 6) run review session: answer all (cloze correct, write via mock)
    page.click("#reviewEntry")
    page.wait_for_selector("#reviewHost #retellCard", timeout=5000)
    total = 0
    while True:
        if "Review Done" in page.inner_text("#reviewHost"):
            break
        is_cloze = page.evaluate("!!document.querySelector('#reviewHost input#rvIn')")
        word = page.inner_text("#reviewHost .concept").strip()
        if is_cloze:
            page.fill("#rvIn", word)
        else:
            page.fill("#rvIn", f"The court applies {word} in this case today.")
        page.click("#rvGo")
        page.wait_for_timeout(1400)
        total += 1
        assert total < 10, "review loop runaway"

    q = {i["id"]: i for i in state(page)["reviewQueue"]}
    assert q["w:standing"]["status"] == "mastered" and q["w:standing"]["streak"] == 5, f"mastery failed: {q['w:standing']}"
    correct_items = [i for i in q.values() if i["interval"] == 1 and i["streak"] == 1]
    assert len(correct_items) >= 1, "correct answer not scheduled to interval 1"
    badge = page.locator("#reviewEntry .n").inner_text().strip()
    assert badge == "" or badge == "0", f"badge not cleared: {badge}"
    summary = page.inner_text("#reviewHost")
    assert "正确" in summary, "summary missing"

    hard = [e for e in errors if "favicon" not in e.lower()]
    assert not hard, f"console errors: {hard}"
    print("T9 ALL PASS")
    browser.close()
