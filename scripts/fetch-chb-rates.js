// 抓彰化銀行「外幣即期匯率」牌告，存成 data/fx-rates.json（只有匯率，沒有任何成本資料）
// 來源：https://ae.chb.com.tw/accessible/faces/login/CERates_View（彰銀友善專區，公開頁面）
// 規則：頁面解析不到、或匯率明顯不合理，就「不寫檔、報錯」，不要把壞資料存進去。
const fs = require('fs');
const path = require('path');

const URL = 'https://ae.chb.com.tw/accessible/faces/login/CERates_View';
const OUT = path.join(__dirname, '..', 'data', 'fx-rates.json');
const NEED = ['USD', 'JPY', 'CNY']; // 少了這幾個就視為抓取失敗

(async () => {
  const res = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0 (feebit-fx-rates)' } });
  if (!res.ok) throw new Error('彰銀牌告頁 HTTP ' + res.status);
  const html = await res.text();
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '|').replace(/\s+/g, ' ');
  const m = text.match(/資料更新時間:\s*(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})/);
  if (!m) throw new Error('找不到「資料更新時間」，頁面格式可能改了');

  const rates = {};
  const re = /\(([A-Z]{3})(-C)?\)[\s|]*[A-Z]{3}[\s|]*([\d.]+)[\s|]*買入價格[\s|]*([\d.]+)[\s|]*賣出價格/g;
  let r;
  while ((r = re.exec(text))) {
    const code = r[1], cash = !!r[2], buy = parseFloat(r[3]), sell = parseFloat(r[4]);
    if (!(buy > 0 && sell > 0 && sell >= buy)) throw new Error(`${code} 買賣價不合理：${buy}/${sell}`);
    rates[code] = rates[code] || {};
    if (cash) { rates[code].cashBuy = buy; rates[code].cashSell = sell; }
    else { rates[code].buy = buy; rates[code].sell = sell; }
  }
  for (const c of NEED) if (!rates[c] || !rates[c].sell) throw new Error('缺少 ' + c + ' 即期匯率，停止寫檔');
  if (rates.USD.sell < 20 || rates.USD.sell > 50) throw new Error('美金賣出價看起來不合理：' + rates.USD.sell);

  const out = { source: '彰化銀行外幣即期匯率牌告', url: URL, updated: m[1], fetchedAt: new Date().toISOString(),
    note: '即期買入／賣出；cashBuy／cashSell 是現鈔。韓元彰銀牌告沒有，需手動。', rates };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log('OK', m[1], 'USD賣出', rates.USD.sell, 'JPY賣出', rates.JPY.sell, 'CNY賣出', rates.CNY.sell, '幣別數', Object.keys(rates).length);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
