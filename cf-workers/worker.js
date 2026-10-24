// ════════════════════════════════════════
// market-tracker  Cloudflare Worker
// DB binding: env.DB  (D1: market-tracker-db)
// Env vars:   YOUTUBE_API_KEY (選填)
//             SCRAPINGBEE_KEY  (選填，蝦皮/韓國爬蟲用)
// ════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url  = new URL(request.url);
    const path = url.pathname;
    const q    = url.searchParams;
    try {
      if (path === '/ping')
        return j({ ok: true, ts: new Date().toISOString(), version: '1.0' });

      /* ── Products ── */
      if (path === '/api/products' && request.method === 'GET') {
        const src = q.get('source') || 'momo';
        const sub = q.get('sub')    || '';
        const lim = Math.min(parseInt(q.get('limit') || '20'), 50);
        const wk  = weekKey();
        let rows;
        if (sub) {
          ({ results: rows } = await env.DB.prepare(
            'SELECT * FROM products WHERE source=? AND sub_source=? AND week_key=? ORDER BY rank LIMIT ?'
          ).bind(src, sub, wk, lim).all());
        } else {
          ({ results: rows } = await env.DB.prepare(
            'SELECT * FROM products WHERE source=? AND week_key=? ORDER BY rank LIMIT ?'
          ).bind(src, wk, lim).all());
        }
        // 若本週無資料，回傳最近一次快照
        if (!rows.length) {
          const { results: latest } = await env.DB.prepare(
            'SELECT DISTINCT week_key FROM products WHERE source=? ORDER BY week_key DESC LIMIT 1'
          ).bind(src).all();
          if (latest.length) {
            const lastWk = latest[0].week_key;
            if (sub) {
              ({ results: rows } = await env.DB.prepare(
                'SELECT * FROM products WHERE source=? AND sub_source=? AND week_key=? ORDER BY rank LIMIT ?'
              ).bind(src, sub, lastWk, lim).all());
            } else {
              ({ results: rows } = await env.DB.prepare(
                'SELECT * FROM products WHERE source=? AND week_key=? ORDER BY rank LIMIT ?'
              ).bind(src, lastWk, lim).all());
            }
          }
          return j({ products: rows, source: src, cached: true });
        }
        return j({ products: rows, source: src, week: wk });
      }

      /* ── Scrape trigger ── */
      if (path === '/api/scrape' && request.method === 'POST') {
        const body   = await request.json().catch(() => ({}));
        const source = body.source || 'quick';
        const result = await dispatchScrape(source, env);
        return j(result);
      }

      /* ── Brands ── */
      if (path === '/api/brands') {
        if (request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM brands ORDER BY name').all();
          return j({ brands: results });
        }
        if (request.method === 'POST') {
          const b = await request.json();
          await env.DB.prepare(
            'INSERT OR REPLACE INTO brands (id,name,floor_price) VALUES (?,?,?)'
          ).bind(b.id, b.name, b.floor_price || 0).run();
          return j({ ok: true });
        }
      }
      if (path.startsWith('/api/brands/') && request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM brands WHERE id=?').bind(path.split('/').pop()).run();
        return j({ ok: true });
      }

      /* ── Keywords ── */
      if (path === '/api/keywords') {
        if (request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM keywords ORDER BY created_at').all();
          return j({ keywords: results });
        }
        if (request.method === 'POST') {
          const k = await request.json();
          await env.DB.prepare(
            'INSERT OR REPLACE INTO keywords (id,text,source,visible) VALUES (?,?,?,?)'
          ).bind(k.id, k.text, k.source || 'manual', k.visible !== false ? 1 : 0).run();
          return j({ ok: true });
        }
      }
      if (path.startsWith('/api/keywords/') && request.method === 'DELETE') {
        await env.DB.prepare('DELETE FROM keywords WHERE id=?').bind(path.split('/').pop()).run();
        return j({ ok: true });
      }
      if (path === '/api/keywords/toggle' && request.method === 'POST') {
        const { id, visible } = await request.json();
        await env.DB.prepare('UPDATE keywords SET visible=? WHERE id=?').bind(visible ? 1 : 0, id).run();
        return j({ ok: true });
      }

      /* ── Articles ── */
      if (path === '/api/articles' && request.method === 'GET') {
        const kw  = q.get('keyword') || '';
        const plt = q.get('platform') || '';
        const lim = Math.min(parseInt(q.get('limit') || '5'), 10);
        const wk  = weekKey();
        let rows;
        if (plt) {
          ({ results: rows } = await env.DB.prepare(
            'SELECT * FROM articles WHERE keyword=? AND platform=? AND week_key=? ORDER BY rank LIMIT ?'
          ).bind(kw, plt, wk, lim).all());
          // fallback: latest available
          if (!rows.length) {
            ({ results: rows } = await env.DB.prepare(
              'SELECT * FROM articles WHERE keyword=? AND platform=? ORDER BY week_key DESC, rank LIMIT ?'
            ).bind(kw, plt, lim).all());
          }
        } else {
          ({ results: rows } = await env.DB.prepare(
            'SELECT * FROM articles WHERE keyword=? AND week_key=? ORDER BY platform, rank LIMIT ?'
          ).bind(kw, wk, lim * 4).all());
        }
        return j({ articles: rows, keyword: kw, platform: plt });
      }

      /* ── Shops ── */
      if (path === '/api/shops') {
        if (request.method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM shops WHERE active=1 ORDER BY created_at').all();
          return j({ shops: results });
        }
        if (request.method === 'POST') {
          const s = await request.json();
          await env.DB.prepare(
            'INSERT OR REPLACE INTO shops (id,name,url,active) VALUES (?,?,?,1)'
          ).bind(s.id, s.name, s.url).run();
          return j({ ok: true });
        }
      }
      if (path.startsWith('/api/shops/') && request.method === 'DELETE') {
        await env.DB.prepare('UPDATE shops SET active=0 WHERE id=?').bind(path.split('/').pop()).run();
        return j({ ok: true });
      }

      /* ── Price history ── */
      if (path === '/api/price-history' && request.method === 'GET') {
        const bid = q.get('brand_id');
        if (!bid) return j({ error: 'brand_id required' }, 400);
        const { results } = await env.DB.prepare(
          'SELECT week_key, MIN(price) as min_price, COUNT(*) as shops FROM brand_price_history WHERE brand_id=? GROUP BY week_key ORDER BY week_key'
        ).bind(bid).all();
        return j({ history: results });
      }

      /* ── Scrape logs ── */
      if (path === '/api/logs' && request.method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM scrape_log ORDER BY scraped_at DESC LIMIT 30'
        ).all();
        return j({ logs: results });
      }

      return j({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err.stack);
      return j({ error: err.message }, 500);
    }
  },

  // 每週一 08:00 自動爬取（Cron: 0 0 * * 1）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchScrape('weekly', env));
  }
};

// ════════════════════════════════════════
// Scraping dispatcher
// ════════════════════════════════════════
async function dispatchScrape(mode, env) {
  const wk = weekKey();
  const results = {};

  if (mode === 'weekly' || mode === 'quick' || mode === 'dcard') {
    results.dcard = await scrapeDcard(env, wk);
  }
  if (mode === 'weekly' || mode === 'quick' || mode === 'youtube') {
    results.youtube = await scrapeYoutube(env, wk);
  }
  if (mode === 'weekly' || mode === 'ptt') {
    results.ptt = await scrapePTT(env, wk);
  }
  if ((mode === 'weekly' || mode === 'momo') && env.SCRAPINGBEE_KEY) {
    results.momo = await scrapeMomo(env, wk);
  }

  return { ok: true, mode, week: wk, results };
}

// ── Dcard API（免費公開，無需 key）──
async function scrapeDcard(env, wk) {
  try {
    const kws  = await getKeywords(env);
    let total  = 0;

    for (const kw of kws.slice(0, 8)) {
      const resp = await fetch(
        `https://www.dcard.tw/service/api/v2/search/posts?query=${encodeURIComponent(kw)}&limit=5`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' } }
      );
      if (!resp.ok) continue;
      const data = await resp.json().catch(() => []);
      if (!Array.isArray(data) || !data.length) continue;

      await env.DB.prepare(
        'DELETE FROM articles WHERE keyword=? AND platform=? AND week_key=?'
      ).bind(kw, 'dcard', wk).run();

      for (let i = 0; i < Math.min(data.length, 5); i++) {
        const p    = data[i];
        const url  = `https://www.dcard.tw/f/${p.forumAlias || 'beauty'}/p/${p.id}`;
        const meta = `${(p.createdAt || '').slice(0, 10)} · ${p.forumName || 'Dcard'} · ${p.likeCount || 0} 愛心`;
        await env.DB.prepare(
          'INSERT INTO articles (keyword,platform,title,url,meta,rank,scraped_at,week_key) VALUES (?,?,?,?,?,?,?,?)'
        ).bind(kw, 'dcard', p.title || '', url, meta, i + 1, now(), wk).run();
        total++;
      }
    }
    await log(env, 'dcard', 'success', total);
    return { ok: true, count: total };
  } catch (e) {
    await log(env, 'dcard', 'error', 0, e.message);
    return { ok: false, error: e.message };
  }
}

// ── PTT Beauty 板（公開 HTML）──
async function scrapePTT(env, wk) {
  try {
    const resp = await fetch('https://www.ptt.cc/bbs/Beauty/index.html', {
      headers: { 'Cookie': 'over18=1', 'User-Agent': 'Mozilla/5.0 (compatible)' }
    });
    if (!resp.ok) throw new Error('PTT HTTP ' + resp.status);
    const html    = await resp.text();
    const matches = [...html.matchAll(/href="(\/bbs\/Beauty\/M\.[^"]+)"[^>]*>\s*([^<]+)</g)];
    const kws     = await getKeywords(env);

    for (const kw of kws.slice(0, 8)) {
      await env.DB.prepare(
        'DELETE FROM articles WHERE keyword=? AND platform=? AND week_key=?'
      ).bind(kw, 'ptt', wk).run();

      // 優先挑含關鍵字的文章，不足則用頁面前幾篇
      const hits = matches.filter(m => m[2].includes(kw)).slice(0, 5);
      const fill = matches.slice(0, 5);
      const use  = hits.length >= 3 ? hits : fill;

      for (let i = 0; i < Math.min(use.length, 5); i++) {
        const url   = 'https://www.ptt.cc' + use[i][1];
        const title = use[i][2].trim();
        await env.DB.prepare(
          'INSERT INTO articles (keyword,platform,title,url,meta,rank,scraped_at,week_key) VALUES (?,?,?,?,?,?,?,?)'
        ).bind(kw, 'ptt', title, url, 'PTT Beauty板', i + 1, now(), wk).run();
      }
    }
    await log(env, 'ptt', 'success', matches.length);
    return { ok: true, count: matches.length };
  } catch (e) {
    await log(env, 'ptt', 'error', 0, e.message);
    return { ok: false, error: e.message };
  }
}

// ── YouTube Data API v3 ──
async function scrapeYoutube(env, wk) {
  if (!env.YOUTUBE_API_KEY) return { ok: false, error: 'No YOUTUBE_API_KEY' };
  try {
    const kws  = await getKeywords(env);
    let total  = 0;

    for (const kw of kws.slice(0, 8)) {
      const resp = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(kw + ' 開箱 保養')}&maxResults=5&type=video&relevanceLanguage=zh-TW&key=${env.YOUTUBE_API_KEY}`
      );
      if (!resp.ok) continue;
      const data = await resp.json().catch(() => ({}));
      if (!data.items?.length) continue;

      await env.DB.prepare(
        'DELETE FROM articles WHERE keyword=? AND platform=? AND week_key=?'
      ).bind(kw, 'youtube', wk).run();

      for (let i = 0; i < data.items.length; i++) {
        const it   = data.items[i];
        const vid  = it.id?.videoId;
        if (!vid) continue;
        const url  = `https://www.youtube.com/watch?v=${vid}`;
        const meta = `${(it.snippet.publishedAt || '').slice(0, 10)} · ${it.snippet.channelTitle || ''}`;
        await env.DB.prepare(
          'INSERT INTO articles (keyword,platform,title,url,meta,rank,scraped_at,week_key) VALUES (?,?,?,?,?,?,?,?)'
        ).bind(kw, 'youtube', it.snippet.title || '', url, meta, i + 1, now(), wk).run();
        total++;
      }
    }
    await log(env, 'youtube', 'success', total);
    return { ok: true, count: total };
  } catch (e) {
    await log(env, 'youtube', 'error', 0, e.message);
    return { ok: false, error: e.message };
  }
}

// ── momo 熱銷（需 ScrapingBee key）──
async function scrapeMomo(env, wk) {
  if (!env.SCRAPINGBEE_KEY) return { ok: false, error: 'No SCRAPINGBEE_KEY' };
  try {
    // momo 美妝熱銷分類頁
    const targetUrl = 'https://www.momoshop.com.tw/category/LgrpCategory.jsp?l_code=0301900000&showType=chessboardType&ctype=B';
    const apiUrl    = `https://app.scrapingbee.com/api/v1/?api_key=${env.SCRAPINGBEE_KEY}&url=${encodeURIComponent(targetUrl)}&render_js=false&premium_proxy=false`;

    const resp = await fetch(apiUrl);
    if (!resp.ok) throw new Error('ScrapingBee HTTP ' + resp.status);
    const html = await resp.text();

    // 解析商品卡片（momo 結構）
    const products = parseMomoHtml(html);
    if (!products.length) throw new Error('No products parsed from momo');

    await env.DB.prepare('DELETE FROM products WHERE source=? AND week_key=?').bind('momo', wk).run();

    for (const p of products.slice(0, 20)) {
      await env.DB.prepare(
        `INSERT INTO products (source,sub_source,rank,name,brand,spec,price,orig_price,sales,image_url,product_url,is_new,emoji,scraped_at,week_key)
         VALUES ('momo','',?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(p.rank, p.name, p.brand, p.spec, p.price, p.origPrice, p.sales, p.imgUrl, p.url, p.isNew ? 1 : 0, '🛍️', now(), wk).run();
    }

    await log(env, 'momo', 'success', products.length);
    return { ok: true, count: products.length };
  } catch (e) {
    await log(env, 'momo', 'error', 0, e.message);
    return { ok: false, error: e.message };
  }
}

function parseMomoHtml(html) {
  const products = [];
  // momo 商品卡片正則（依實際 HTML 結構調整）
  const cardRx = /<li[^>]+class="[^"]*goodsItemLi[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  let rank = 1;
  let m;
  while ((m = cardRx.exec(html)) && rank <= 20) {
    const card     = m[1];
    const nameM    = card.match(/class="[^"]*prdName[^"]*"[^>]*>([^<]+)</);
    const priceM   = card.match(/class="[^"]*price[^"]*"[^>]*>.*?(\d[\d,]+)/);
    const imgM     = card.match(/data-src="([^"]+)"/);
    const urlM     = card.match(/href="(\/goods\/[^"]+)"/);
    if (!nameM) continue;
    products.push({
      rank,
      name     : nameM[1].trim(),
      brand    : '',
      spec     : '',
      price    : parseInt((priceM?.[1] || '0').replace(/,/g, '')),
      origPrice: null,
      sales    : null,
      imgUrl   : imgM?.[1] || '',
      url      : urlM ? 'https://www.momoshop.com.tw' + urlM[1] : '',
      isNew    : false,
    });
    rank++;
  }
  return products;
}

// ── Helpers ──
async function getKeywords(env) {
  const { results } = await env.DB.prepare(
    'SELECT text FROM keywords WHERE visible=1 ORDER BY created_at'
  ).all();
  return results.map(r => r.text);
}

async function log(env, source, status, count, errMsg = '') {
  await env.DB.prepare(
    'INSERT INTO scrape_log (source,status,items_count,error_msg) VALUES (?,?,?,?)'
  ).bind(source, status, count, errMsg).run();
}

function j(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function now() { return new Date().toISOString(); }

function weekKey() {
  const d   = new Date();
  const jan = new Date(d.getFullYear(), 0, 1);
  const wk  = Math.ceil(((d - jan) / 86400000 + jan.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(wk).padStart(2, '0')}`;
}
