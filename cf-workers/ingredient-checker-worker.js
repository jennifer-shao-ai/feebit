// ════════════════════════════════════════
// ingredient-checker  Cloudflare Worker
// 用途：food ingredient-checker.html 的「AI 查詢法規來源」後端
// Env vars（Secrets）：CLAUDE_API_KEY（必填，可沿用 feebit-line-bot 同一組金鑰）
// ════════════════════════════════════════

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';
const FIRDI_SEARCH = 'https://mms.firdi.org.tw/fl/fmlist?q=';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/ping') {
        return j({ ok: true, ts: new Date().toISOString(), version: '1.0' });
      }

      if (url.pathname === '/lookup' && request.method === 'POST') {
        const { name } = await request.json();
        if (!name || !name.trim()) return j({ error: 'missing name' }, 400);
        const result = await lookupIngredient(name.trim(), env);
        return j(result);
      }

      return j({ error: 'not found' }, 404);
    } catch (e) {
      return j({ error: e.message }, 500);
    }
  },
};

function j(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}

async function lookupIngredient(name, env) {
  const firdiUrl = FIRDI_SEARCH + encodeURIComponent(name);
  const sources = [firdiUrl];
  let firdiMatches = [];

  // 1) 即時查 FIRDI 站內搜尋（可能收錄我們快照建立之後才新增的原料，或近似名稱）
  try {
    const html = await (await fetch(firdiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    firdiMatches = parseFirdiTable(html).slice(0, 5);
  } catch (e) {
    // FIRDI 網站暫時無法連線，繼續往下走，交給 AI 依現有資訊回答
  }

  // 2) 若 FIRDI 站內查到資料，直接回傳，不需要 AI 幫忙判斷
  if (firdiMatches.length) {
    const lines = firdiMatches.map(r =>
      `「${r.zh_name}」（${r.category}）${r.note ? '－ 限制事項：' + r.note : '－ 無特別限制'}`
    ).join('\n');
    return {
      explanation: `FIRDI 可供食品使用原料清單即時查詢有找到對應資料：\n${lines}`,
      sources,
      matched: true,
    };
  }

  // 3) FIRDI 查無資料，交給 Claude 依既有法規知識做初步判斷（僅供參考）
  if (!env.CLAUDE_API_KEY) {
    return {
      explanation: `FIRDI 清單查無「${name}」的對應資料。此清單僅涵蓋食品原料，若為食品添加物（防腐劑／甜味劑／色素等）需另查 TFDA 食品添加物使用範圍及限量表；建議人工確認。（AI 輔助說明功能尚未設定 CLAUDE_API_KEY）`,
      sources,
      matched: false,
    };
  }

  const tfdaGoogle = `https://www.google.com/search?q=site:fda.gov.tw+${encodeURIComponent(name)}`;
  const mojGoogle = `https://www.google.com/search?q=site:law.moj.gov.tw+${encodeURIComponent(name)}`;
  sources.push(tfdaGoogle, mojGoogle);

  const system = `你是台灣食品法規顧問。使用者查詢某個成分是否可作為食品原料/添加物合法使用於台灣。
你收到的是 FIRDI「可供食品使用原料彙整一覽表」即時查詢結果（查無資料）。
請依你對台灣食品安全衛生管理法、食品添加物使用範圍及限量暨規格標準的知識，判斷這個成分最可能屬於：
(a) 食品添加物（需查 TFDA 食品添加物許可清單）
(b) 化粧品/工業用原料，非食品用途
(c) 尚未核准之新資源食品，需申請查驗登記
(d) 清單中名稱寫法不同（提示可能的正式學名/中文名）
用 100-150 字繁體中文回答，語氣謹慎，明確提醒這是初步參考、正式合規判斷需查閱官方公告，不要幫該成分掛保證合法或違法。`;

  const res = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: `查詢成分：${name}` }],
    }),
  });
  const data = await res.json();
  const explanation = data.content?.[0]?.text?.trim() || 'AI 查詢暫時無法回應，請改用下方連結手動查詢。';

  return { explanation, sources, matched: false };
}

// 解析 FIRDI fmlist 頁面的表格（結構與快照爬蟲相同）
function parseFirdiTable(html) {
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return [];
  const rows = tbodyMatch[1].match(/<tr>([\s\S]*?)<\/tr>/g) || [];
  const records = [];
  for (const row of rows) {
    const tds = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
    if (tds.length !== 6) continue;
    const extract = td => {
      const inner = td.replace(/^<td[^>]*>/, '').replace(/<\/td>$/, '');
      const linkMatch = inner.match(/<a[^>]*>([\s\S]*?)<\/a>/);
      const text = linkMatch ? linkMatch[1] : inner;
      return decodeEntities(text.replace(/<[^>]+>/g, '')).trim();
    };
    const [category, zh_name, en_name, latin_name, part, note] = tds.map(extract);
    if (zh_name) records.push({ category, zh_name, en_name, latin_name, part, note });
  }
  return records;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
