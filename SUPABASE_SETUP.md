# Supabase 云同步配置（约 5 分钟）

> **✅ 2026-08-25 已配置完成，无需再操作。**
> 项目：`usbar-study`（Singapore 区域）· 登录账号见下方第 3 步说明。

配置后，廖同学的学习进度、笔记、生词会自动同步到云端，老师打开 `teacher.html` 就能看到全部动态——不再只存在她自己的浏览器里。

## 为什么用 Supabase

- 免费档完全够用（500MB 数据库，无服务器要维护）
- 自带登录系统和行级安全（RLS），公开仓库里的 anon key 拿不到数据
- 网站保持纯静态，GitHub Pages / EdgeOne Pages 都能直接跑

## 配置步骤

### 1. 建项目

1. 打开 https://supabase.com 注册并登录（GitHub 账号可直接登）
2. New project → 名称随意（如 `usbar-study`）
3. **Region 选 Singapore**（离大陆最近，访问最快）
4. 数据库密码设一个记得住的，等待 1-2 分钟初始化

### 2. 建表

1. 左侧 SQL Editor → New query
2. 把本仓库 `supabase-schema.sql` 的全部内容粘贴进去 → Run
3. 应显示 Success，左边 Tables 里出现 `study_state` 和 `study_events` 两张表

### 3. 建账号（老师和学生共用一个）

> 当前已建好：邮箱 `liao@study.local`（密码 privately 告知廖同学即可）。

1. 左侧 Authentication → Users → Add user → Create user
2. 填邮箱（如 `liaostudy@example.com`）和密码（8 位以上）
3. 勾选 Auto Confirm User（必须勾）
4. 把这一组邮箱密码告诉廖同学（登录用，别提交进仓库）

### 4. 填配置

1. 左侧 Project Settings → API
2. 复制 `Project URL` 和 `Project API keys` 里的 `anon public`
3. 打开本仓库 `assets/supabase-config.js`，填入两个值
4. git commit + push

```js
window.SUPABASE_CONFIG = {
  url: "https://你的项目id.supabase.co",
  anonKey: "eyJhbGciOi..."
};
```

> anon key 本来就是设计成公开的，真正挡住陌生人的是 RLS 策略——只有第 3 步创建的账号登录后才能读写。

### 5. 登录使用

- 廖同学打开网站 → 学习界面左下角点「⚿ 登录云同步」→ 输入账号 → 之后全自动
- 老师打开 `网站地址/teacher.html` → 同一账号登录 → 看到完成进度、学习动态、全部笔记、生词本
- 老师面板每 60 秒自动刷新，也可手动点「↻ 刷新」

## 行为说明

| 场景 | 表现 |
|------|------|
| 未登录 / 断网 | 自动降级本地模式，学习功能完全不受影响 |
| 笔记 / 高亮 / 生词 / 完成页 | 保存后约 1.2 秒自动上云 |
| 换设备 | 打开网站自动拉取云端最新进度 |
| 同时两台设备改同一条数据 | 后保存的覆盖先保存的（建议同一时间只用一台设备学） |
| 学习动态 | 每次登录、完成页、写笔记、收藏生词都会记一条，只增不改 |

## 常见问题

**登录报错 "Email not confirmed"**：第 3 步没勾 Auto Confirm，去 Authentication → Users 里手动点 Confirm。

**面板一直"正在连接"**：大陆网络访问 supabase.co 偶尔慢，等几秒或刷新；项目区域务必选 Singapore。

**想让数据重置**：SQL Editor 运行 `truncate study_state, study_events;` 再让她重新登录。
