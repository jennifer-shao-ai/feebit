/**
 * 全產品成本利潤中心 — 計算核心（純函式，無網路、無儲存）
 * 公式出處：Jennifer 的 Sheet「(訂價)新品成本毛利率計算總表」
 *   真實未稅成本 AA = Ragic「成本單價」× (1 − 入系統毛利)   （成本單價是「入系統成本」＝ AA ÷ 0.9）
 *   含稅成本     = AA × 1.05
 *   階梯價（未稅）= AA ÷ (1 − 毛利率)；稅外加 = 未稅 × 1.05
 *   平台利潤     = 售價 − 售價 × 平台總抽成 − 成本 × (平台有稅金 ? 1.05 : 1)
 *   打平價       = 成本 × (1.05 或 1) ÷ (1 − 平台總抽成)，小數無條件進位
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProfitCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TAX = 1.05;

  function num(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  // Ragic 成本單價 → 真實未稅成本；沒填或 0 → null
  function trueCost(ragicCostUnit, sysMargin) {
    const n = num(ragicCostUnit);
    if (n === null || n <= 0) return null;
    return n * (1 - (sysMargin === undefined ? 0.10 : sysMargin));
  }

  // 真實未稅成本 → 要寫回 Ragic 的成本單價（先預留，第一版不寫入）
  function toRagicCost(aa, sysMargin) {
    return aa / (1 - (sysMargin === undefined ? 0.10 : sysMargin));
  }

  function ladder(aa, margins) {
    return margins.map(m => ({ m, ex: aa / (1 - m), inc: aa / (1 - m) * TAX }));
  }

  // 依日期挑出生效中的費率期；date 格式 YYYY-MM-DD
  function scheduleAt(schedules, date) {
    const hit = schedules.filter(s => s.effective <= date && (!s.until || date <= s.until));
    if (hit.length) return hit[hit.length - 1];
    // 日期落在空窗：取生效日最近且不晚於該日的，否則取最早的
    const past = schedules.filter(s => s.effective <= date);
    return past.length ? past[past.length - 1] : schedules[0];
  }

  function latestSchedule(schedules) {
    return schedules.slice().sort((a, b) => a.effective.localeCompare(b.effective)).pop();
  }

  function findPlatform(fees, schedule, id) {
    if (!id) return null;
    const hit = schedule.platforms.find(p => p.id === id);
    if (hit) return hit;
    return (fees.unscheduled || []).find(p => p.id === id) || null;
  }

  function costMult(p) { return p.tax > 0 ? TAX : 1; }

  function profit(price, aa, p) {
    return price - price * p.total - aa * costMult(p);
  }

  // 利潤 ÷ 售價；售價不合理時 null
  function marginRate(price, aa, p) {
    return price > 0 ? profit(price, aa, p) / price : null;
  }

  // 達到目標利潤率 t（以售價為分母）的最低售價；t=0 即打平價
  function breakEven(aa, p, t) {
    const d = 1 - p.total - (t || 0);
    if (d <= 0) return null;
    return Math.ceil(aa * costMult(p) / d - 1e-9);
  }

  function norm(s) {
    return String(s === undefined || s === null ? '' : s).normalize('NFKC').toLowerCase();
  }

  // 全形半形、大小寫不分；多個詞用空白分隔，需全部命中
  function matchTokens(haystack, query) {
    const toks = norm(query).split(/\s+/).filter(Boolean);
    const h = norm(haystack);
    return toks.every(t => h.includes(t));
  }

  // Ragic 單筆原始資料 → 精簡商品物件（欄位名稱即 Ragic 表單的欄位名稱）
  function normalizeProduct(raw, priceFields) {
    const prices = {};
    (priceFields || []).forEach(pf => { prices[pf.field] = num(raw[pf.field]); });
    const o = {
      rid: raw._ragicId,
      code: String(raw['產品代號'] || '').trim(),
      name: String(raw['產品名稱'] || '').trim(),
      en: String(raw['英文名稱'] || '').trim(),
      brand: String(raw['品牌'] || '').trim(),
      supplier: String(raw['廠商簡稱'] || '').trim(),
      supplierCode: String(raw['廠商代號'] || '').trim(),
      ean: String(raw['EAN13碼'] || '').trim(),
      intl: String(raw['國際條碼 (盒損不要填)'] || '').trim(),
      costRaw: num(raw['成本單價']),
      list: num(raw['建議售價']),
      staff: num(raw['員購價(每月限購2)']),
      wholesale: num(raw['批發價']),
      minPrice: num(raw['最低售價']),
      prices,
      saleStatus: String(raw['販售狀態'] || '').trim(),
      listed: String(raw['持續上架'] || '').trim(),
      cond: String(raw['商品狀態'] || '').trim(),
      image: String(raw['產品圖片'] || '').trim(),
      lastIn: String(raw['最後進貨日'] || '').trim(),
      qty: num(raw['數量'])
    };
    o.hay = [o.code, o.name, o.en, o.brand, o.supplier, o.supplierCode, o.ean, o.intl].join(' ');
    return o;
  }

  function isDiscontinued(p) {
    return p.saleStatus === '已停產';
  }

  return { TAX, num, trueCost, toRagicCost, ladder, scheduleAt, latestSchedule, findPlatform,
           costMult, profit, marginRate, breakEven, norm, matchTokens, normalizeProduct, isDiscontinued };
});
