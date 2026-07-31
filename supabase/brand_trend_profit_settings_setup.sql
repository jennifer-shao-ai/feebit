-- 品牌趨勢分析（brand-trend.html）利潤設定資料表
-- 用途：存放各賣場類型、蝦皮/官網抽成%、momo綜合扣抵%、寶雅固定毛利率、品牌毛利率覆寫等
-- 單列設計（id 固定=1），整包設定存成一個 jsonb 欄位，跟 finance-dashboard 的 account_notes 做法一致
-- 執行位置：Supabase SQL Editor，跟 brand_trend_records 同一個專案（ref: tokhhoyzztaynppcatci）

create table if not exists brand_trend_profit_settings (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into brand_trend_profit_settings (id, data) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

alter table brand_trend_profit_settings enable row level security;

-- 所有登入者可讀（跟 brand_trend_records 一致）
create policy "profit_settings_select_authenticated"
  on brand_trend_profit_settings for select
  to authenticated
  using (true);

-- 只有 Jennifer 可寫（跟 brand_trend_records 一致，寫死 owner email）
create policy "profit_settings_write_owner"
  on brand_trend_profit_settings for all
  to authenticated
  using (auth.jwt() ->> 'email' = 'esuse.adobe@gmail.com')
  with check (auth.jwt() ->> 'email' = 'esuse.adobe@gmail.com');
