-- 考勤查驗「年度報告」雲端拋轉用資料表
-- 在 Supabase SQL Editor 執行一次即可

create table if not exists attendance_annual_reports (
  year int primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table attendance_annual_reports enable row level security;

-- 讀取：任何已登入帳號皆可(不限角色)
create policy "attendance_annual_select_authenticated"
  on attendance_annual_reports for select
  to authenticated
  using (true);

-- 寫入/更新/刪除：只認 admin email
create policy "attendance_annual_write_admin"
  on attendance_annual_reports for all
  to authenticated
  using (auth.jwt()->>'email' = 'esuse.adobe@gmail.com')
  with check (auth.jwt()->>'email' = 'esuse.adobe@gmail.com');
