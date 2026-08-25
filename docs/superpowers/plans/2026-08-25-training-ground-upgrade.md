# USBAR 训练场升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把单页试学阅读器升级为"训练场"：复述驱动输出 + AI 批改 + 三源复习队列 + 校准/限时阅读/音频循环 + 学生成长面板与老师过程面板。**上线策略（用户已确认）：先试运行开放第 7–16 页（宪法第一章前段 10 页），跑 1–2 周后由老师看数据（复述完成率/复习到期完成率/学生反馈）手动决定全开；全开 = 改一行页面区间配置。UI 原则：不改动欢迎页图片与首屏视觉，新功能全部沿用现有设计语言做加法。**

**Architecture:** 纯静态站（GitHub Pages）不变；新功能拆成独立 ES module（retell/review/calibrate/reading/badges），index.html 作为编排器传入共享上下文 `App`；纯逻辑（SM-2 调度、wpm 计算、时间戳映射）提取为可 node:test 的纯模块；AI 批改经腾讯 SCF 上的 MiniMax 代理新增 `action:'grade'` 路由（零网关改动）；素材（复述任务/法律义项覆盖/校准题）由 tools/ 下的一次性生成脚本调 LLM 批量产出、人工抽查后静态化。

**Tech Stack:** 原生 ES2020+ module、Supabase（现有 study_state/study_events 表）、MiniMax t2a_v2（TTS）+ chatcompletion_v2（批改）、node:test（纯逻辑测试）、node:http（代理）。

**规格文档:** `docs/superpowers/specs/2026-08-25-study-site-upgrade-design.md`（rev2）

**分支约定:** 在 `main` 上按任务小步提交；每个任务结束跑 `git status` 确认干净。

**共享事实（所有任务依赖）:**
- 仓库：`/tmp/mbe-study-site`（git remote `origin` = GitHub Pages 源）
- 状态存储：`localStorage["usbar-studio-v2"]`（下称 `store`），`save()` 派发 `usbar:save` 事件
- 云同步：`assets/cloud-sync.js` 第 14 行 `SYNC_KEYS` 数组决定哪些 key 上云；新 key 必须加进去
- 代理线上地址：`https://1434356797-0sb9g9vb7b.ap-guangzhou.tencentscf.com/tts`（腾讯 SCF，源码 `server/minimax-proxy.mjs`）
- 讲义：`assets/course-content.json`，51 页，块 `{id:"pN-bM", kind:"heading"|"paragraph", lang:"en"|"zh", text}`
- 词典：`assets/course-dictionary.json` `{entries:{word:{word,phonetic,translation,definition,exchange}}}`
- 本地验证：`cd /tmp/mbe-study-site && python3 -m http.server 8931`，浏览器开 `http://localhost:8931/index.html`

---

## Milestone 0 · 地基（试运行章节解锁 + 状态键）

### Task 1: 试运行解锁第 7–16 页（全开=改一行配置）

**Files:**
- Modify: `index.html`（第 52、53、82、90 行附近）

- [ ] **Step 1: 页面过滤改为区间常量**

index.html 第 52 行：
```js
const TEST_PAGE=9,...,studyPages=course.pages.filter(p=>p.page===TEST_PAGE),...
```
改为：
```js
const OPEN_FROM=7,OPEN_TO=16,...,studyPages=course.pages.filter(p=>p.page>=OPEN_FROM&&p.page<=OPEN_TO),...
```
删除 `TEST_PAGE` 常量；同页 `store.page=TEST_PAGE` 改为 `store.page=studyPages.some(p=>p.page===store.page)?store.page:studyPages[0].page`（持久化页码；若存储页码不在解锁区间内则回落首页——将来全开时旧页码自然保留）。

- [ ] **Step 2: 页列表渲染全部页**

`renderPageList`（第 83 行）当前 `studyPages.filter(...)` 保留，但 `.page-item` 的 `<span class="day">TEST</span>` 改为 `<span class="day">P${String(p.page).padStart(2,'0')}</span>`；点击回调里 `store.page=TEST_PAGE` 改为 `store.page=p.page`。`$("#progressText").textContent` 的 `1/1` 计算改为 `${store.completed.filter(n=>studyPages.some(p=>p.page===n)).length} / ${studyPages.length}`。

- [ ] **Step 3: 文档渲染跟随 store.page**

`renderDocument`（第 90 行）`const page=studyPages[0]` 改为 `const page=studyPages.find(p=>p.page===store.page)||studyPages[0]`。`$("#lessonKicker").textContent` 改为 `'COURSE · CHAPTER READER'`；`$("#pageMeta")` 改为 `讲义第 ${page.page} / ${studyPages.length} 页`；`$("#blockMeta")` 改为 `${page.blocks.length} 个学习段落`；`$("#crumb")` 改为 `第 ${page.page} 页`。

- [ ] **Step 4: 浏览器验证**

Run: 起本地服务，浏览器打开，断言：左侧列表 10 项（P07–P16）；点第 12 页主区切换；刷新后停留第 12 页（store.page 持久化）；localStorage 里页码为 20（区间外）时回落到第 7 页；`legalTitles` 之外的页显示英文首标题。

- [ ] **Step 5: Commit**

```bash
git add index.html && git commit -m "feat: 试运行解锁宪法第一章7-16页，页码持久化"
```

### Task 2: 新状态键 + App 上下文（所有后续任务的地基）

**Files:**
- Modify: `assets/cloud-sync.js:14`（SYNC_KEYS）
- Modify: `index.html`（模块加载区 + init 区）
- Test: `tests/store-keys.test.mjs`（仅测 cloud-sync 的 SYNC_KEYS 导出）

- [ ] **Step 1: 写失败测试**

创建 `tests/store-keys.test.mjs`：
```js
import test from 'node:test';import assert from 'node:assert/strict';
const src=await import('fs').then(fs=>fs.promises.readFile('assets/cloud-sync.js','utf8'));
test('SYNC_KEYS 覆盖全部训练场新键',()=>{
  const need=['page','completed','notes','highlights','edits','savedWords','apiEndpoint','retellLog','reviewQueue','lookupLog','badges','profile','readingLog','zhExpand'];
  for(const k of need)assert.ok(new RegExp(`'${k}'`).test(src),`SYNC_KEYS 缺 ${k}`);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /tmp/mbe-study-site && node --test tests/store-keys.test.mjs`
Expected: FAIL（缺 retellLog 等 7 个键）

- [ ] **Step 3: 扩展 SYNC_KEYS 与 store 默认值**

cloud-sync.js 第 14 行改为：
```js
var SYNC_KEYS = ['page','completed','notes','highlights','edits','savedWords','apiEndpoint','retellLog','reviewQueue','lookupLog','badges','profile','readingLog','zhExpand'];
```
index.html 第 53 行 store 默认值链后追加：
```js
store.retellLog=store.retellLog||{};store.reviewQueue=store.reviewQueue||[];store.lookupLog=store.lookupLog||{};store.badges=store.badges||[];store.profile=store.profile||null;store.readingLog=store.readingLog||[];store.zhExpand=store.zhExpand||{total:0,byPage:{}};
```

- [ ] **Step 4: 建 App 上下文并挂接模块 init 钩子**

index.html 模块脚本末尾（现有 init 代码之后）追加：
```js
const App={store,save,toast,course,dictionary,$,$$,speak,openDock,renderDocument,showWord:()=>{},grade:null};
window.dispatchEvent(new CustomEvent('usbar:app',{detail:App}));
const moduleInits=[];window.usbarRegister=fn=>moduleInits.push(fn);
```
（`grade` 与 `showWord` 在 Task 6/5 填充；各功能模块用 `window.usbarRegister(init=>init(App))` 注册，index.html 末尾统一 `moduleInits.forEach(fn=>fn(App))`。）

- [ ] **Step 5: 跑测试通过 + 浏览器回归**

Run: `node --test tests/store-keys.test.mjs` → PASS；浏览器打开站点无 console 报错、原功能（查词/笔记/朗读）正常。

- [ ] **Step 6: Commit**

```bash
git add assets/cloud-sync.js index.html tests/store-keys.test.mjs && git commit -m "feat: 训练场状态键上云 + App模块上下文"
```

---

## Milestone 1 · 既有 bug 修复

### Task 3: TTS 逐词高亮时间戳驱动（规格 4.12）

**Files:**
- Create: `assets/speed-utils.js`（纯逻辑：时间戳→token 映射）
- Test: `tests/speed-utils.test.mjs`
- Modify: `index.html`（beginWordHighlight / apiSpeech 缓存）

- [ ] **Step 1: 写失败测试（映射逻辑）**

`tests/speed-utils.test.mjs`：
```js
import test from 'node:test';import assert from 'node:assert/strict';
import {mapTimestamps} from '../assets/speed-utils.js';
test('等长对齐：当前时间命中的词索引',()=>{
  const ts=[{begin_time:0,end_time:500},{begin_time:500,end_time:1000},{begin_time:1000,end_time:2000}];
  assert.equal(mapTimestamps(ts,3,250),0);
  assert.equal(mapTimestamps(ts,3,600),1);
  assert.equal(mapTimestamps(ts,3,1500),2);
});
test('词数不等时按比例映射（归一化）',()=>{
  const ts=[{begin_time:0,end_time:100},{begin_time:100,end_time:200}];
  assert.equal(mapTimestamps(ts,4,50),1);assert.equal(mapTimestamps(ts,4,150),3);
});
test('越界与空时间戳返回-1（回退插值）',()=>{
  assert.equal(mapTimestamps([],3,100),-1);
  assert.equal(mapTimestamps([{begin_time:0,end_time:100}],2,-5),-1);
});
```

- [ ] **Step 2: 确认失败**

Run: `node --test tests/speed-utils.test.mjs` → FAIL（模块不存在）

- [ ] **Step 3: 实现 speed-utils.js**

```js
/* 训练场纯逻辑：阅读速度与 TTS 时间戳映射 */
export function mapTimestamps(ts,tokenCount,seconds){
  if(!Array.isArray(ts)||!ts.length||!tokenCount||!Number.isFinite(seconds)||seconds<0)return -1;
  const first=ts[0].begin_time??0;
  if(seconds*1000<first)return -1;
  let lo=0,hi=ts.length-1,idx=-1;
  const ms=seconds*1000;
  while(lo<=hi){const mid=(lo+hi)>>1;
    if(ms<ts[mid].begin_time)hi=mid-1;
    else if(ms>ts[mid].end_time)lo=mid+1;
    else{idx=mid;break}}
  if(idx<0)idx=Math.max(0,Math.min(ts.length-1,lo-1));
  return tokenCount===ts.length?idx:Math.min(tokenCount-1,Math.round(idx*tokenCount/ts.length));
}
export function wordsPerMinute(wordCount,seconds){return seconds>0?Math.round(wordCount/(seconds/60)):0}
export function countWords(text){return (String(text).trim().match(/[A-Za-z][A-Za-z'’-]*/g)||[]).length}
```

- [ ] **Step 4: 测试通过**

Run: `node --test tests/speed-utils.test.mjs` → PASS

- [ ] **Step 5: 接入 beginWordHighlight 与缓存**

index.html：
1. 顶部 import 行追加 `import {mapTimestamps} from './assets/speed-utils.js?v=20260825'`（并给 legal-speech 的 import 也要保留）。
2. `beginWordHighlight`（第 105 行）整体替换为：
```js
function beginWordHighlight(item,audio){clearWordHighlight();const sentence=$$('.sentence').find(x=>x.dataset.spoken===item.spoken),tokens=sentence?[...sentence.querySelectorAll('.word-token')]:[];if(!tokens.length)return;const ts=Array.isArray(item.timestamps)&&item.timestamps.length?item.timestamps:null;const update=()=>{const t=audio.currentTime;let index;if(ts){index=mapTimestamps(ts,tokens.length,t);if(index<0)index=0}else{const duration=Number.isFinite(audio.duration)&&audio.duration>0?audio.duration:Math.max(1,tokens.length*.32);index=Math.min(tokens.length-1,Math.floor((t/duration)*tokens.length))}tokens.forEach((token,i)=>token.classList.toggle('speaking',i===index))};update();highlightTimer=setInterval(update,80)}
```
3. 缓存带时间戳：`getCachedSpeech`/`putCachedSpeech`（第 102-103 行）改为双条目方案——blob 存原 key，时间戳存 `${key}__ts`（JSON Response）。替换两个函数体：
```js
async function getCachedSpeech(provider,model,text){const key=await cacheKey(provider,model,text);if(memorySpeechCache.has(key)){const hit=memorySpeechCache.get(key);return {blob:hit.blob,timestamps:hit.timestamps||[]}}try{if('caches'in globalThis){const cache=await caches.open(speechCacheName);const audioHit=await cache.match(key),tsHit=await cache.match(key+'__ts');if(audioHit){const blob=await audioHit.blob();let timestamps=[];if(tsHit){try{timestamps=JSON.parse(await tsHit.text())}catch{}}memorySpeechCache.set(key,{blob,timestamps});return {blob,timestamps}}}}catch{}return null}
async function putCachedSpeech(provider,model,text,blob,timestamps){const key=await cacheKey(provider,model,text);memorySpeechCache.set(key,{blob,timestamps:timestamps||[]});try{if('caches'in globalThis){const cache=await caches.open(speechCacheName);await cache.put(key,new Response(blob,{headers:{'Content-Type':blob.type||'audio/mpeg'}}));if(timestamps?.length)await cache.put(key+'__ts',new Response(JSON.stringify(timestamps),{headers:{'Content-Type':'application/json'}}))}}catch{}}
```
4. 找到 `speechCacheName` 常量定义处，版本号后缀 +1（如 `v1`→`v2`），旧缓存自动失效。
5. `apiSpeech` 内 `putCachedSpeech('minimax',model,unit.spoken,blob)` 改为 `putCachedSpeech('minimax',model,unit.spoken,blob,timestamps)`；`localSpeech` 同理传 `[]`。`speak`/`playQueue` 链路中消费 `{blob,timestamps}`（playQueue 第 108 行 `item.blob` 已兼容，无需改）。

- [ ] **Step 6: 浏览器验证（关键人工点）**

本地起服务，打开第 9 页，点"朗读本页"。观察：句中逗号停顿后高亮不再超前；长词（如 *constitutional*）期间高亮停留。再点第二次（命中缓存）验证时间戳仍在（Network 面板无新 t2a 请求且同步依旧准）。

- [ ] **Step 7: Commit**

```bash
git add assets/speed-utils.js tests/speed-utils.test.mjs index.html && git commit -m "fix: 逐词高亮改用MiniMax时间戳，缓存携带时间戳"
```

> **实施偏差记录（已验证）**：MiniMax 非流式响应不含内联 subtitles，仅返回 `data.subtitle_file`（OSS 签名 URL，带 `ACAO:*` 可浏览器直取）。实现为 `apiSpeech` 抓取该 URL 解析 `timestamped_words[{word,time_begin,time_end}]` 转 `{text,begin_time,end_time}`。原计划测试用例存在单位错误（秒/毫秒混用），`mapTimestamps` 实现已改为"段内分数插值 + 秒入参"，测试用例同步修正（5 用例全过）。

---

## Milestone 2 · 阅读层（中文按需 + 查词升级）

### Task 4: 中文段落按需展开 + 展开计数（规格 4.1）

**Files:**
- Modify: `index.html`（renderBlock zh 分支 + CSS）

- [ ] **Step 1: zh 块改为折叠态**

`renderBlock`（第 88 行）中 `if(block.lang==='en')renderEnglish(...) else content.textContent=text` 的 else 分支替换为：
```js
else{content.classList.add('zh-collapsed');const zhText=document.createElement('p');zhText.textContent=text;content.appendChild(zhText);const toggle=document.createElement('button');toggle.type='button';toggle.className='zh-toggle';toggle.textContent='文 中文参考';toggle.onclick=()=>{const open=content.classList.toggle('zh-open');toggle.textContent=open?'文 收起中文':'文 中文参考';if(open){store.zhExpand.total+=1;store.zhExpand.byPage[block.id]= (store.zhExpand.byPage[block.id]||0)+1;save()}};content.appendChild(toggle)}
```

- [ ] **Step 2: CSS**

index.html `<style>` 内追加：
```css
.block-text.zh-collapsed p{display:none}.block-text.zh-collapsed.zh-open p{display:block;margin:0;font-size:13.5px;line-height:1.9;color:#414b63;background:#f6f8fc;border-left:2px solid #c9d4ea;padding:8px 12px;border-radius:0 8px 8px 0}
.zh-toggle{margin-top:2px;border:1px dashed #b9c5dd;background:#fff;color:#7c88a3;font-size:10.5px;border-radius:8px;padding:3px 10px;cursor:pointer}
.zh-toggle:hover{color:#3d4a68;border-color:#8fa3c8}
```

- [ ] **Step 3: 浏览器验证**

打开任一页：中文块默认只显示虚线小按钮；点击展开、再点收起；localStorage `usbar-studio-v2` 的 `zhExpand.total` 递增；刷新后仍为折叠态。

- [ ] **Step 4: Commit**

```bash
git add index.html && git commit -m "feat: 中文段落按需展开并计数（断翻译依赖）"
```

### Task 5: 法律义项词典 overlay + 查词升级 + 查词记录（规格 4.2）

**Files:**
- Create: `tools/llm.mjs`（MiniMax chat 调用助手，Task 6 复用）
- Create: `tools/gen-legal-overlay.mjs`
- Create: `assets/legal-overlay.json`（生成产物）
- Modify: `index.html`（showWord）

- [ ] **Step 1: 写 LLM 助手**

`tools/llm.mjs`：
```js
const BASE='https://api.minimaxi.com/v1/text/chatcompletion_v2';
export async function chat(messages,{model=process.env.GRADING_MODEL||'MiniMax-Text-01',temperature=0.2,max_tokens=2000}={}){
  const key=process.env.MINIMAX_API_KEY;if(!key)throw Error('需要 MINIMAX_API_KEY 环境变量');
  const res=await fetch(BASE,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages,temperature,max_tokens})});
  const data=await res.json();
  if(!res.ok||data.base_resp?.status_code)throw Error(data.base_resp?.status_msg||`MiniMax ${res.status}`);
  return data.choices[0].message.content;
}
export async function chatJSON(messages,opts){const raw=await chat(messages,opts);const m=raw.match(/\{[\s\S]*\}/);if(!m)throw Error('LLM 未返回 JSON');return JSON.parse(m[0])}
```

- [ ] **Step 2: 写 overlay 生成脚本**

`tools/gen-legal-overlay.mjs`（用法：`node tools/gen-legal-overlay.mjs 1 10` 生成第 1-10 页，追加进 JSON）：
```js
import {chatJSON} from './llm.mjs';
import fs from 'node:fs';
const [from,to]=process.argv.slice(2).map(Number);
const course=JSON.parse(fs.readFileSync('assets/course-content.json','utf8'));
const pages=course.pages.filter(p=>p.page>=from&&p.page<=to);
const out=JSON.parse(fs.readFileSync('assets/legal-overlay.json','utf8').catch(()=>'{}'));
for(const page of pages){
  const en=page.blocks.filter(b=>b.lang==='en').map(b=>b.text).join('\n').slice(0,6000);
  const prompt=[{role:'system',content:'You are a legal-English lexicographer for Chinese LLM bar candidates. Output strict JSON.'},
  {role:'user',content:`From this bar-review page, pick the 8-12 English terms where the LEGAL sense differs from or refines the general sense (e.g. establishment, sustain, consideration). Return JSON: {"terms":[{"word":"lowercase-key","display":"Original Form","phonetic":"","legalTranslation":"中文法律义","legalNote":"one-line EN note","generalTrap":"通用义为什么误导，中文"}]}. Page ${page.page} text:\n${en}`}];
  const r=await chatJSON(prompt);
  out[page.page]=r.terms;fs.writeFileSync('assets/legal-overlay.json',JSON.stringify(out,null,1));
  console.log(`page ${page.page}: ${r.terms.length} terms`);
}
```

- [ ] **Step 3: 运行生成（分批）**

Run（需 `MINIMAX_API_KEY`，从 SCF 环境变量或用户处取）：
```bash
cd /tmp/mbe-study-site && node tools/gen-legal-overlay.mjs 1 20 && node tools/gen-legal-overlay.mjs 21 40 && node tools/gen-legal-overlay.mjs 41 51
```
Expected: `assets/legal-overlay.json` 含 51 页词条；总条目 400-600。

- [ ] **Step 4: 人工抽查（质量门）**

随机抽 5 页各 2 词：确认 legalTranslation 准确（如 consideration=对价）、generalTrap 有教学价值。不合格的页重跑该页范围。

- [ ] **Step 5: showWord 法律义项优先 + 查词记录**

index.html：模块顶部 fetch 区并行加载 `fetch("assets/legal-overlay.json?v=20260825").then(r=>r.json())` 存为 `legalOverlay`。`showWord`（第 95 行）开头追加：
```js
const overlay=(legalOverlay[store.page]||[]).find(t=>t.word===word||t.word===base);
const note={word:base,page:store.page,count:(store.lookupLog[base]?.count||0)+1,lastAt:Date.now()};store.lookupLog[base]=note;save();
```
原 `const entry=pageOneGlossary[word]||...` 改为 `const entry=overlay||pageOneGlossary[word]||dictionary.entries[word]||dictionary.entries[base]`；法律释义块的渲染条件 `legal?` 保持（overlay 项同样有 legalTranslation/legalNote 字段即自动生效）；`source` 说明文案追加 `；法律义项来自 per-page legal overlay`。

- [ ] **Step 6: 浏览器验证**

打开第 9 页点 *content-based*：释义面板顶部出现"本页法律含义"（overlay 命中）；点普通词（如 *government*）：无法律块、`lookupLog` 记录 +1；同页同词再点，count=2（老师面板重复率数据源）。

- [ ] **Step 7: Commit**

```bash
git add tools/ assets/legal-overlay.json index.html && git commit -m "feat: 法律义项overlay优先+查词记录入review数据源"
```

> **实施偏差记录（已完成）**：本地无 MINIMAX_API_KEY，试运行页 9–16 的 overlay 词条改为人工撰写（每页 10 词，含 display/phonetic/legalTranslation/legalNote/generalTrap），7–8 页为目录页无需覆盖；showWord 渲染在计划基础上增加"通用义陷阱"独立块与动态 PAGE 编号标签，`lookupLog` 按计划落地（Playwright verify-t5 全过）。全开 51 页时再跑 `tools/gen-legal-overlay.mjs` 补齐。

---

## Milestone 3 · AI 批改管线 + 复述

### Task 6: 批改端点（代理扩展 + 部署 + 联调）

**Files:**
- Modify: `server/minimax-proxy.mjs`
- Modify: `index.html`（App.grade）

- [ ] **Step 1: 代理加 grade 路由**

`server/minimax-proxy.mjs`：在 `if (req.method !== 'POST' || req.url !== '/tts')` 之前插入：
```js
  const isTts = req.url === '/tts';
  if (req.method === 'POST' && isTts) {
    let raw = '';
    for await (const chunk of req) { raw += chunk; if (raw.length > 30_000) return json(res, 413, { error: 'Request is too large' }); }
    let input; try { input = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    if (input.action === 'grade') return handleGrade(input, res);
  }
```
文件末尾（server.listen 前）追加：
```js
async function handleGrade(input, res) {
  if (!apiKey) return json(res, 503, { error: 'MINIMAX_API_KEY is not configured' });
  const kind = input.kind === 'sentence' ? 'sentence' : 'retell';
  const answer = String(input.answer || '').trim();
  if (!answer || answer.length > 4000) return json(res, 400, { error: 'answer must contain 1-4000 characters' });
  const system = kind === 'retell'
    ? 'You grade a Chinese LLM bar candidate\'s English restatement of a US law rule. Respond ONLY with JSON: {"term_issues":[{"issue":"...","fix":"..."}],"style_issues":[{"issue":"...","fix":"..."}],"rewrite":"native 2-3 sentence model answer","term_accuracy":0-100}. Rules: English only; no chatting; flag wrong/missing legal terms (term_issues), unidiomatic or translated-from-Chinese phrasing (style_issues); rewrite must be model legal English; term_accuracy = share of key terms used correctly.'
    : 'You judge one sentence written by a Chinese LLM bar candidate using a target legal word. Respond ONLY with JSON: {"correct":true/false,"issue":"empty if correct","suggestion":"corrected sentence if wrong"}. English only.';
  const user = kind === 'retell'
    ? `Concept: ${input.concept}\nPrompt: ${input.prompt}\nReference points: ${input.reference}\nCandidate answer: ${answer}`
    : `Target word: ${input.word}\nCandidate sentence: ${answer}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const upstream = await fetch('https://api.minimaxi.com/v1/text/chatcompletion_v2', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.GRADING_MODEL || 'MiniMax-Text-01', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 1200 }),
      });
      const payload = await upstream.json();
      const content = payload.choices?.[0]?.message?.content || '';
      if (!upstream.ok || payload.base_resp?.status_code) return json(res, 502, { error: payload.base_resp?.status_msg || `MiniMax ${upstream.status}` });
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('no JSON in model output');
      return json(res, 200, { feedback: JSON.parse(m[0]) });
    } catch (e) { if (attempt === 1) return json(res, 502, { error: `grading failed: ${e.message}` }); }
  }
}
```

- [ ] **Step 2: 本地起服务验证**

Run:
```bash
cd /tmp/mbe-study-site && MINIMAX_API_KEY=<key> ALLOWED_ORIGIN='http://localhost:8931' node server/minimax-proxy.mjs &
curl -s localhost:9000/tts -H 'content-type: application/json' -d '{"action":"grade","kind":"retell","concept":"strict scrutiny","prompt":"Restate the rule in your own words.","reference":"compelling interest; narrowly tailored; no less restrictive alternatives","answer":"Government must have a very good reason and the law must be very very narrow to pass strict scrutiny."}'
```
Expected: `{"feedback":{...term_issues...,"rewrite":"...","term_accuracy":<n>}}`，term_accuracy 为 0-100 数字。

- [ ] **Step 3: 部署到腾讯 SCF**

线上函数即此文件。部署方式：腾讯云控制台 → 云函数 → 该函数（`1434356797-...`）→ 函数代码 → 粘贴新文件 → 部署。（若浏览器自动操作不可用，明确请用户协助粘贴。）环境变量加 `GRADING_MODEL=MiniMax-Text-01`。

- [ ] **Step 4: 线上 curl 验证**

```bash
curl -s https://1434356797-0sb9g9vb7b.ap-guangzhou.tencentscf.com/tts -H 'content-type: application/json' -H 'origin: https://stilesseeklume.github.io' -d '{"action":"grade","kind":"sentence","word":"consideration","answer":"The contract lacks consideration because no benefit was exchanged."}'
```
Expected: `{"feedback":{"correct":true,...}}`

- [ ] **Step 5: 前端 App.grade**

index.html App 定义中 `grade:null` 替换为：
```js
grade:async payload=>{const r=await fetch(store.apiEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'grade',...payload})});const data=await r.json();if(!r.ok)throw Error(data.error||`grade ${r.status}`);return data.feedback}
```

- [ ] **Step 6: Commit**

```bash
git add server/minimax-proxy.mjs index.html && git commit -m "feat: 代理新增grade批改端点(retell/sentence)+前端grade"
```

### Task 7: 复述任务素材生成（153 条）

**Files:**
- Create: `tools/gen-retell-tasks.mjs`
- Create: `assets/retell-tasks.json`

- [ ] **Step 1: 写生成脚本**

`tools/gen-retell-tasks.mjs`（用法同 overlay，按页范围）：
```js
import {chatJSON} from './llm.mjs';
import fs from 'node:fs';
const [from,to]=process.argv.slice(2).map(Number);
const course=JSON.parse(fs.readFileSync('assets/course-content.json','utf8'));
const out=JSON.parse(fs.readFileSync('assets/retell-tasks.json','utf8').catch(()=>'{}'));
for(const page of course.pages.filter(p=>p.page>=from&&p.page<=to)){
  const en=page.blocks.filter(b=>b.lang==='en').map(b=>b.text).join('\n').slice(0,6000);
  const r=await chatJSON([{role:'system',content:'You design output-practice tasks for a Chinese LLM bar candidate. Strict JSON.'},
  {role:'user',content:`From this bar-review page, create exactly 3 retell tasks on the page's core rules/doctrines. Each: concept (short EN name), prompt (one English sentence telling what to restate — do NOT quote the rule), reference (comma-separated key points a correct answer must hit, EN). Return {"tasks":[{"concept":"...","prompt":"...","reference":"..."}]}. Page text:\n${en}`}]);
  out[page.page]=r.tasks.slice(0,3);fs.writeFileSync('assets/retell-tasks.json',JSON.stringify(out,null,1));
  console.log(`page ${page.page}: ${out[page.page].length} tasks`);
}
```

- [ ] **Step 2: 分批生成 + 抽查**

Run: `node tools/gen-retell-tasks.mjs 1 20 && node tools/gen-retell-tasks.mjs 21 40 && node tools/gen-retell-tasks.mjs 41 51`
抽查标准（每 10 页抽 1 页）：任务确实对应本页核心规则；prompt 没有直接引用规则原文；reference 要点可判分。不合格页重跑。

- [ ] **Step 3: Commit**

```bash
git add tools/gen-retell-tasks.mjs assets/retell-tasks.json && git commit -m "feat: 51页复述任务素材(153条)预生成"
```

> **实施偏差记录（已完成）**：同 overlay，试运行页 9–16 的 24 条复述任务人工撰写；生成脚本已就绪供全开时使用。T8 修正两处计划问题：①tasks 需按当前页动态读取（原版在 init 时捕获一次，切页不刷新）；②完成门检对无任务页（7–8 目录页）放行，否则目录页永远无法标记完成。批改不可用时保存草稿+提示重试（本地经 server/mock-grader.mjs 端到端验证全过）。

### Task 8: 复述 UI + 完成绑定 + 事件

**Files:**
- Create: `assets/retell.js`
- Modify: `index.html`（加载模块 + 完成按钮区）

- [ ] **Step 1: 写 retell 模块**

`assets/retell.js`（完整实现；CSS 由模块注入）：
```js
/* 复述驱动输出：每页3任务，AI批改，完成绑定 */
export function initRetell(App){
  const {store,save,toast,$}=App;
  const style=document.createElement('style');
  style.textContent=`#retellCard{border:1px solid #dfe5f0;border-radius:16px;background:#fbfcff;margin:26px 0 0;overflow:hidden}
  #retellCard h3{margin:0;padding:16px 20px 4px;font-size:15px;color:#152344}
  #retellCard .sub{padding:0 20px 12px;font-size:11px;color:#6e7890}
  .retell-task{border-top:1px solid #edf0f5;padding:14px 20px}
  .retell-task .concept{font-weight:800;color:#101b35;font-size:13px}
  .retell-task .prompt{font-size:11.5px;color:#5d6884;margin:4px 0 8px;line-height:1.6}
  .retell-task textarea{width:100%;min-height:70px;border:1px solid #cfd8ea;border-radius:10px;padding:9px 11px;font:inherit;font-size:12.5px;resize:vertical;box-sizing:border-box}
  .retell-task .actions{display:flex;gap:8px;margin-top:8px;align-items:center}
  .retell-task button{border:0;border-radius:9px;background:#101b35;color:#fff;padding:8px 16px;font-size:11.5px;font-weight:700;cursor:pointer}
  .retell-task button:disabled{background:#9aa5bd;cursor:default}
  .retell-fb{margin-top:10px;border-left:2px solid #63c7a6;background:#f2fbf7;padding:9px 12px;border-radius:0 9px 9px 0;font-size:12px;line-height:1.7;color:#2d4a3f}
  .retell-fb b{color:#16785c}
  .retell-fb .rw{display:block;margin-top:6px;font-family:Georgia,serif;color:#1c2c4d}
  .retell-fb .acc{float:right;font-weight:800;color:#16785c}`;
  document.head.appendChild(style);
  let tasks=window.RETELL_TASKS?.[store.page]||null;
  function log(){return store.retellLog[store.page]||{}}
  function doneCount(){return tasks?Object.keys(log()).filter(k=>log()[k]?.feedback).length:0}
  function render(){
    const host=$('#retellHost');if(!host)return;
    if(!tasks){host.innerHTML='';return}
    host.innerHTML=`<section id="retellCard"><h3>Restate the Rules · 复述输出</h3><div class="sub">凭理解用自己的英文重述——不给原文。完成 ${doneCount()}/3 后本页才算完成。</div>${tasks.map((t,i)=>taskHtml(t,i)).join('')}</section>`;
    tasks.forEach((t,i)=>wire(t,i));
  }
  function taskHtml(t,i){const saved=log()[i]||{};
    return `<div class="retell-task"><div class="concept">${i+1}. ${esc(t.concept)}</div><div class="prompt">${esc(t.prompt)}</div>
    <textarea id="rtA${i}" ${saved.feedback?'disabled':''}>${esc(saved.answer||'')}</textarea>
    <div class="actions"><button id="rtB${i}" ${saved.feedback?'disabled':''}>${saved.feedback?'✓ Graded':'Submit'}</button></div>
    ${saved.feedback?feedbackHtml(saved.feedback):''}</div>`}
  function feedbackHtml(f){return `<div class="retell-fb"><span class="acc">${f.term_accuracy ?? '—'}</span>
    ${f.term_issues?.length?`<div><b>Terms</b><br>${f.term_issues.map(x=>esc(x.issue)+' → <i>'+esc(x.fix)+'</i>').join('<br>')}</div>`:''}
    ${f.style_issues?.length?`<div style="margin-top:6px"><b>Style</b><br>${f.style_issues.map(x=>esc(x.issue)+' → <i>'+esc(x.fix)+'</i>').join('<br>')}</div>`:''}
    <span class="rw">✦ ${esc(f.rewrite||'')}</span></div>`}
  function wire(t,i){const b=$('#rtB'+i);if(!b||b.disabled)return;b.onclick=async()=>{
    const answer=$('#rtA'+i).value.trim();if(answer.split(/\s+/).length<10){toast('再写完整一点——至少10词');return}
    b.disabled=true;b.textContent='Grading…';
    try{const feedback=await App.grade({kind:'retell',concept:t.concept,prompt:t.prompt,reference:t.reference,answer});
      store.retellLog[store.page]={...log(),[i]:{answer,feedback,time:Date.now()}};save();
      window.CloudSync?.logEvent?.('retell',`${t.concept} · acc ${feedback.term_accuracy}`);
      render();if(doneCount()>=3&&!store.completed.includes(store.page)){store.completed.push(store.page);save();App.renderDocument();toast('输出闭环完成，本页已标记 ✓')}
    }catch(e){b.disabled=false;b.textContent='Submit';toast('批改暂不可用：已保存草稿，稍后重试');store.retellLog[store.page]={...log(),[i]:{answer}};save()}}
  }
  function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
  App.refreshRetell=render;
  window.addEventListener('usbar:page',render);render();
}
```

- [ ] **Step 2: index.html 接线**

1. 顶部并行 fetch 追加 `fetch("assets/retell-tasks.json?v=20260825").then(r=>r.json())`，结果挂 `window.RETELL_TASKS`。
2. `renderDocument` 末尾：`$("#retellHost")`（若 DOM 无此节点，在 `#document` 容器 append `<div id="retellHost"></div>`——直接在 renderDocument 里 `if(!$('#retellHost')){const d=document.createElement('div');d.id='retellHost';documentHost.after(d)}`）；然后 `App.refreshRetell?.()`。
3. `renderDocument` 内页码切换后派发 `window.dispatchEvent(new Event('usbar:page'))`。
4. 加载模块：`import {initRetell} from './assets/retell.js?v=20260825'`，在 App 建立后 `usbarRegister(initRetell)`。
5. "完成本页"按钮 `#completePage` 的 onclick 改为：若 `doneCount()<3` → `toast('先完成 3 条复述，本页才算完成')`（复述模块通过 `App.setCompleteGate(fn)` 注入门检；retell.js init 末尾加 `App.setCompleteGate=fn=>{window.__retellGate=fn}` 并在 index.html 完成按钮处调 `window.__retellGate?.()` 返回 boolean 决定放行）。简化实现：retell.js init 里 `App.completeGate=()=>doneCount()>=3`；index.html 完成回调开头 `if(window.CloudSync&&App.completeGate&&!App.completeGate()){toast('先完成 3 条复述再标记完成');return}`。

- [ ] **Step 3: 浏览器验证**

第 9 页滚到底：出现复述卡（3 任务）；写一段提交 → 约 3-8 秒返回反馈（Terms/Style/rewrite + 分数）；3 条全部 Graded → 完成本页自动 ✓；未完成时点"完成本页"被拦截 toast。断网提交 → 草稿保存 + toast，不阻塞。

- [ ] **Step 4: 导出 CloudSync.logEvent（事件上报）**

cloud-sync.js 内部已有 study_events 写入逻辑（老师面板能看到 login/complete/note/word 事件即证明）。grep 定位：`rg -n "study_events" assets/cloud-sync.js`，找到写事件的内部函数（形如 `function logEvent(kind, detail)` 或内联 fetch）。做两件事：
1. 若该函数未导出，在 `window.CloudSync = {...}` 对象里追加 `logEvent: logEvent`（用实际函数名）。
2. 若事件 kind 是在调用点硬编码的（无白名单），则直接可用；retell/review/reading/calibration 新 kind 无需 schema 变更（表列 kind 为 text）。
浏览器验证：console 执行 `CloudSync.logEvent('retell','test')`，Supabase study_events 出现该行（或 teacher.html 动态流 60 秒内出现）。

- [ ] **Step 5: Commit**

```bash
git add assets/retell.js index.html assets/cloud-sync.js && git commit -m "feat: 复述练习UI+AI批改闭环+完成页绑定"
```

---

## Milestone 4 · 复习队列

### Task 9: SM-2 引擎 + 复习 UI（三源合一）

**Files:**
- Create: `assets/review-engine.js`（纯逻辑）
- Test: `tests/review-engine.test.mjs`
- Create: `assets/review.js`（UI）

- [ ] **Step 1: 写失败测试**

`tests/review-engine.test.mjs`：
```js
import test from 'node:test';import assert from 'node:assert/strict';
import {schedule,mastered,dueToday,pickDaily} from '../assets/review-engine.js';
const item={interval:0,streak:0,status:'reviewing'};
test('答对间隔阶梯 1→3→7→16→35',()=>{
  assert.equal(schedule(item,true).interval,1);
  assert.equal(schedule({interval:1,streak:1},true).interval,3);
  assert.equal(schedule({interval:3,streak:2},true).interval,7);
  assert.equal(schedule({interval:7,streak:3},true).interval,16);
  assert.equal(schedule({interval:16,streak:4},true).interval,35);
});
test('答错归零',()=>{const r=schedule({interval:16,streak:4},false);assert.equal(r.interval,0);assert.equal(r.streak,0)});
test('streak≥5 毕业',()=>{assert.equal(mastered({streak:5}),true);assert.equal(mastered({streak:4}),false)});
test('dueToday 按 dueAt 过滤',()=>{const now=Date.now();
  assert.equal(dueToday([{id:'a',dueAt:now-1},{id:'b',dueAt:now+9e6}],now).length,1)});
test('每日限量默认8',()=>{const now=Date.now(),items=Array.from({length:20},(_,i)=>({id:'w'+i,dueAt:now-1}));
  assert.equal(pickDaily(items,now).length,8)});
```

- [ ] **Step 2: 确认失败** → `node --test tests/review-engine.test.mjs` FAIL

- [ ] **Step 3: 实现引擎**

`assets/review-engine.js`：
```js
/* 简化 SM-2：阶梯间隔，答错归零，streak≥5 毕业 */
const LADDER=[1,3,7,16,35];
export function schedule(item,correct){
  if(!correct)return {...item,interval:0,streak:0,dueAt:Date.now()+36e5};
  const streak=item.streak+1;
  const interval=LADDER[Math.min(streak-1,LADDER.length-1)]*(streak>LADDER.length?2:1);
  return {...item,streak,interval,dueAt:Date.now()+interval*864e5};
}
export function mastered(item){return item.streak>=5}
export function dueToday(items,now=Date.now()){return items.filter(i=>i.status!=='mastered'&&i.dueAt<=now)}
export function pickDaily(items,now=Date.now(),limit=8){return dueToday(items,now).slice(0,limit)}
export function upsert(items,entry){const i=items.findIndex(x=>x.id===entry.id);if(i>=0)items[i]={...items[i],...entry};else items.push(entry);return items}
```

- [ ] **Step 4: 测试通过** → PASS

- [ ] **Step 5: 复习 UI 模块**

`assets/review.js`：Dock 新增"复习"tab 或独立卡片（选独立卡片 `#reviewHost` 插入 `#retellHost` 之后，同页面流）。核心流程：
```js
/* 三源复习队列 UI：语境还原(挖空) + 一词一造(AI判)，SM-2 调度 */
import {schedule,mastered,dueToday,pickDaily,upsert} from './review-engine.js?v=20260825';
export function initReview(App){
  const {store,save,toast,$}=App;const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  // 三个来源的入队口，挂在 App 上供其他模块调用：
  App.enqueueReview=(entry)=>{ // {id,word,type:'word',source,contextSentence}
    if(mastered(store.reviewQueue.find(x=>x.id===entry.id)||{}))return;
    upsert(store.reviewQueue,{interval:0,streak:0,status:'reviewing',dueAt:0,...entry});save();renderBadge()};
  function renderBadge(){const n=dueToday(store.reviewQueue).length;const b=$('#reviewEntry');if(b)b.querySelector('.n').textContent=n||'';b.classList.toggle('has',n>0)}
  function norm(a){return String(a||'').toLowerCase().replace(/[^a-z'-]/g,'').replace(/(es|ed|ing|s)$/,'')}
  let queue=[],idx=0,right=0;
  function renderCard(){
    const item=queue[idx];
    if(!item){const pct=Math.round(right/Math.max(1,queue.length)*100);
      $('#reviewHost').innerHTML=`<section id="retellCard"><h3>Review Done</h3><div class="sub">${right}/${queue.length} 正确 · 明天见</div></section>`;
      window.CloudSync?.logEvent?.('review',`${right}/${queue.length}`);renderBadge();return}
    const cloze=(item.contextSentence||'').replace(new RegExp(item.word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),'＿＿＿');
    const mode=idx%2?'write':'cloze';
    $('#reviewHost').innerHTML=`<section id="retellCard"><h3>Review · ${idx+1}/${queue.length}</h3>
      <div class="sub">${mode==='cloze'?'语境还原：把词填回去':'一词一造：用这个词写一句（AI 判）'}</div>
      <div class="retell-task"><div class="concept">${esc(item.word)}</div>
      <div class="prompt">${mode==='cloze'?esc(cloze):'Write one sentence using this word.'}</div>
      ${mode==='cloze'?`<input id="rvIn" style="width:100%;padding:8px 11px;border:1px solid #cfd8ea;border-radius:10px;font:inherit">`:`<textarea id="rvIn" style="width:100%;min-height:60px;border:1px solid #cfd8ea;border-radius:10px;padding:9px 11px;font:inherit;box-sizing:border-box"></textarea>`}
      <div class="actions"><button id="rvGo">Check</button><button id="rvSkip" style="background:#6e7890">跳过(记错)</button></div>
      <div id="rvFb"></div></div></section>`;
    $('#rvGo').onclick=async()=>await judge(item,mode);
    $('#rvSkip').onclick=async()=>{await finish(item,false)};
  }
  async function judge(item,mode){
    const val=$('#rvIn').value.trim();if(!val){toast('先作答');return}
    if(mode==='cloze'){await finish(item,norm(val)===norm(item.word));return}
    $('#rvGo').disabled=true;$('#rvGo').textContent='…';
    try{const f=await App.grade({kind:'sentence',word:item.word,answer:val});await finish(item,Boolean(f.correct),f)}
    catch(e){$('#rvGo').disabled=false;$('#rvGo').textContent='Check';toast('AI 暂不可用，稍后重试')}
  }
  async function finish(item,correct,f){
    if(correct)right+=1;
    const updated=schedule(store.reviewQueue.find(x=>x.id===item.id),correct);
    if(mastered(updated)){updated.status='mastered';toast(`🎓 ${item.word} 毕业！`)}
    upsert(store.reviewQueue,updated);save();
    $('#rvFb').innerHTML=f?`<div class="retell-fb">${f.correct?'✓ '+esc(f.suggestion||''):'✗ '+esc(f.issue||'')+'<br><i>'+esc(f.suggestion||'')+'</i>'}</div>`:`<div class="retell-fb">${correct?'✓ 正确':'✗ 再想想'}</div>`;
    setTimeout(()=>{idx+=1;renderCard()},900);
  }
  function start(){const items=pickDaily(store.reviewQueue);if(!items.length){toast('今天没有到期的复习');return}queue=items;idx=0;right=0;renderCard();window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})}
  // 入口：侧栏 rail-foot 上方插 <button id="reviewEntry" class="pill">复习 <span class=n></span></button>，onclick=start
  const entry=document.createElement('button');entry.id='reviewEntry';entry.className='pill';entry.style.cssText='margin:8px 6px;width:calc(100% - 12px)';entry.innerHTML='↻ 复习 <span class="n" style="background:#f3b7a9;color:#5a2018;border-radius:8px;padding:1px 7px;margin-left:4px"></span>';entry.onclick=start;
  const foot=document.querySelector('.rail-foot');foot?.parentNode?.insertBefore(entry,foot);
  renderBadge();
}
```

- [ ] **Step 6: 三源接线**

1. **查词来源**：Task 5 的 showWord 记录后调 `App.enqueueReview?.({id:'w:'+base,word:base,type:'word',source:'lookup',contextSentence:当前句})`——注意用可选调用（enqueueReview 在 Task 9 才定义，运行时序上用户点词晚于模块初始化，安全）。当前句从 appendTokens 的 onclick 传：`node.onclick=e=>{e.stopPropagation();showWord(value,e.target.closest('.sentence')?.textContent||'')}`，showWord 增加第二参 context。
2. **收藏来源**：`#saveWord` onclick 里已 toggles savedWords；加入时同步 `App.enqueueReview({...source:'saved'...})`。
3. **纠错来源**：retell.js 批改成功后，`feedback.term_issues` 每项 `App.enqueueReview({id:'c:'+hash(fix),word:fix,type:'chunk',source:'corrected',contextSentence:fix})`。

- [ ] **Step 7: 浏览器验证**

造 3 条数据（查 1 词、收藏 1 词、提交 1 复述）→ 复习入口角标 =3；开始复习 → 挖空题答对间隔变 1、答错归零（console 检查 store.reviewQueue）；造句题走 grade；streak 到 5（用 console 手动改数据验证）→ status master、角标减一。

- [ ] **Step 8: Commit**

```bash
git add assets/review-engine.js assets/review.js tests/review-engine.test.mjs index.html && git commit -m "feat: 三源复习队列+SM-2调度+每日限量"
```

---

## Milestone 5 · 校准 + 速度训练

### Task 10: 校准流程（规格 4.9）

**Files:**
- Create: `tools/gen-calibration.mjs`
- Create: `assets/calibration.json`
- Create: `assets/calibrate.js`

> **实施偏差记录（已完成）**：本地无 MINIMAX_API_KEY，校准素材人工撰写——article 取第 10 页 standing 规则+Sierra Club 案 7 段共 279 词（第 9 页为目录式概览，不适合"复述核心规则"），3 道理解题与 20 道法律义项题（正确义取 overlay legalTranslation，干扰义取词典通用义）人工编排，答案序号均衡分布（0-3 各 5 题）；生成脚本已就绪供后续重生成。计划代码两处修正：①向导容器改为懒挂载（原版 init 即全屏 append 会遮挡页面）；②重测按钮补 id=calibEntry。（verify-t10 全过：欢迎页入口/三步向导/防扫读门/中断恢复/profile 快速分支配置/4 周重测门）

- [ ] **Step 1: 生成校准素材**

`tools/gen-calibration.mjs`：从 course-content 第 9 页取 3 个连续 EN 段落（约 300 词）为 article；用 chatJSON 让 LLM 出 3 道四选一理解题 `{q,options:[4],answer:idx}`；再从 legal-overlay 全体词条抽 20 个多义法律词，每词出题 `{word, options:[正确法律义, 3个通用义/干扰义], answer:idx}`（干扰义取 dictionary.general translation）。输出 `assets/calibration.json` `{article:{text,words}, comprehension:[3], vocab:[20]}`。运行+抽查同 Task 7。

- [ ] **Step 2: 校准 UI 模块**

`assets/calibrate.js`：
```js
/* 第1周一次性校准：测速→复述基线→词汇覆盖 → profile 自适应 */
import {countWords} from './speed-utils.js?v=20260825';
export function initCalibrate(App){
  const {store,save,toast}=App;
  const data=window.CALIBRATION;if(!data)return;
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const entryHost=document.querySelector('.rail-foot')?.parentNode;
  if(store.profile){ // 4 周重测入口
    const again=document.createElement('button');again.className='pill';again.style.cssText='margin:6px 6px;width:calc(100% - 12px)';again.textContent='↻ 重新校准';
    again.onclick=()=>{if(Date.now()-store.profile.date>28*864e5||confirm('距上次校准不足 4 周，仍要重测？')){store.profile=null;save();location.reload()}};
    entryHost?.insertBefore(again,document.querySelector('.rail-foot'));return}
  const wiz=document.createElement('div');wiz.id='calibWiz';
  wiz.style.cssText='position:fixed;inset:0;z-index:110;background:#f2f5fb;overflow:auto;padding:6vh 18px';
  document.body.appendChild(wiz);
  const state=JSON.parse(sessionStorage.getItem('calib')||'{}');
  const persist=()=>sessionStorage.setItem('calib',JSON.stringify(state));
  const $=s=>wiz.querySelector(s);
  function shell(inner){wiz.innerHTML=`<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #dfe5f0;border-radius:18px;padding:28px 30px;box-shadow:0 20px 60px rgba(26,42,74,.10)">${inner}</div>`}
  /* 步骤1 测速（读完→计时停→理解题防扫读） */
  function step1(){shell(`<div style="font-size:10px;letter-spacing:.16em;color:#5f82c8;font-weight:800">CALIBRATION 1/3</div>
    <h2 style="margin:8px 0 4px">阅读测速</h2><p style="color:#6e7890;font-size:12px">点开始后通读全文，读完立刻按"读完了"。别跳读——后面有理解题。</p>
    <button id="cbStart" style="border:0;background:#101b35;color:#fff;border-radius:11px;padding:11px 22px;font-weight:800;cursor:pointer;margin:10px 0">开始计时阅读</button>
    <div id="cbArticle" style="display:${state.t0?'block':'none'};font-family:Georgia,serif;font-size:15px;line-height:1.85;color:#18233a">${esc(data.article.text)}</div>
    <button id="cbDone" style="display:${state.t0?'inline-block':'none'};border:0;background:#16785c;color:#fff;border-radius:11px;padding:11px 22px;font-weight:800;cursor:pointer;margin-top:12px">读完了</button>`);
    $('#cbStart').onclick=()=>{state.t0=Date.now();persist();step1()};
    $('#cbDone').onclick=()=>{state.seconds=(Date.now()-state.t0)/1000;state.wpm=Math.round(countWords(data.article.text)/(state.seconds/60));persist();step1b()}}
  function step1b(){const qs=data.comprehension;
    shell(`<h2>理解检查</h2>${qs.map((q,i)=>`<div style="margin:14px 0"><p style="font-size:13px">${i+1}. ${esc(q.q)}</p>${q.options.map((o,j)=>`<label style="display:block;font-size:12.5px;margin:5px 0"><input type="radio" name="q${i}" value="${j}"> ${esc(o)}</label>`).join('')}</div>`).join('')}<button id="cbNext" style="border:0;background:#101b35;color:#fff;border-radius:10px;padding:10px 20px;font-weight:800;cursor:pointer">提交</button>`);
    $('#cbNext').onclick=()=>{const right=qs.filter((q,i)=>+wiz.querySelector(`input[name=q${i}]:checked`)?.value===q.answer).length;
      if(right<2){toast('理解题未达 2/3，请重测一遍');state.t0=null;persist();step1();return}
      step2()}}
  /* 步骤2 复述基线 */
  function step2(){shell(`<div style="font-size:10px;letter-spacing:.16em;color:#5f82c8;font-weight:800">CALIBRATION 2/3</div>
    <h2>复述基线</h2><p style="color:#6e7890;font-size:12px">用英文 2-3 句概括刚读文章的核心规则。AI 给基线分。</p>
    <textarea id="cbRetell" style="width:100%;min-height:90px;box-sizing:border-box;border:1px solid #cfd8ea;border-radius:10px;padding:10px;font:inherit"></textarea>
    <button id="cbGrade" style="border:0;background:#101b35;color:#fff;border-radius:10px;padding:10px 20px;font-weight:800;cursor:pointer;margin-top:10px">提交批改</button><div id="cbFb"></div>`);
    $('#cbGrade').onclick=async()=>{const answer=$('#cbRetell').value.trim();if(answer.split(/\s+/).length<10){toast('至少写 10 词');return}
      $('#cbGrade').disabled=true;$('#cbGrade').textContent='…';
      try{const f=await App.grade({kind:'retell',concept:'calibration',prompt:'Restate the main rule of the article you just read.',reference:data.article.reference||'',answer});
        state.retellBaseline=f.term_accuracy??0;persist();
        $('#cbFb').innerHTML=`<div style="margin-top:10px;border-left:2px solid #63c7a6;background:#f2fbf7;padding:9px 12px;font-size:12px">基线分 ${state.retellBaseline} · <b>rewrite</b>: ${esc(f.rewrite||'')}</div><button id="cbNext2" style="border:0;background:#101b35;color:#fff;border-radius:10px;padding:10px 20px;font-weight:800;cursor:pointer;margin-top:10px">下一步</button>`;
        $('#cbNext2').onclick=step3}
      catch(e){$('#cbGrade').disabled=false;$('#cbGrade').textContent='提交批改';toast('批改暂不可用，稍后重试')}}}
  /* 步骤3 词汇覆盖 + profile 写入 */
  function step3(){const qs=data.vocab;
    shell(`<div style="font-size:10px;letter-spacing:.16em;color:#5f82c8;font-weight:800">CALIBRATION 3/3</div><h2>法律义项 · 20 题</h2><p style="color:#6e7890;font-size:12px">选这个词在法律语境里的意思。</p>
    ${qs.map((q,i)=>`<div style="margin:12px 0"><b style="font-size:13px">${i+1}. ${esc(q.word)}</b>${q.options.map((o,j)=>`<label style="display:block;font-size:12.5px;margin:4px 0"><input type="radio" name="v${i}" value="${j}"> ${esc(o)}</label>`).join('')}</div>`).join('')}<button id="cbFin" style="border:0;background:#16785c;color:#fff;border-radius:10px;padding:11px 24px;font-weight:800;cursor:pointer">完成校准</button>`);
    $('#cbFin').onclick=()=>{const right=qs.filter((q,i)=>+wiz.querySelector(`input[name=v${i}]:checked`)?.value===q.answer).length;
      const vocabCoverage=Math.round(right/qs.length*100),wpm=state.wpm,rb=state.retellBaseline;
      let config=wpm<100?{audioLoop:true,retellCount:3,reviewDaily:8,timedReading:'required'}:wpm<130?{audioLoop:true,retellCount:3,reviewDaily:8,timedReading:'optional'}:{audioLoop:false,retellCount:3,reviewDaily:10,timedReading:'optional'};
      if(rb>=80)config={...config,retellCount:Math.max(2,config.retellCount-1),counterargument:true};
      store.profile={date:Date.now(),wpm,retellBaseline:rb,vocabCoverage,config};save();
      window.CloudSync?.logEvent?.('calibration',`wpm ${wpm} · retell ${rb} · vocab ${vocabCoverage}%`);
      wiz.remove();sessionStorage.removeItem('calib');toast(`校准完成：${wpm} wpm · 词汇 ${vocabCoverage}%`);location.reload()}}
  // 入口：welcome overlay 显示「⏱ 先做 20 分钟校准」(onclick=step1)；侧栏 rail-foot 前注入按钮
  const btn=document.createElement('button');btn.id='calibEntry';btn.className='pill';btn.style.cssText='margin:6px 6px;width:calc(100% - 12px)';btn.textContent='⏱ 新学员校准（20 分钟）';btn.onclick=step1;
  entryHost?.insertBefore(btn,document.querySelector('.rail-foot'));
  App.startCalibration=step1;
  if(sessionStorage.getItem('calib'))step1(); // 中断恢复
}
```

- [ ] **Step 3: 接线与验证**

index.html 加载 calibration.json → `window.CALIBRATION`；`usbarRegister(initCalibrate)`；welcome overlay 在 `!store.profile` 时显示"先做 20 分钟校准"入口。浏览器验证：清 localStorage → 校准向导出现；三步走完 → `store.profile` 写入、config 符合 wpm 规则；4 周重测入口（profile 按钮"重新校准"→ 清 profile 重跑）。

- [ ] **Step 4: Commit**

```bash
git add tools/gen-calibration.mjs assets/calibration.json assets/calibrate.js index.html && git commit -m "feat: 第1周校准向导(测速/复述基线/词汇覆盖)与自适应profile"
```

### Task 11: 限时阅读 + 音频循环三遍法（规格 4.10/4.11）

**Files:**
- Create: `assets/reading.js`
- Modify: `index.html`（接入）

- [ ] **Step 1: reading 模块**

`assets/reading.js`：
```js
/* 净读计时(每节) + 音频循环三遍法(每页核心节)：读→听→计时重读 */
import {wordsPerMinute,countWords} from './speed-utils.js?v=20260825';
export function initReading(App){
  const {store,save,toast,$,$$}=App;
  const cfg=()=>store.profile?.config||{audioLoop:true,timedReading:'optional'};
  /* A) 每节净读：study-block tools 加 ⏱ 按钮；读完自动挖空验证防扫读 */
  function timedReread(sec){
    const page=App.course.pages.find(p=>p.page===store.page),block=page?.blocks.find(b=>b.id===sec.dataset.block);
    const text=block?block.text:sec.innerText,words=countWords(text),t0=Date.now();
    const layer=document.createElement('div');
    layer.style.cssText='position:fixed;inset:0;z-index:100;background:#fff;overflow:auto;padding:8vh 20px';
    layer.innerHTML=`<div style="max-width:720px;margin:0 auto"><div style="position:sticky;top:0;background:#ffffffeb;backdrop-filter:blur(10px);padding:10px 0;display:flex;gap:10px;align-items:center"><b>净读计时</b><span style="color:#6e7890;font-size:12px">${words} words · 读到本节末尾立刻按按钮</span><button id="trDone" style="margin-left:auto;border:0;background:#16785c;color:#fff;border-radius:10px;padding:9px 18px;font-weight:800;cursor:pointer">读完了</button><button id="trQuit" style="border:1px solid #dfe5f0;background:#fff;border-radius:10px;padding:9px 14px;cursor:pointer">退出</button></div><div style="font-family:Georgia,serif;font-size:15.5px;line-height:1.9;color:#18233a">${text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div></div>`;
    document.body.appendChild(layer);
    const quit=()=>layer.remove();
    layer.querySelector('#trQuit').onclick=quit; // 退出不计
    layer.querySelector('#trDone').onclick=()=>{
      const seconds=(Date.now()-t0)/1000,wpm=wordsPerMinute(words,seconds);
      // 防扫读：取本节最长的一个词挖空，填回才算有效
      const terms=text.match(/[A-Za-z][A-Za-z'’-]{5,}/g)||[],key=terms.sort((a,b)=>b.length-a.length)[0]||'';
      const norm=a=>String(a||'').toLowerCase().replace(/(es|ed|ing|s)$/,'');
      const ok=()=>{store.readingLog.push({page:store.page,section:sec.dataset.block,words,seconds,wpm,pass:3,date:Date.now()});save();
        window.CloudSync?.logEvent?.('reading',`p${store.page} ${wpm}wpm`);quit();toast(`本节 ${wpm} wpm${wpm>=120?' · 已达 MBE 节奏':''}`)};
      if(!key||wpm>400){ok();return} // 无可挖词或明显扫读(wpm>400)直接计为未验证
      layer.innerHTML=`<div style="max-width:520px;margin:12vh auto;background:#fbfcff;border:1px solid #dfe5f0;border-radius:16px;padding:26px 28px"><b>检查一下：本节出现过这个词，拼出来</b><p style="font-family:Georgia,serif;font-size:18px;letter-spacing:.06em;margin:14px 0">${key.replace(/[A-Za-z]/g,'·')}（${key.length} 字母）</p><input id="trKey" style="width:100%;padding:10px 12px;border:1px solid #cfd8ea;border-radius:10px;font:inherit"><div style="margin-top:12px;display:flex;gap:8px"><button id="trOk" style="border:0;background:#101b35;color:#fff;border-radius:10px;padding:9px 18px;font-weight:800;cursor:pointer">提交</button><button id="trSkip" style="border:1px solid #dfe5f0;background:#fff;border-radius:10px;padding:9px 14px;cursor:pointer">想不起来（照常记录）</button></div></div>`;
      layer.querySelector('#trOk').onclick=()=>{if(norm(layer.querySelector('#trKey').value)===norm(key))ok();else{toast('拼写不符——这次先不计，重读一遍再来');quit()}};
      layer.querySelector('#trSkip').onclick=ok};
  }
  // 挂按钮：renderDocument 后给每个 en study-block 的 .block-tools 追加 ⏱
  App.decorateBlocks=()=>{$$('.study-block.en').forEach(sec=>{const tools=sec.querySelector('.block-tools');if(!tools||tools.querySelector('.trBtn'))return;const b=document.createElement('button');b.className='mini trBtn';b.title='净读计时';b.textContent='⏱';b.onclick=()=>timedReread(sec);tools.appendChild(b)})};
  /* B) 三遍法入口条（cfg().audioLoop 才显示） */
  function loopBar(){
    let bar=$('#loopBar');
    if(!cfg().audioLoop){bar?.remove();return}
    if(bar)return;bar=document.createElement('div');bar.id='loopBar';
    bar.style.cssText='display:flex;gap:10px;align-items:center;margin:14px 0 0;padding:12px 16px;border:1px dashed #b9c5dd;border-radius:13px;background:#f8faff;font-size:12px;color:#5d6884';
    bar.innerHTML=`<b style="color:#152344">三遍法训练本页</b><span>①精读(已完成)</span><button id="lp2" style="border:0;background:#101b35;color:#fff;border-radius:9px;padding:7px 14px;cursor:pointer;font-size:11px">② 听+跟高亮</button><span>③ 第一核心节 ⏱ 净读</span>`;
    const meta=$('.lesson-meta');meta?.after(bar);
    bar.querySelector('#lp2').onclick=()=>{App.speak($('#document .study-block.en .block-text')?.innerText||'');toast('跟着逐词高亮走，听完整节')};
    // ③ 直接用第一个 EN 节的 ⏱；给提示即可
  }
  App.refreshReading=()=>{App.decorateBlocks();loopBar()};
  window.addEventListener('usbar:page',App.refreshReading);App.refreshReading();
}
```

- [ ] **Step 2: 接线与验证**

index.html：`import {initReading} from './assets/reading.js?v=20260825'` + `usbarRegister(initReading)`。验证：第 9 页每段 tools 出现 ⏱；净读层计时 → wpm 记录且 localStorage `readingLog` 有新条目；校准 profile wpm≥130 时三遍法条隐藏、<100 显示；readingLog 随 SYNC_KEYS 上云（teacher 面板 Task 13 消费）。

- [ ] **Step 3: Commit**

```bash
git add assets/reading.js index.html && git commit -m "feat: 限时净读+音频循环三遍法(读→听→计时重读)"
```

---

## Milestone 6 · 双面板 + 今日队列

### Task 12: badges 模块 + progress.html（学生成长面板）

**Files:**
- Create: `assets/badges.js`
- Create: `progress.html`
- Modify: `index.html`（侧栏入口）

- [ ] **Step 1: badges 模块**

`assets/badges.js`：
```js
/* 法律梗成就：从 store 事实推导，store.badges 只存已获得 id */
export const BADGES=[
  {id:'motion_granted',name:'Motion Granted',desc:'首次完成复述',test:s=>Object.keys(s.retellLog||{}).length>=1},
  {id:'sustained',name:'Sustained',desc:'连续学习 7 天',test:s=>streakDays(s)>=7},
  {id:'case_closed',name:'Case Closed',desc:'第 10 页输出闭环',test:s=>(s.completed||[]).length>=10},
  {id:'habeas',name:'Habeas Corpus',desc:'10 个词毕业出复习队列',test:s=>(s.reviewQueue||[]).filter(i=>i.status==='mastered').length>=10},
  {id:'certiorari',name:'Certiorari Granted',desc:'单次复述术语准确率 100%',test:s=>Object.values(s.retellLog||{}).flat().some(e=>e?.feedback?.term_accuracy>=100)},
  {id:'lead_foot',name:'Lead Foot',desc:'净读速度破 130 wpm',test:s=>(s.readingLog||[]).some(r=>r.wpm>=130)}];
function streakDays(s){
  const stamps=[...(s.readingLog||[]).map(r=>r.date),...(s.notes||[]).map(n=>Date.parse(n.time)||0),
    ...Object.values(s.retellLog||{}).flatMap(Object.values).map(e=>e?.time||0)].filter(Boolean);
  const days=new Set(stamps.map(t=>new Date(t).toDateString()));
  let n=0,d=new Date();
  while(days.has(d.toDateString())){n++;d.setDate(d.getDate()-1)}
  return n;
}
export function evaluateBadges(store,grant){for(const b of BADGES){if(!store.badges.includes(b.id)&&b.test(store)){store.badges.push(b.id);grant(b)}}}
```
index.html：`save()` 后节流调用 `evaluateBadges(store,b=>toast('🏅 成就解锁：'+b.name))`。

- [ ] **Step 2: progress.html**

单页（复用 teacher.html 的 gate 结构，但**无门禁**——登录学生本人即可）：
- 词汇流转管道：`lookupLog 总数 → reviewQueue reviewing 数 → mastered 数`（三段横条 + 数字）
- wpm 曲线：readingLog 按日期 SVG 折线，画 120-150 目标带（浅绿色带）
- 复述准确率曲线：retellLog 按页取 term_accuracy 均值折线
- 兵器库：reviewQueue `source:'corrected'` 的词条卡片（native 表达 + 来源页）
- 徽章墙：BADGES 网格，未解锁灰显（进度条可选）
- 数据读取：加载 cloud-sync.js → `ready()` → 直接读 localStorage store（同源同浏览器）+ 顶部"☁ 已同步"状态
- 入口：index.html rail-foot 加 `<a href="progress.html">我的成长面板 →</a>`

- [ ] **Step 3: 浏览器验证**

学生账号登录 → progress.html 各区渲染（无数据时显示空态文案）；手动往 localStorage 塞样例数据验证曲线/管道/徽章解锁 toast。

- [ ] **Step 4: Commit**

```bash
git add assets/badges.js progress.html index.html && git commit -m "feat: 学生成长面板(词汇管道/wpm曲线/兵器库/法律梗徽章)"
```

### Task 13: teacher.html 过程面板升级

**Files:**
- Modify: `teacher.html`

- [ ] **Step 1: 新增三个数据区**

teacher.html 的 `load()` 拿到 study_state rows 后（现有代码已 fetch `key,value`），追加渲染（沿用现有 section/card 风格）：
1. **输出质量区**：`retellLog` 每页最新一条 `{answer 原文 | feedback.rewrite}` 并排两栏卡；周聚合 `term_accuracy` 均值趋势（近 4 周，数字+箭头即可，不画图）。
2. **校准与速度区**：`profile`（wpm/基线/词汇覆盖 + date）；`readingLog` wpm 列表（最近 10 条 + 目标带 120-150 说明）。
3. **依赖信号区**：`zhExpand.total`（中文展开总次数）；`lookupLog` 重复查询 Top5（count 降序，count≥3 标红 = 未习得信号）。

- [ ] **Step 2: 验证**

学生端造数据（展开几次中文、查同词 3 次、做 1 页复述、1 次净读）→ teacher.html 三个新区全部出现且数字正确；60 秒自动刷新仍工作。

- [ ] **Step 3: Commit**

```bash
git add teacher.html && git commit -m "feat: 老师面板输出质量/校准速度/依赖信号三区"
```

### Task 14: 今日队列（welcome 升级）+ 部署 + 端到端验收

**Files:**
- Modify: `index.html`（welcome overlay）

- [ ] **Step 1: 今日队列**

welcome overlay（`usbar-kokoro-enabled` 逻辑附近的欢迎层）改为动态内容：
```js
// 今日队列数据：
const next=studyPages.find(p=>!store.completed.includes(p.page))||studyPages[studyPages.length-1];
const dueN=dueToday(store.reviewQueue).length;      // import from review-engine
const retellN=(window.RETELL_TASKS?.[next.page]||[]).length-Object.keys(store.retellLog[next.page]||{}).length;
// 卡片：Today · 第X页 / 复习 N 词待到期 / 复述 N 条待完成 / (!profile)→「20分钟校准」按钮
// 点击第X页 → store.page=next.page; save(); renderAll(); 关闭 overlay
```

- [ ] **Step 2: 端到端验收（本地）**

按学生完整路径走一遍：新 localStorage → 登录 → 校准 20 分钟 → 今日队列进第 9 页 → 精读（查词/展开中文/收藏）→ ⏱ 净读 → 三遍法 → 3 条复述 AI 批改 → 自动完成 ✓ → 复习 3+ 词 → progress.html 各区有数据 → teacher.html（老师账号）三区正确。任一环节卡住即修复后再继续。

- [ ] **Step 3: 部署上线**

```bash
cd /tmp/mbe-study-site && git add -A && git commit -m "feat: 今日队列+端到端验收" && git push origin main
```
等 GitHub Pages 构建后，线上重复 Step 2 的关键路径抽查（校准可跳过：线上已有 profile 的浏览器）。

- [ ] **Step 4: 更新文档**

`SUPABASE_SETUP.md` 追加：新数据键说明、grade 端点、校准/复习/净读的师生使用说明（各 3-5 行）。

- [ ] **Step 5: Commit & 收尾**

```bash
git add SUPABASE_SETUP.md && git commit -m "docs: 训练场使用说明" && git push origin main
```

---

## 任务依赖图

```
T1 解锁51页 ─┬─ T2 状态键/App ─┬─ T3 TTS修复 ── T11 三遍法
             │                 ├─ T4 中文折叠 ─┐
             │                 ├─ T5 overlay ──┤─ T9 复习队列(三源)
             │                 ├─ T6 grade端点 ─┬─ T7 复述素材 ─ T8 复述UI ─┤
             │                 │                └─ T9 造句判分 ────────────┤
             │                 ├─ T10 校准 ─── T11 限时阅读
             │                 └─ T12 徽章/progress ←(T7/T8/T9/T11 数据)
             │                 T13 teacher升级 ←(同上)
             └─ T14 今日队列+端到端（最后）
```

## 风险与对策

- **全开时机与标准（用户已确认流程）**：试运行 1–2 周后老师查看三信号——复述完成率（目标 ≥70%）、复习到期完成率（目标 ≥60%）、学生主观反馈；达标即把 `OPEN_FROM=1,OPEN_TO=51` 一行改动推上线（第 1–6 页为封面/目录，可顺带开放或保持关闭，由老师定）。
- **SCF 部署需用户协助**：Task 6 Step 3 若浏览器操作腾讯控制台受阻，先本地验证代码正确性，请用户粘贴部署（3 分钟），再继续 Step 4。
- **LLM 生成素材质量**：Task 5/7/10 都有人工抽查质量门，不合格重跑该页；生成脚本按页幂等（重跑覆盖）。
- **MiniMax chat 模型名**：`GRADING_MODEL` 可换（DeepSeek 需另改 BASE/鉴权，本计划不做）。
- **store 结构迁移**：所有新键在 Task 2 统一给默认值，旧 localStorage 无需迁移脚本。
