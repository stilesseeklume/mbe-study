/* Supabase 云同步配置 —— 填好下面两个值即可启用
 * 步骤见 SUPABASE_SETUP.md（约 5 分钟）：
 * 1. supabase.com 建项目（区域选 Singapore）
 * 2. SQL Editor 运行 supabase-schema.sql
 * 3. Authentication → Users → Add user 建一个共用账号
 * 4. Project Settings → API 里复制 URL 和 anon key 填到下面
 * 5. git commit + push，刷新网站，左下角点「登录云同步」
 */
window.SUPABASE_CONFIG = {
  url: "https://qaumimcqynhsqaqthaih.supabase.co",
  anonKey: "sb_publishable_3kP9mw_D6Y8S4D2mmsZaTQ__ZOKcBeh",
  // 老师面板（teacher.html）只允许这些邮箱进入；学生账号打开只见"仅老师可用"
  teacherEmails: ["teacher@usbar.study"]
};
