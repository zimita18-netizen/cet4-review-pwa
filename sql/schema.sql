-- 无量空处 · Supabase 建表脚本
-- 在 Supabase 控制台左侧 SQL Editor 里粘贴执行一次即可

-- 1) 词库表
create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  meaning text default '',
  state jsonb default '{"ivl":0,"ease":2.5,"due":0,"reps":0,"lapses":0}',
  added_at timestamptz default now(),
  unique(user_id, word)
);

-- 2) 短文历史表
create table if not exists public.essays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  words_line text default '',
  segments jsonb default '[]',
  created_at timestamptz default now()
);

-- 3) 开启行级安全（RLS）
alter table public.words enable row level security;
alter table public.essays enable row level security;

-- 4) 策略：每个用户只能读写自己的数据
drop policy if exists "own words" on public.words;
create policy "own words" on public.words
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own essays" on public.essays;
create policy "own essays" on public.essays
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
