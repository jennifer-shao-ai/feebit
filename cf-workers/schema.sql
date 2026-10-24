-- ════════════════════════════════════════
-- market-tracker-db  D1 Schema
-- 在 Cloudflare D1 Console 執行此 SQL
-- ════════════════════════════════════════

-- 商品資料（熱銷追蹤）
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT    NOT NULL,           -- momo / coupang / poya / oliveyoung / hwahae / naver_kr / coupang_kr / taobao / 1688
  sub_source  TEXT    NOT NULL DEFAULT '', -- 蝦皮競品時 = shop id
  rank        INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  brand       TEXT    DEFAULT '',
  spec        TEXT    DEFAULT '',
  price       INTEGER DEFAULT 0,
  orig_price  INTEGER,
  sales       INTEGER,
  list_date   TEXT    DEFAULT '',
  image_url   TEXT    DEFAULT '',
  product_url TEXT    DEFAULT '',
  is_new      INTEGER DEFAULT 0,
  rank_change INTEGER DEFAULT 0,
  emoji       TEXT    DEFAULT '🛍️',
  scraped_at  TEXT    NOT NULL,
  week_key    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_lookup ON products(source, sub_source, week_key);

-- 品牌監控設定
CREATE TABLE IF NOT EXISTS brands (
  id          TEXT PRIMARY KEY,
  name        TEXT    NOT NULL,
  floor_price INTEGER DEFAULT 0,
  created_at  TEXT    DEFAULT (datetime('now'))
);

-- 品牌價格記錄（每週快照，用於趨勢圖）
CREATE TABLE IF NOT EXISTS brand_price_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id     TEXT    NOT NULL,
  shop_name    TEXT    NOT NULL DEFAULT '',
  product_name TEXT    NOT NULL DEFAULT '',
  price        INTEGER NOT NULL,
  is_alert     INTEGER DEFAULT 0,
  scraped_at   TEXT    NOT NULL,
  week_key     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_brand_history ON brand_price_history(brand_id, week_key);

-- 關鍵字設定
CREATE TABLE IF NOT EXISTS keywords (
  id         TEXT PRIMARY KEY,
  text       TEXT    NOT NULL UNIQUE,
  source     TEXT    DEFAULT 'manual',  -- manual / auto
  visible    INTEGER DEFAULT 1,
  created_at TEXT    DEFAULT (datetime('now'))
);

-- 關鍵字文章排行（Google / Dcard / PTT / YouTube）
CREATE TABLE IF NOT EXISTS articles (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword    TEXT    NOT NULL,
  platform   TEXT    NOT NULL,           -- google / dcard / ptt / youtube
  title      TEXT    NOT NULL,
  url        TEXT    DEFAULT '',
  meta       TEXT    DEFAULT '',
  rank       INTEGER NOT NULL,
  scraped_at TEXT    NOT NULL,
  week_key   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_lookup ON articles(keyword, platform, week_key);

-- 競品店設定
CREATE TABLE IF NOT EXISTS shops (
  id         TEXT PRIMARY KEY,
  name       TEXT    NOT NULL,
  url        TEXT    NOT NULL,
  active     INTEGER DEFAULT 1,
  created_at TEXT    DEFAULT (datetime('now'))
);

-- 官網商品（lala-v.com 自動同步）
CREATE TABLE IF NOT EXISTS site_products (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  brand      TEXT    DEFAULT '',
  category   TEXT    DEFAULT '',
  kw_tags    TEXT    DEFAULT '',         -- JSON array of extracted keywords
  scraped_at TEXT    NOT NULL
);

-- 爬取執行記錄
CREATE TABLE IF NOT EXISTS scrape_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT    NOT NULL,
  status      TEXT    NOT NULL,          -- success / error
  items_count INTEGER DEFAULT 0,
  error_msg   TEXT    DEFAULT '',
  scraped_at  TEXT    DEFAULT (datetime('now'))
);

-- ── 預設關鍵字（lala-v.com 品類） ──
INSERT OR IGNORE INTO keywords (id, text, source, visible) VALUES
  ('k_default_1',  '玻尿酸精華',     'auto', 1),
  ('k_default_2',  '卸妝水',         'auto', 1),
  ('k_default_3',  '防曬乳 SPF50',   'auto', 1),
  ('k_default_4',  '護髮油',         'auto', 1),
  ('k_default_5',  '沐浴露推薦',     'auto', 1),
  ('k_default_6',  '氣墊粉底',       'auto', 1),
  ('k_default_7',  '香氛擴香',       'auto', 1),
  ('k_default_8',  '化妝包推薦',     'auto', 1),
  ('k_default_9',  '洗髮精推薦',     'auto', 1),
  ('k_default_10', '韓系眉筆',       'manual', 1);

-- ── 預設競品店 ──
INSERT OR IGNORE INTO shops (id, name, url) VALUES
  ('s_kjnac',     'kjnac',             'https://shopee.tw/kjnacosmeticba'),
  ('s_millicent', 'millicent',         'https://shopee.tw/millicent'),
  ('s_t091771',   't091771',           'https://shopee.tw/t091771'),
  ('s_helpbuykr', 'helpbuykr.official','https://shopee.tw/helpbuykr.official'),
  ('s_helpbuykr2','helpbuykr',         'https://shopee.tw/helpbuykr');
