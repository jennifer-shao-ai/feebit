/**
 * Feebit 工具箱 — 共用身份驗證模組
 */
(function () {
  const SB_URL = 'https://tokhhoyzztaynppcatci.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRva2hob3l6enRheW5wcGNhdGNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMDAyODMsImV4cCI6MjA5MDg3NjI4M30.PQB4lJGF3OMatv5wIedCu3zIWq0urrFbniBRYTbNtUU';
  const VIEWER_ROLE    = 'finance_viewer';
  const VIEWER_ALLOWED = 'finance-dashboard.html';
  const ADMIN_EMAIL    = 'esuse.adobe@gmail.com';

  const path = location.pathname;
  const qs   = location.search;
  if (path.includes('login.html')) return;
  if (path.includes('travel-planner.html') && (qs.includes('share') || qs.includes('collab'))) return;
  if (path.includes('product-image-gen.html') && qs.includes('share')) return;

  document.documentElement.style.visibility = 'hidden';

  function loginUrl() {
    const base = path.replace(/\/[^/]*$/, '');
    return base + '/login.html?next=' + encodeURIComponent(location.href);
  }

  async function loadSDK() {
    if (window.supabase) return;
    await new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      s.onload = ok; s.onerror = fail;
      document.head.appendChild(s);
    });
  }

  // ── 用戶管理 Modal（只對 admin 顯示）──
  function injectUserMgmt(client) {
    // 注入 modal HTML
    const modal = document.createElement('div');
    modal.id = '_um_modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:white;border-radius:12px;padding:28px;width:540px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.15)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
          <h3 style="font-size:16px;font-weight:700;color:#0f172a">👥 用戶權限管理</h3>
          <button onclick="document.getElementById('_um_modal').style.display='none'" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280">✕</button>
        </div>
        <div style="margin-bottom:20px;padding:12px 14px;background:#f0fdf4;border-radius:8px;font-size:12px;color:#15803d;line-height:1.6">
          在這裡加入的 email 會被設定為 <strong>finance_viewer</strong> 角色，只能查看帳務分析頁面，無法存取其他工具。<br>
          不在列表中的帳號（包含你）預設擁有完整權限。
        </div>
        <div style="margin-bottom:16px">
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px">新增用戶</div>
          <div style="display:flex;gap:8px">
            <input id="_um_email" type="email" placeholder="email@example.com" style="flex:1;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px">
            <input id="_um_note" type="text" placeholder="備註（選填）" style="width:120px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px">
            <button id="_um_add" onclick="_umAdd()" style="padding:8px 16px;background:#2563eb;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap">＋ 新增</button>
          </div>
          <div id="_um_err" style="font-size:12px;color:#dc2626;margin-top:6px;min-height:16px"></div>
        </div>
        <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px">已授權用戶</div>
        <div id="_um_list" style="min-height:60px">
          <p style="color:#9ca3af;font-size:13px;text-align:center;padding:20px 0">載入中…</p>
        </div>
      </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
    document.body.appendChild(modal);

    // 載入用戶列表
    window._umLoad = async function () {
      const el = document.getElementById('_um_list');
      const { data, error } = await client.from('user_roles').select('*').order('created_at', { ascending: false });
      if (error) { el.innerHTML = `<p style="color:#dc2626;font-size:13px">載入失敗：${error.message}</p>`; return; }
      if (!data.length) { el.innerHTML = '<p style="color:#9ca3af;font-size:13px;text-align:center;padding:20px 0">尚無授權用戶</p>'; return; }
      el.innerHTML = data.map(r => `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #f3f4f6;border-radius:8px;margin-bottom:6px">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.email}</div>
            <div style="font-size:11px;color:#9ca3af;margin-top:1px">${r.note||''}　角色：${r.role}　${r.created_at?.slice(0,10)||''}</div>
          </div>
          <button onclick="_umDelete('${r.email.replace(/'/g,"\\'")}',this)" style="padding:4px 10px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#dc2626;font-size:12px;cursor:pointer;white-space:nowrap">移除</button>
        </div>`).join('');
    };

    window._umAdd = async function () {
      const email = document.getElementById('_um_email').value.trim().toLowerCase();
      const note  = document.getElementById('_um_note').value.trim();
      const err   = document.getElementById('_um_err');
      err.textContent = '';
      if (!email || !email.includes('@')) { err.textContent = '請輸入有效的 email'; return; }
      const btn = document.getElementById('_um_add');
      btn.disabled = true; btn.textContent = '新增中…';
      const { error } = await client.from('user_roles').upsert({ email, role: VIEWER_ROLE, note }, { onConflict: 'email' });
      btn.disabled = false; btn.textContent = '＋ 新增';
      if (error) { err.textContent = '失敗：' + error.message; return; }
      document.getElementById('_um_email').value = '';
      document.getElementById('_um_note').value  = '';
      _umLoad();
    };

    window._umDelete = async function (email, btn) {
      if (!confirm(`確定移除 ${email} 的授權？`)) return;
      btn.disabled = true; btn.textContent = '移除中…';
      await client.from('user_roles').delete().eq('email', email);
      _umLoad();
    };

    // 開啟 modal 時自動載入
    window._umOpen = function () {
      document.getElementById('_um_modal').style.display = 'flex';
      _umLoad();
    };
  }

  function addTopbarUI(session, isAdmin, client) {
    const topbarRight = document.querySelector('.topbar > div:last-child');
    if (!topbarRight || document.getElementById('_auth_logout')) return;
    const email = (session.user?.email || '').split('@')[0];
    const wrap  = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0';

    const adminBtn = isAdmin
      ? `<button onclick="_umOpen()" style="font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid #e5e7eb;background:white;cursor:pointer;white-space:nowrap">👥 用戶</button>`
      : '';

    wrap.innerHTML =
      `<span style="font-size:11px;color:var(--gray-500);white-space:nowrap">${email}</span>` +
      adminBtn +
      `<button id="_auth_logout" class="btn btn-outline" style="font-size:12px;padding:4px 10px;white-space:nowrap">登出</button>`;

    wrap.querySelector('#_auth_logout').onclick = async () => {
      await client.auth.signOut();
      location.href = loginUrl().split('?')[0];
    };
    topbarRight.insertBefore(wrap, topbarRight.firstChild);

    if (isAdmin) injectUserMgmt(client);
  }

  async function run() {
    try {
      await loadSDK();
      window._authClient = window.supabase.createClient(SB_URL, SB_KEY);
      const client = window._authClient;

      const { data: { session } } = await client.auth.getSession();
      if (!session) { location.href = loginUrl(); return; }

      const userEmail = session.user?.email || '';

      // 查 user_roles 表取得角色（找不到 = 完整管理員）
      const { data: roleRow } = await client.from('user_roles').select('role').eq('email', userEmail).maybeSingle();
      const role     = roleRow?.role || '';
      const isViewer = role === VIEWER_ROLE;
      const isAdmin  = !isViewer;

      // viewer 只能進 finance-dashboard.html
      if (isViewer && !path.includes(VIEWER_ALLOWED)) {
        const base = path.replace(/\/[^/]*$/, '');
        location.href = base + '/' + VIEWER_ALLOWED;
        return;
      }

      if (isViewer) {
        window._feebitViewerMode = true;
        // 先套用限制，再顯示頁面（頁面仍是 hidden 狀態，不會閃）
        const restrict = () => {
          // 隱藏側邊欄
          const sb = document.getElementById('sidebar');
          const ov = document.getElementById('sidebar-overlay');
          const hb = document.querySelector('.btn-hamburger');
          if (sb) sb.style.display = 'none';
          if (ov) ov.style.display = 'none';
          if (hb) hb.style.display = 'none';
          // main 不需要 sidebar 的 margin
          const main = document.getElementById('main');
          if (main) main.style.marginLeft = '0';
          // 隱藏管理按鈕（用文字比對，兼容各頁面）
          const hideKeywords = ['初始化DB','Ragic 設定','Debug','Ragic 同步','上傳CSV','⬆','⚙️','🔎','🔗','↻'];
          document.querySelectorAll('.topbar button').forEach(btn => {
            const t = btn.textContent.trim();
            if (hideKeywords.some(k => t.includes(k))) btn.style.display = 'none';
          });
          const syncBtn = document.getElementById('sync-btn');
          if (syncBtn) syncBtn.style.display = 'none';
          const balBtn = document.getElementById('balance-refresh-btn');
          if (balBtn) balBtn.style.display = 'none';
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', restrict);
        else restrict();
      }

      document.documentElement.style.visibility = '';

      const showUI = () => addTopbarUI(session, isAdmin, client);
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showUI);
      else showUI();

    } catch (e) {
      console.error('[auth.js]', e);
      document.documentElement.style.visibility = '';
    }
  }

  run();
})();
