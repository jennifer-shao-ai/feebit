# 食品成分比對工具 — Cloudflare Worker 部署說明

前端工具（`ingredient-checker.html`）不需要這個 Worker 也能用（比對 FIRDI 752 筆快照資料 + 提供查詢連結）。
只有「🤖 AI 查詢法規來源」這個按鈕需要這個 Worker，team 成員才能不用問 Claude Code 就直接在網頁上點出結果。

## 已知資訊
- Cloudflare 帳號：esuse.adobe@gmail.com
- Account ID：d4770362a33e464a2de08079e41c8f66（同 market-tracker）

---

## Step 1：建立 Worker

1. 前往 https://dash.cloudflare.com/d4770362a33e464a2de08079e41c8f66/workers-and-pages
2. 點右上角「建立應用程式」→「建立 Worker」
3. 名稱填：`ingredient-checker`
4. 點「部署」（先部署預設 hello world）
5. 部署成功後點「編輯程式碼」
6. 清除全部預設程式碼，把 `cf-workers/ingredient-checker-worker.js` 全部內容貼上
7. 點右上角「部署」

---

## Step 2：設定 CLAUDE_API_KEY

1. 回到 Worker 頁面 →「設定」分頁 →「變數和機密」
2. 新增：
   - 名稱：`CLAUDE_API_KEY`
   - 值：同 `feebit-line-bot` 這個 Worker 用的那組 Anthropic API Key（可直接沿用，不用另外申請）
   - 類型選「機密（Secret）」
3. 儲存並部署

> 沒有設定這把 key，Worker 仍可運作，但查無 FIRDI 資料時只會回覆制式訊息，不會有 AI 判斷說明。

---

## Step 3：填入前端 Worker 網址

1. 打開飛比特儀表板 →「法規」→「食品成分比對」
2. 點右上角「⚙️ AI 查詢設定」
3. 填入：`https://ingredient-checker.esuse-adobe.workers.dev`
4. 點「測試連線」→ 看到「✅ 連線成功」即完成
5. 點「儲存」

> 這個網址存在每個使用者自己瀏覽器的 localStorage，team 每個人第一次使用都要各自填一次。

---

## 之後更新 FIRDI 資料快照

`data/firdi-food-ingredients.json` 是手動爬取的快照（752 筆，2026-07 建立），FIRDI 網站本身沒有公開 API。
若之後要更新，重新爬取 `https://mms.firdi.org.tw/fl/fmlist?&p=1` 到 `p=38`（每頁 20 筆）並用相同格式重新產生 JSON 即可，不需要改動 Worker 或前端邏輯。
