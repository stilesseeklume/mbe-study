-- USBAR Studio 云同步数据库结构
-- 在 Supabase 控制台的 SQL Editor 中运行本文件即可。

-- 1. 学习状态表：每个顶层字段一行（page / completed / notes / highlights / edits / savedWords / apiEndpoint）
create table if not exists public.study_state (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2. 学习动态表：只增不改，用于老师面板的"学习动态"时间线
create table if not exists public.study_events (
  id         bigint generated always as identity primary key,
  kind       text not null,   -- login | complete | note | word
  detail     jsonb,
  created_at timestamptz not null default now()
);

-- 3. 行级安全：只有登录用户可以读写（anon key 公开也改不了数据）
alter table public.study_state enable row level security;
alter table public.study_events enable row level security;

drop policy if exists "study_state read"   on public.study_state;
drop policy if exists "study_state write"  on public.study_state;
create policy "study_state read"  on public.study_state for select to authenticated using (true);
create policy "study_state write" on public.study_state for all to authenticated using (true) with check (true);

drop policy if exists "study_events read"  on public.study_events;
drop policy if exists "study_events write" on public.study_events;
create policy "study_events read"  on public.study_events for select to authenticated using (true);
create policy "study_events write" on public.study_events for all to authenticated using (true) with check (true);
-- study_events 故意不给 update/delete 权限：动态记录不可篡改
