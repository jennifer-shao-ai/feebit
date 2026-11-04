// brand-trend-import.js
// 由 GitHub Actions 每月 1～10 日自動執行：
// 讀 Ragic「平台每月報表」(data2/2) 的蝦皮商品表現 Excel → 依 brand-sales.html 的品牌規則加總
// → 寫入品牌趨勢資料庫 (Supabase brand_trend_records)
// 已經有資料的「賣場＋月份」一律跳過，不覆蓋、不重複
// 需要 npm install exceljs（workflow 會裝）

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const RAGIC_TOKEN  = process.env.RAGIC_TOKEN;
const BOT_EMAIL    = process.env.BRAND_TREND_BOT_EMAIL;      // feebit.automation，只有新增權限（RLS）
const BOT_PASSWORD = process.env.BRAND_TREND_BOT_PASSWORD;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const DRY_RUN      = process.env.DRY_RUN === 'true';
const MONTHS_BACK  = parseInt(process.env.MONTHS_BACK || '3');
const LOCAL_DIR    = process.env.LOCAL_DIR || '';   // 本機測試用：直接讀資料夾裡的 Excel，不連 Ragic、不寫入

const RAGIC_SHEET  = 'https://ap13.ragic.com/feebit50968407/data2/2?api&limit=1000';
const RAGIC_FILE   = 'https://ap13.ragic.com/sims/file.jsp?a=feebit50968407&f=';
const SB_BASE      = 'https://tokhhoyzztaynppcatci.supabase.co';
const SB_URL       = SB_BASE + '/rest/v1/brand_trend_records';
const SB_ANON      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRva2hob3l6enRheW5wcGNhdGNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDAyODMsImV4cCI6MjA5MDg3NjI4M30.PQB4lJGF3OMatv5wIedCu3zIWq0urrFbniBRYTbNtUU';   // 公開的 anon key，跟 supabase-keepalive.yml 同一把
let sbToken = '';
const TO_EMAIL     = 'jennifer.feebit@gmail.com';

const SHOPS = [['LaLa V', '蝦皮-LaLaV安妞'], ['寶媽', '蝦皮-寶媽小舖'], ['玩美', '蝦皮-玩美妍選'], ['桑爹', '蝦皮-桑爹選物']];

// ── 品牌規則：直接讀 brand-sales.html 的 BRAND_TABLE＋extractBrand，兩邊不會各改各的 ──
const html = fs.readFileSync(path.join(__dirname, '..', 'brand-sales.html'), 'utf8');
const start = html.indexOf('const BRAND_TABLE = {');
const end = html.indexOf('function autoMergeSplitBrands');
if (start < 0 || end < 0) throw new Error('brand-sales.html 找不到 BRAND_TABLE／extractBrand');
const extractBrand = new Function(html.slice(start, end) + '\nreturn extractBrand;')();

// 開頭的賣場／促銷標籤先拿掉，例如【桑爹】【寶媽小舖】【超值36折起】
const TAG = /^[【\[]([^】\]]*(桑爹|寶媽|玩美妍選|LaLa V|折|超值|超優惠|限時|下殺|優惠|免運)[^】\]]*)[】\]]\s*/;
function clean(name) {
  let s = name.trim();
  for (let i = 0; i < 4 && TAG.test(s); i++) s = s.replace(TAG, '');
  return s;
}
// Jennifer 確認過的規則，見 tool-notes/project_brand_trend.md
function brandOf(name) {
  if (name.startsWith('由於商品被刪除')) return '資料缺失-商品已刪除';
  if (/(提盒|提袋|禮盒|禮袋|方巾)/.test(name) && !/(香氛|皂|身體乳|保養)/.test(name)) return 'V4U薇選禮';
  if (/ONDO|昂朵/.test(name)) return 'ONDO昂朵';
  if (/霧彩.*抓夾/.test(name)) return 'ONDO昂朵';
  return extractBrand(clean(name));
}
// extractBrand 的 canonical 名稱 → 資料庫實際拼法
const RENAME = {
  'Dr. SEED': 'Dr.SEED', 'LACTO-FIT': '鐘根堂LACTO-FIT', 'RYO': 'RYO呂', 'ILLIYOON': 'ILLIYOON一理潤',
  'KUMANO': 'KUMANO熊野油脂', 'AXIS-Y': 'AXIS-Y安舒研', 'Mise-En-Scene': 'Mise-En-Scène 魅尚萱',
  'KUNDAL': 'KUNDAL昆黛爾', 'Athens': 'Athens雅典', 'SOTHING': 'SOTHING向物', '未分類': '其他',
};

async function parseExcel(buf) {
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error('下載到的不是 Excel 檔：' + buf.slice(0, 80).toString('utf8').replace(/\s+/g, ' '));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  // 主機的蝦皮後台有時是英文介面，報表會變成英文工作表
  const ws = wb.getWorksheet('最佳表現商品') || wb.getWorksheet('商品表現') || wb.getWorksheet('Top Performing Products');
  if (!ws) throw new Error('Excel 找不到「最佳表現商品」工作表，現有：' + wb.worksheets.map(w => w.name).join('、'));
  const val = c => (c && typeof c === 'object' && 'result' in c) ? c.result : c;
  const head = ws.getRow(1).values.map(v => String(val(v) ?? '').trim());
  const iName = head.indexOf('商品名稱'), iVar = head.indexOf('商品規格ID'), iSales = head.indexOf('銷售額(可出貨訂單) (TWD)');
  if (iName < 0 || iVar < 0 || iSales < 0) throw new Error('Excel 欄位對不上：' + head.join(','));
  const items = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const v = row.values.map(val);
    if (String(v[iVar] ?? '').trim() !== '-' || !v[iName]) return;   // 只取父列，避免多規格重複計算
    const sales = parseFloat(String(v[iSales] ?? '0').replace(/,/g, '')) || 0;
    items.push({ name: String(v[iName]), sales });
  });
  return items;
}

// 資料庫沒出現過的品牌先歸「其他」，通知信列出商品名請 Jennifer 確認，不自己生新品牌
function summarize(items, knownBrands) {
  const agg = {};
  const unknown = {};
  for (const it of items) {
    if (it.sales <= 0) continue;
    let b = brandOf(it.name);
    b = RENAME[b] || b;
    if (knownBrands && !knownBrands.has(b)) {
      unknown[it.name] = (unknown[it.name] || 0) + it.sales;
      b = '其他';
    }
    agg[b] = (agg[b] || 0) + it.sales;
  }
  const rows = Object.entries(agg).map(([brand, v]) => ({ brand, revenue: Math.round(v) }));
  return { rows, unknown: Object.entries(unknown).map(([name, v]) => ({ name, revenue: Math.round(v) })) };
}

function monthsWanted() {
  const out = [];
  const now = new Date(Date.now() + 8 * 3600e3);   // 台灣時間
  for (let i = 1; i <= MONTHS_BACK; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const sbHeaders = () => ({ apikey: SB_ANON, Authorization: `Bearer ${sbToken}`, 'Content-Type': 'application/json' });

// 用自動化帳號登入，拿到的身分只能讀取和新增品牌趨勢資料
async function sbLogin() {
  const res = await fetch(`${SB_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: SB_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: BOT_EMAIL, password: BOT_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Supabase 登入失敗 ${res.status}`);
  sbToken = (await res.json()).access_token;
}

// Supabase 單次最多回 1000 筆（品牌趨勢踩過的坑），所以分頁讀
async function sbAll(query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SB_URL}?${query}`, { headers: { ...sbHeaders(), Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`Supabase 讀取 ${res.status}: ${await res.text()}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
async function sbExisting() {
  const data = await sbAll('select=shop,month,brand&order=id');
  const shopee = data.filter(r => r.shop.startsWith('蝦皮'));
  return { done: new Set(shopee.map(r => r.shop + '|' + r.month)), brands: new Set(data.map(r => r.brand)) };
}

async function sendMail(subject, body) {
  if (!RESEND_KEY) { console.log('（沒有 RESEND_API_KEY，不寄信）'); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'onboarding@resend.dev', to: [TO_EMAIL], subject, html: body }),
  });
  if (!res.ok) console.error(`Resend ${res.status}: ${await res.text()}`);
}

// 本機測試：LOCAL_DIR 底下放 蝦皮-*/YYYYMM/parentskudetail*.xlsx
async function runLocal() {
  for (const shopDir of fs.readdirSync(LOCAL_DIR).filter(d => d.startsWith('蝦皮-'))) {
    const shop = (SHOPS.find(([k]) => shopDir.includes(k)) || [])[1];
    for (const ym of fs.readdirSync(path.join(LOCAL_DIR, shopDir)).sort()) {
      const dir = path.join(LOCAL_DIR, shopDir, ym);
      const f = fs.statSync(dir).isDirectory() && fs.readdirSync(dir).find(x => x.startsWith('parentskudetail'));
      if (!f) continue;
      const { rows } = summarize(await parseExcel(fs.readFileSync(path.join(dir, f))));
      const month = ym.slice(0, 4) + '-' + ym.slice(4);
      console.log(JSON.stringify({ shop, month, total: rows.reduce((s, r) => s + r.revenue, 0), rows }));
    }
  }
}

async function main() {
  if (LOCAL_DIR) return runLocal();
  if (!RAGIC_TOKEN) throw new Error('RAGIC_TOKEN 未設定');
  if (!BOT_EMAIL || !BOT_PASSWORD) throw new Error('BRAND_TREND_BOT_EMAIL／BRAND_TREND_BOT_PASSWORD 未設定');
  await sbLogin();

  const months = monthsWanted();
  console.log(`🔎 檢查月份：${months.join('、')}${DRY_RUN ? '（試跑，不寫入）' : ''}`);
  const { done, brands } = await sbExisting();

  const res = await fetch(RAGIC_SHEET, { headers: { Authorization: 'Basic ' + RAGIC_TOKEN } });
  if (!res.ok) throw new Error(`Ragic 讀取 ${res.status}`);
  const sheet = await res.json();

  const inserted = [], skipped = [], unknownAll = [];
  for (const [id, r] of Object.entries(sheet)) {
    if (id.startsWith('_')) continue;
    const shop = (SHOPS.find(([k]) => String(r['平台賣場'] || '').startsWith('蝦皮') && String(r['平台賣場']).includes(k)) || [])[1];
    if (!shop) continue;
    const month = `${parseInt(r['年份'])}-${String(parseInt(r['月份'])).padStart(2, '0')}`;
    if (!months.includes(month)) continue;
    const file = String(r['蝦皮商品表現'] || '').trim();
    if (!file) { skipped.push(`${shop} ${month}：Ragic 沒有商品表現檔`); continue; }
    if (done.has(shop + '|' + month)) { skipped.push(`${shop} ${month}：資料庫已經有了`); continue; }

    const fr = await fetch(RAGIC_FILE + encodeURIComponent(file), { headers: { Authorization: 'Basic ' + RAGIC_TOKEN } });
    if (!fr.ok) throw new Error(`下載 ${shop} ${month} 檔案失敗 ${fr.status}`);
    const { rows, unknown } = summarize(await parseExcel(Buffer.from(await fr.arrayBuffer())), brands);
    const payload = rows.map(x => ({ shop, month, brand: x.brand, revenue: x.revenue, source: 'ragic-import' }));
    const total = payload.reduce((s, x) => s + x.revenue, 0);
    unknown.forEach(u => unknownAll.push(`${shop} ${month}：${u.name.slice(0, 40)}（${u.revenue.toLocaleString()}，先歸「其他」）`));

    if (!DRY_RUN) {
      const ins = await fetch(SB_URL, { method: 'POST', headers: { ...sbHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
      if (!ins.ok) throw new Error(`Supabase 寫入 ${shop} ${month} 失敗 ${ins.status}: ${await ins.text()}`);
      done.add(shop + '|' + month);
    }
    inserted.push(`${shop} ${month}：${payload.length} 個品牌，合計 ${total.toLocaleString()}`);
    console.log(`✅ ${DRY_RUN ? '（試跑）' : ''}${inserted.at(-1)}`);
  }

  skipped.forEach(s => console.log('⏩ ' + s));
  unknownAll.forEach(s => console.log('🆕 ' + s));
  if (inserted.length === 0) { console.log('沒有新的月份要匯入'); return; }

  const li = a => a.map(x => `<li>${x}</li>`).join('');
  await sendMail(`[飛比特] 品牌趨勢已自動匯入蝦皮資料${DRY_RUN ? '（試跑）' : ''}`,
    `<p>${DRY_RUN ? '試跑，沒有寫入資料庫。' : '已寫入品牌趨勢資料庫：'}</p><ul>${li(inserted)}</ul>` +
    (unknownAll.length ? `<p>⚠️ 以下商品判斷不出已知品牌，先歸「其他」，要歸哪個品牌請跟 AI 說，下次就會自動歸類：</p><ul>${li(unknownAll)}</ul>` : '') +
    `<p><a href="https://jennifer-shao-ai.github.io/feebit/brand-trend.html">打開品牌趨勢分析</a></p>`);
}

main().catch(async e => {
  console.error('❌', e.message);
  await sendMail('[飛比特] ❌ 品牌趨勢自動匯入失敗', `<p>${e.message}</p><p>請到 GitHub Actions「品牌趨勢自動匯入」看完整紀錄。</p>`);
  process.exit(1);
});
