-- 飛比特通路營收分析 — 資料庫初始化
-- 在 Supabase SQL Editor 執行一次
-- 規則:任何登入帳號(非 finance_viewer)可讀取；只有 esuse.adobe@gmail.com 可寫入/刪除

CREATE TABLE IF NOT EXISTS channel_revenue_months (
  year        int NOT NULL,
  month       int NOT NULL,
  data        jsonb NOT NULL,
  updated_at  timestamptz DEFAULT now(),
  PRIMARY KEY (year, month)
);

ALTER TABLE channel_revenue_months ENABLE ROW LEVEL SECURITY;

-- 讀取:登入帳號皆可(排除 finance_viewer 角色，跟頁面現行存取範圍一致)
DROP POLICY IF EXISTS "cr_select_admin" ON channel_revenue_months;
CREATE POLICY "cr_select_admin" ON channel_revenue_months
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.email = auth.jwt() ->> 'email' AND ur.role = 'finance_viewer'
    )
  );

-- 新增/修改/刪除:只認 Jennifer 的帳號
DROP POLICY IF EXISTS "cr_insert_owner" ON channel_revenue_months;
CREATE POLICY "cr_insert_owner" ON channel_revenue_months
  FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'email' = 'esuse.adobe@gmail.com');

DROP POLICY IF EXISTS "cr_update_owner" ON channel_revenue_months;
CREATE POLICY "cr_update_owner" ON channel_revenue_months
  FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'email' = 'esuse.adobe@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'esuse.adobe@gmail.com');

DROP POLICY IF EXISTS "cr_delete_owner" ON channel_revenue_months;
CREATE POLICY "cr_delete_owner" ON channel_revenue_months
  FOR DELETE TO authenticated
  USING (auth.jwt() ->> 'email' = 'esuse.adobe@gmail.com');
