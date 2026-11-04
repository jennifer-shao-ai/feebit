-- 品牌趨勢自動匯入（GitHub Actions：brand-trend-import.yml）用的權限
-- 只讓自動化帳號 feebit.automation@gmail.com「新增」品牌趨勢資料，不能修改、不能刪除
-- 讀取沿用既有規則（所有登入者可讀）
-- 在 Supabase → SQL Editor 執行一次即可；要撤銷就執行最下面那行
create policy "brand_trend_bot_insert"
  on public.brand_trend_records
  for insert
  to authenticated
  with check (auth.jwt() ->> 'email' = 'feebit.automation@gmail.com');

-- 撤銷：drop policy "brand_trend_bot_insert" on public.brand_trend_records;
