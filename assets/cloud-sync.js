/* USBAR Studio · Cloud Sync
 * 零依赖 Supabase 客户端（fetch 实现），localStorage ↔ 云端双向同步。
 * 未配置 / 未登录 / 断网时自动降级为纯本地模式，绝不阻塞学习界面。
 */
(function () {
  'use strict';

  var CFG = window.SUPABASE_CONFIG || {};
  var LS_KEY = 'usbar-studio-v2';
  var LS_META = 'usbar-sync-meta';
  var LS_AUTH = 'usbar-sync-auth';
  var LS_SKIP = 'usbar-sync-skipped';

  var SYNC_KEYS = ['page', 'completed', 'notes', 'highlights', 'edits', 'savedWords', 'apiEndpoint', 'retellLog', 'reviewQueue', 'lookupLog', 'badges', 'profile', 'readingLog', 'zhExpand'];
  var STATUS_TEXT = {
    off: ['✎', '云同步未配置'],
    connecting: ['◌', '正在连接云同步…'],
    login: ['⚿', '登录云同步'],
    online: ['☁', '云同步已连接'],
    offline: ['⚠', '云同步离线·点击重试']
  };

  var status = (CFG.url && CFG.anonKey) ? 'connecting' : 'off';
  var session = null;
  var readyPromise = null;
  var loginResolve = null;
  var lastSnapshot = {};
  var pushTimer = null;
  var retryTimer = null;
  var retryAttempt = 0;
  var pushFails = 0;
  var loginEventSent = false;
  var statusListeners = [];

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function writeJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function configured() { return Boolean(CFG.url && CFG.anonKey); }

  /* ---------- HTTP ---------- */
  function fetchTimeout(url, options, ms) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms);
    options = options || {};
    options.signal = controller.signal;
    return fetch(url, options).finally(function () { clearTimeout(timer); });
  }

  function authRequest(grant, body) {
    return fetchTimeout(CFG.url + '/auth/v1/token?grant_type=' + grant, {
      method: 'POST',
      headers: { 'apikey': CFG.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 8000).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error(data.error_description || data.msg || data.error || '请求失败');
        return data;
      });
    });
  }

  function rest(path, options, retried) {
    options = options || {};
    var headers = { 'apikey': CFG.anonKey, 'Content-Type': 'application/json' };
    if (session && session.access_token) headers['Authorization'] = 'Bearer ' + session.access_token;
    if (options.headers) Object.assign(headers, options.headers);
    return fetchTimeout(CFG.url + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body
    }, 12000).then(function (res) {
      if (res.status === 401 && !retried && session && session.refresh_token) {
        return authRequest('refresh_token', { refresh_token: session.refresh_token }).then(function (fresh) {
          persistSession(fresh);
          return rest(path, options, true);
        });
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.status === 204 ? null : res.json();
    });
  }

  /* ---------- 会话 ---------- */
  function persistSession(value) {
    session = value;
    writeJSON(LS_AUTH, {
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      user_email: value.user && value.user.email ? value.user.email : ''
    });
  }

  function restoreSession() {
    var saved = readJSON(LS_AUTH, null);
    if (!saved || !saved.refresh_token) return Promise.resolve(false);
    return authRequest('refresh_token', { refresh_token: saved.refresh_token })
      .then(function (fresh) { persistSession(fresh); return true; })
      .catch(function () { localStorage.removeItem(LS_AUTH); return false; });
  }

  /* ---------- 同步 ---------- */
  function pull() {
    return rest('/rest/v1/study_state?select=key,value,updated_at').then(function (rows) {
      var store = readJSON(LS_KEY, {});
      var meta = readJSON(LS_META, {});
      var changed = false;
      (rows || []).forEach(function (row) {
        if (row.key.charAt(0) === '_') return;
        var remoteMs = new Date(row.updated_at).getTime() || 0;
        if (remoteMs > (meta[row.key] || 0) + 1000) {
          store[row.key] = row.value;
          meta[row.key] = remoteMs;
          changed = true;
        }
      });
      if (changed) {
        writeJSON(LS_KEY, store);
        window.dispatchEvent(new CustomEvent('usbar:external-update', { detail: store }));
      }
      writeJSON(LS_META, meta);
      lastSnapshot = clone(store);
      return changed;
    });
  }

  function push() {
    if (!session) return Promise.resolve();
    var store = readJSON(LS_KEY, {});
    var meta = readJSON(LS_META, {});
    var now = Date.now();
    var rows = [];
    Object.keys(store).forEach(function (key) {
      if (SYNC_KEYS.indexOf(key) < 0 && key.charAt(0) !== '_') return;
      if (JSON.stringify(store[key]) !== JSON.stringify(lastSnapshot[key])) {
        meta[key] = now;
        rows.push({ key: key, value: store[key], updated_at: new Date(now).toISOString() });
      }
    });
    if (!rows.length) { lastSnapshot = clone(store); return Promise.resolve(); }
    var before = {
      completed: (lastSnapshot.completed || []).length,
      notes: (lastSnapshot.notes || []).length,
      words: (lastSnapshot.savedWords || []).length
    };
    return rest('/rest/v1/study_state', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    }).then(function () {
      lastSnapshot = clone(store);
      writeJSON(LS_META, meta);
      logEvents(store, before);
      setStatus('online');
    }).catch(function (error) {
      if (++pushFails >= 2) setStatus('offline');
      scheduleRetry();
      throw error;
    });
  }

  function logEvents(store, before) {
    var events = [];
    if ((store.completed || []).length > before.completed) events.push({ kind: 'complete', detail: { total: store.completed.length } });
    if ((store.notes || []).length > before.notes) events.push({ kind: 'note', detail: { total: store.notes.length } });
    if ((store.savedWords || []).length > before.words) events.push({ kind: 'word', detail: { total: store.savedWords.length } });
    events.forEach(function (event) {
      rest('/rest/v1/study_events', { method: 'POST', body: JSON.stringify(event) }).catch(function () {});
    });
  }

  function logLogin() {
    if (loginEventSent) return;
    loginEventSent = true;
    rest('/rest/v1/study_events', { method: 'POST', body: JSON.stringify({ kind: 'login', detail: {} }) }).catch(function () {});
  }

  function heartbeat() {
    if (!session) return;
    rest('/rest/v1/study_state', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{
        key: '_activity',
        value: { last_active: new Date().toISOString() },
        updated_at: new Date().toISOString()
      }])
    }).catch(function () {});
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { push().catch(function () {}); }, 1200);
  }

  function scheduleRetry(immediate) {
    clearTimeout(retryTimer);
    var delay = immediate ? 800 : Math.min(15000 * (retryAttempt + 1), 60000);
    if (!immediate) retryAttempt += 1;
    retryTimer = setTimeout(function () {
      restoreSession().then(function (ok) {
        if (!ok) { setStatus('login'); return; }
        return pull().then(function () { setStatus('online'); schedulePush(); });
      }).catch(function () { scheduleRetry(); });
    }, delay);
  }

  /* ---------- 登录界面 ---------- */
  function showLogin(allowSkip) {
    if (document.getElementById('csModal')) return;
    var style = document.createElement('style');
    style.textContent = [
      '.cs-modal{position:fixed;inset:0;z-index:200;background:rgba(10,18,38,.62);backdrop-filter:blur(6px);display:grid;place-items:center;padding:20px}',
      '.cs-card{width:min(400px,100%);background:#fbfcff;border-radius:20px;padding:30px 28px;box-shadow:0 30px 80px rgba(6,14,32,.4)}',
      '.cs-kicker{font-size:10px;font-weight:900;letter-spacing:.18em;color:#5f82c8;margin-bottom:10px}',
      '.cs-card h3{margin:0 0 8px;font-family:Georgia,"Songti SC",serif;font-size:23px;color:#12203e}',
      '.cs-card p{margin:0 0 18px;font-size:12.5px;line-height:1.7;color:#6e7890}',
      '.cs-card input{width:100%;border:1px solid #dfe5f0;border-radius:11px;padding:12px 13px;font-size:13px;margin-bottom:10px;outline:0;box-sizing:border-box}',
      '.cs-card input:focus{border-color:#5f82c8}',
      '.cs-err{color:#c25b4e;font-size:11px;min-height:15px;margin:-3px 0 8px}',
      '.cs-go{width:100%;border:0;border-radius:11px;background:#101b35;color:#fff;padding:12px;font-weight:800;font-size:13px;cursor:pointer}',
      '.cs-go:disabled{opacity:.55}',
      '.cs-skip{width:100%;border:0;background:transparent;color:#8b96ad;font-size:11px;padding:12px 0 0;cursor:pointer}'
    ].join('');
    document.head.appendChild(style);

    var modal = document.createElement('div');
    modal.className = 'cs-modal';
    modal.id = 'csModal';
    modal.innerHTML =
      '<div class="cs-card">' +
      '<div class="cs-kicker">CLOUD SYNC · SUPABASE</div>' +
      '<h3>登录学习云同步</h3>' +
      '<p>登录后，学习进度和笔记会自动同步到云端——老师也能在「学习面板」里看到你的进步。同一账号，两台设备通用。</p>' +
      '<input type="email" id="csEmail" placeholder="邮箱（老师提供）" autocomplete="username">' +
      '<input type="password" id="csPass" placeholder="密码" autocomplete="current-password">' +
      '<div class="cs-err" id="csErr"></div>' +
      '<button class="cs-go" id="csGo">登录</button>' +
      (allowSkip ? '<button class="cs-skip" id="csSkip">跳过，先用本地模式学习</button>' : '') +
      '</div>';
    document.body.appendChild(modal);

    var email = modal.querySelector('#csEmail');
    var pass = modal.querySelector('#csPass');
    var go = modal.querySelector('#csGo');
    var err = modal.querySelector('#csErr');

    function submit() {
      if (!email.value.trim() || !pass.value) { err.textContent = '请输入邮箱和密码'; return; }
      go.disabled = true;
      go.textContent = '正在登录…';
      err.textContent = '';
      authRequest('password', { email: email.value.trim(), password: pass.value })
        .then(function (fresh) {
          persistSession(fresh);
          localStorage.removeItem(LS_SKIP);
          modal.remove();
          toast('云同步已登录');
          if (loginResolve) { var resolve = loginResolve; loginResolve = null; resolve(true); }
          afterLogin();
        })
        .catch(function (error) {
          go.disabled = false;
          go.textContent = '登录';
          err.textContent = error.message || '登录失败，请检查邮箱和密码';
        });
    }
    go.onclick = submit;
    pass.onkeydown = function (event) { if (event.key === 'Enter') submit(); };
    var skip = modal.querySelector('#csSkip');
    if (skip) skip.onclick = function () {
      localStorage.setItem(LS_SKIP, '1');
      modal.remove();
      if (loginResolve) { var resolve = loginResolve; loginResolve = null; resolve(false); }
    };
    setTimeout(function () { email.focus(); }, 60);
  }

  function waitLogin(allowSkip) {
    return new Promise(function (resolve) {
      loginResolve = resolve;
      showLogin(allowSkip);
    });
  }

  /* ---------- 未同步警示条：学习页顶部，未登录/断线时常驻 ---------- */
  var bannerStyleReady = false;

  function ensureBannerStyle() {
    if (bannerStyleReady) return;
    bannerStyleReady = true;
    var style = document.createElement('style');
    style.textContent = [
      '#syncBanner{position:fixed;top:0;left:0;right:0;z-index:150;height:40px;box-sizing:border-box;display:flex;align-items:center;gap:12px;padding:0 16px;background:#8a3d33;color:#ffece7;font-size:12px;font-weight:750;box-shadow:0 8px 22px rgba(80,25,15,.28);cursor:default}',
      '#syncBanner.mild{background:#4a5164;color:#e6e9f2}',
      '#syncBanner.warm{background:#7a5a23;color:#ffefc9}',
      '#syncBanner .sb-text{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#syncBanner button{border:1px solid #ffffff55;background:#ffffff1c;color:inherit;border-radius:9px;padding:6px 14px;font-size:11.5px;font-weight:800;cursor:pointer;white-space:nowrap}',
      '#syncBanner button:hover{background:#ffffff30}',
      'body.sync-banner-on .app{padding-top:40px}',
      'body.sync-banner-on .topbar{top:40px}',
      'body.sync-banner-on .rail{top:40px;height:calc(100vh - 40px)}',
      'body.sync-banner-on .dock{top:40px;height:calc(100vh - 40px)}',
      '@media(max-width:720px){#syncBanner{font-size:11px;gap:8px;padding:0 12px}}'
    ].join('');
    document.head.appendChild(style);
  }

  function bannerSpec() {
    if (!configured()) return { tone: 'mild', text: '⚠ 云同步未配置：学习记录只保存在本机浏览器里', action: '' };
    if (status === 'login') return { tone: '', text: '⚠ 学习记录未同步：当前是本地模式，进度和笔记不会上传云端，换设备或清浏览器会丢失', action: '立即登录' };
    if (status === 'offline') return { tone: 'warm', text: '⚠ 云同步已断开：新记录暂存本机，恢复连接后自动上传', action: '重试连接' };
    return null;
  }

  function renderBanner() {
    if (!document.querySelector('.rail')) return;
    var spec = bannerSpec();
    var bar = document.getElementById('syncBanner');
    if (!spec) {
      if (bar) bar.remove();
      document.body.classList.remove('sync-banner-on');
      return;
    }
    ensureBannerStyle();
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'syncBanner';
      document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.className = spec.tone;
    bar.innerHTML = '<span class="sb-text">' + spec.text + '</span>' +
      (spec.action ? '<button>' + spec.action + '</button>' : '');
    var btn = bar.querySelector('button');
    if (btn) btn.onclick = function () {
      if (status === 'login') { showLogin(false); return; }
      if (status === 'offline') onPillClick();
    };
    document.body.classList.add('sync-banner-on');
  }

  /* ---------- 状态胶囊 ---------- */
  function renderPill() {
    var host = document.querySelector('.rail-foot');
    if (!host) return;
    var pill = document.getElementById('cloudPill');
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'cloudPill';
      pill.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-top:10px;border:1px solid #ffffff24;background:#ffffff0d;color:#b9c5dc;border-radius:9px;padding:7px 10px;font-size:10.5px;cursor:pointer;font-weight:700';
      pill.onmouseenter = function () { pill.style.background = '#ffffff1c'; };
      pill.onmouseleave = function () { pill.style.background = '#ffffff0d'; };
      pill.onclick = onPillClick;
      host.appendChild(pill);
    }
    var info = STATUS_TEXT[status] || STATUS_TEXT.off;
    pill.textContent = info[0] + ' ' + info[1];
    pill.style.color = status === 'online' ? '#63c7a6' : (status === 'offline' ? '#f3b7a9' : '#b9c5dc');
  }

  function onPillClick() {
    if (!configured()) {
      toast('云同步未配置：请先填写 assets/supabase-config.js');
      return;
    }
    if (status === 'online') {
      pull().then(function () { return push(); })
        .then(function () { toast('已与云端同步'); })
        .catch(function () { toast('同步失败，稍后自动重试'); });
      return;
    }
    if (status === 'login') { showLogin(false); return; }
    if (status === 'offline') {
      setStatus('connecting');
      restoreSession().then(function (ok) {
        if (!ok) { setStatus('login'); showLogin(false); return; }
        return pull().then(function () { setStatus('online'); heartbeat(); schedulePush(); });
      }).catch(function () { setStatus('offline'); scheduleRetry(); });
    }
  }

  function toast(text) {
    var el = document.getElementById('toast');
    if (el) {
      el.textContent = text;
      el.classList.add('show');
      setTimeout(function () { el.classList.remove('show'); }, 1700);
      return;
    }
    var own = document.createElement('div');
    own.textContent = text;
    own.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#14213e;color:#fff;padding:10px 16px;border-radius:11px;font-size:12px;z-index:300;box-shadow:0 12px 30px rgba(6,14,32,.35)';
    document.body.appendChild(own);
    setTimeout(function () { own.remove(); }, 2200);
  }

  function setStatus(next) {
    status = next;
    if (next === 'online') { retryAttempt = 0; pushFails = 0; }
    renderPill();
    renderBanner();
    statusListeners.forEach(function (cb) { try { cb(next); } catch (e) {} });
  }

  /* ---------- 启动 ---------- */
  function afterLogin() {
    setStatus('connecting');
    return pull()
      .then(function () {
        setStatus('online');
        logLogin();
        heartbeat();
        setInterval(heartbeat, 10 * 60 * 1000);
        setInterval(function () {
          if (document.visibilityState === 'visible' && session) pull().catch(function () {});
        }, 5 * 60 * 1000);
        schedulePush();
      })
      .catch(function () {
        setStatus('offline');
        scheduleRetry();
      });
  }

  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise(function (resolve) {
      if (!configured()) { setStatus('off'); resolve(); return; }
      restoreSession().then(function (ok) {
        if (ok) { return afterLogin().then(resolve); }
        setStatus('login');
        if (localStorage.getItem(LS_SKIP) !== '1') {
          setTimeout(function () {
            if (!session) showLogin(true);
          }, 1600);
        }
        resolve();
      }).catch(function () {
        setStatus('offline');
        scheduleRetry();
        resolve();
      });
    });
    return readyPromise;
  }

  window.addEventListener('usbar:save', schedulePush);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && status === 'offline' && session) scheduleRetry(true);
  });

  window.CloudSync = {
    ready: ready,
    login: function () { return waitLogin(false).then(function (ok) { return ok ? afterLogin() : null; }); },
    logout: function () {
      session = null;
      localStorage.removeItem(LS_AUTH);
      localStorage.removeItem(LS_SKIP);
      setStatus('login');
      location.reload();
    },
    isLoggedIn: function () { return Boolean(session); },
    email: function () {
      if (session && session.user && session.user.email) return session.user.email;
      return readJSON(LS_AUTH, {}).user_email || '';
    },
    isTeacher: function () {
      var list = CFG.teacherEmails || [];
      return list.indexOf(this.email()) >= 0;
    },
    configured: configured,
    status: function () { return status; },
    onStatus: function (cb) { statusListeners.push(cb); },
    fetchState: function () { return rest('/rest/v1/study_state?select=key,value,updated_at'); },
    fetchEvents: function () { return rest('/rest/v1/study_events?select=kind,detail,created_at&order=created_at.desc&limit=120'); },
    logEvent: function (kind, detail) {
      if (!session) return;
      rest('/rest/v1/study_events', { method: 'POST', body: JSON.stringify({ kind: String(kind), detail: { text: String(detail == null ? '' : detail) } }) }).catch(function () {});
    },
    refresh: function () { return pull().then(function () { return push(); }); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { renderPill(); renderBanner(); });
  } else {
    renderPill();
    renderBanner();
  }
})();
