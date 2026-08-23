// fetch-inventory.js
// 由 GitHub Actions 每月 1 日、15 日自動執行
// Node 20 內建 fetch，不需 npm install

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.RAGIC_TOKEN;
if (!TOKEN) { console.error('❌ RAGIC_TOKEN 未設定'); process.exit(1); }

const PRODUCT_URL  = 'https://ap13.ragic.com/feebit50968407/product/16?api&limit=5000';
const RECEIPT_URL  = 'https://ap13.ragic.com/feebit50968407/ragicpurchasing/20007?api&limit=5000';
const COUPANG_URL  = 'https://ap13.ragic.com/feebit50968407/warehouse-management/16?api&limit=5000';
const DATA_FILE   = path.join(__dirname, '..', 'data', 'inventory-snapshots.json');
const MAX_SNAPS   = 26; // 保留最近 26 筆（約 1 年）

const AUTH = { Authorization: 'Basic ' + TOKEN };

async function main() {
  // ── 抓商品庫存 ───────────────────────────────────────
  console.log('🔄 開始抓取 Ragic 商品資料...');
  const res = await fetch(PRODUCT_URL, { headers: AUTH });
  if (!res.ok) throw new Error(`Ragic 商品 API 回傳 ${res.status}`);
  const raw = await res.json();

  const products = {};
  let count = 0;
  for (const [id, row] of Object.entries(raw)) {
    if (id.startsWith('_')) continue;
    const qty  = parseInt(row['數量']) || 0;
    const code = String(row['產品代號'] || id).trim();
    if (!code) continue;
    products[code] = {
      name:   (row['產品名稱'] || '').trim(),
      ean:    (row['EAN13碼']  || '').trim(),
      qty,
      price:  (row['建議售價'] || '').trim(),
      cost:   (row['成本單價'] || '').trim(),
      status: (row['販售狀態'] || '').trim()
    };
    count++;
  }
  console.log(`✅ 取得 ${count} 項商品`);

  // ── 抓進貨單（已結案的補貨紀錄）─────────────────────
  console.log('🔄 開始抓取進貨單...');
  let receipts = {};
  try {
    const rRes = await fetch(RECEIPT_URL, { headers: AUTH });
    if (!rRes.ok) throw new Error(`進貨單 API 回傳 ${rRes.status}`);
    const rRaw = await rRes.json();

    let receiptCount = 0;
    for (const [id, row] of Object.entries(rRaw)) {
      if (id.startsWith('_')) continue;
      if (row['進貨狀態'] !== '結案') continue; // 只取已完成進貨

      const dateRaw = (row['預計到貨日期'] || '').trim();
      if (!dateRaw) continue;
      const date = dateRaw.replace(/\//g, '-'); // "2026/03/10" → "2026-03-10"

      // 展開 subtable 明細（欄位 ID 3001370 為進貨明細子表）
      const subtable = row['_subtable_3001370'] || {};
      for (const [sid, srow] of Object.entries(subtable)) {
        if (sid.startsWith('_')) continue;
        const code = (srow['商品採購編號'] || '').trim();
        const qty  = parseInt(srow['本次進貨數量']) || 0;
        if (!code || qty <= 0) continue;

        if (!receipts[code]) receipts[code] = [];
        receipts[code].push({ date, qty });
        receiptCount++;
      }
    }

    // 每個商品的進貨紀錄按日期排序
    for (const code of Object.keys(receipts)) {
      receipts[code].sort((a, b) => a.date.localeCompare(b.date));
    }
    console.log(`✅ 整理完成 ${receiptCount} 筆已結案進貨紀錄（${Object.keys(receipts).length} 項商品）`);
  } catch (e) {
    console.warn(`⚠️ 進貨單抓取失敗：${e.message}，補貨資料將維持上次`);
    // 保留上次的 receipts（從 db 讀取後會覆蓋）
  }

  // ── 抓酷澎訂單明細 ───────────────────────────────────────
  console.log('🔄 開始抓取酷澎訂單...');
  let coupangOrders = {};
  try {
    const cRes = await fetch(COUPANG_URL, { headers: AUTH });
    if (!cRes.ok) throw new Error(`酷澎訂單 API 回傳 ${cRes.status}`);
    const cRaw = await cRes.json();

    let orderCount = 0;
    for (const [id, row] of Object.entries(cRaw)) {
      if (id.startsWith('_')) continue;
      const sku = (row['SKU'] || '').trim();
      if (!sku) continue; // 沒有內部 SKU 的跳過

      const qty          = parseInt(row['數量']) || 0;
      const deliveryDate = (row['預計交貨日期'] || '').replace(/\//g, '-');
      const poId         = (row['PO ID'] || '').trim();
      const name         = (row['品名'] || '').trim();

      if (!coupangOrders[sku]) coupangOrders[sku] = { totalQty: 0, orders: [] };
      coupangOrders[sku].totalQty += qty;
      coupangOrders[sku].orders.push({ poId, qty, deliveryDate, name });
      orderCount++;
    }

    // 每個 SKU 的訂單按交貨日期排序
    for (const sku of Object.keys(coupangOrders)) {
      coupangOrders[sku].orders.sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
    }
    console.log(`✅ 整理完成 ${orderCount} 筆酷澎訂單明細（${Object.keys(coupangOrders).length} 項 SKU）`);
  } catch (e) {
    console.warn(`⚠️ 酷澎訂單抓取失敗：${e.message}，維持上次資料`);
  }

  // ── 讀取並更新 JSON ───────────────────────────────────
  let db = { snapshots: [], receipts: {} };
  if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
    catch { console.warn('⚠️ 現有 JSON 解析失敗，重新建立'); }
  }

  const today = new Date().toISOString().split('T')[0];

  // 同一天重複執行時，覆蓋當天快照
  const idx  = db.snapshots.findIndex(s => s.date === today);
  const snap = { date: today, products };
  if (idx >= 0) { db.snapshots[idx] = snap; console.log(`♻️ 覆蓋當天快照（${today}）`); }
  else           { db.snapshots.push(snap); }

  // 按日期排序，只保留最近 N 筆
  db.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  if (db.snapshots.length > MAX_SNAPS) db.snapshots = db.snapshots.slice(-MAX_SNAPS);

  // 更新進貨紀錄與酷澎訂單（若抓取成功）
  if (Object.keys(receipts).length > 0)      db.receipts      = receipts;
  if (Object.keys(coupangOrders).length > 0) db.coupangOrders = coupangOrders;

  db.lastUpdated   = today;
  db.productCount  = count;
  db.snapshotCount = db.snapshots.length;

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');

  console.log(`💾 已儲存 data/inventory-snapshots.json`);
  console.log(`   共 ${db.snapshots.length} 筆快照，時間範圍：${db.snapshots[0]?.date} ～ ${today}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
