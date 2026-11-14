// CCA Planner data layer.
// The planner page was first written as a Claude artifact and talks to `window.claude.use("db" | "user" | "downloads")`.
// This file provides that same small interface on top of Supabase (Postgres + Auth + Realtime),
// so the planner code itself did not have to change. It also shows the sign-in screen.
(function () {
  "use strict";
  const cfg = window.CCA_CONFIG || {};
  const TABLES = { clubs: "cca_clubs", students: "cca_students", registers: "cca_registers" };
  // Email links (invitation / password reset) arrive with details in the URL hash; read them before Supabase clears it.
  const linkHash = new URLSearchParams(location.hash.slice(1));
  const arrivedVia = linkHash.get("type");                       // "invite" or "recovery"
  const linkError = linkHash.get("error_description");          // e.g. expired link
  const configured = cfg.SUPABASE_URL && !/YOUR-PROJECT/.test(cfg.SUPABASE_URL) && cfg.SUPABASE_PUBLISHABLE_KEY;
  const sb = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;

  /* ---------- errors: map database refusals to the codes the planner understands ---------- */
  function fail(error) {
    const e = new Error(error && error.message ? error.message : "Save failed");
    if (error && (error.code === "42501" || /permission|not allowed|row-level security/i.test(error.message || ""))) e.code = "invalid_argument";
    throw e;
  }
  function parsePath(path) {
    const [col, id] = String(path).split("/");
    const table = TABLES[col];
    if (!table || !id) throw new Error("Unknown record " + path);
    return { col, id };
  }

  /* ---------- documents ---------- */
  function doc(path) {
    const { col, id } = parsePath(path);
    return {
      async set(data) { const { error } = await sb.rpc("cca_set", { p_col: col, p_id: id, p_data: data }); if (error) fail(error); },
      async update(patch) { const { error } = await sb.rpc("cca_patch", { p_col: col, p_id: id, p_patch: patch }); if (error) fail(error); },
      async delete() { const { error } = await sb.rpc("cca_delete", { p_col: col, p_id: id }); if (error) fail(error); },
    };
  }

  /* ---------- live collections ---------- */
  function collection(col) {
    const table = TABLES[col];
    let max = 1000;
    const api = {
      limit(n) { max = n; return api; },
      onSnapshot(onNext, onError) {
        const rows = new Map();
        let ready = false, timer = null;
        const emit = () => {
          if (!ready) return;
          clearTimeout(timer);
          // Coalesce bursts (an import writes hundreds of rows) into one redraw.
          timer = setTimeout(() => onNext({ docs: [...rows].map(([id, data]) => ({ id, data: () => data })) }), 60);
        };
        async function loadAll() {
          const all = [];
          for (let from = 0; from < max; from += 1000) {
            const { data, error } = await sb.from(table).select("id,data").order("id").range(from, Math.min(from + 999, max - 1));
            if (error) throw error;
            all.push(...data);
            if (data.length < 1000) break;
          }
          rows.clear();
          all.forEach((r) => rows.set(r.id, r.data || {}));
          ready = true;
          emit();
        }
        const channel = sb.channel("cca-" + table)
          .on("postgres_changes", { event: "*", schema: "public", table }, (p) => {
            if (p.eventType === "DELETE") rows.delete(p.old && p.old.id);
            else if (p.new && p.new.id) rows.set(p.new.id, p.new.data || {});
            emit();
          })
          .subscribe((status) => {
            if (status === "SUBSCRIBED") loadAll().catch((e) => onError && onError(e));
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { if (onError) onError(new Error(status)); }
          });
        // Phones pause pages in the background: reload everything when the app comes back.
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ready) loadAll().catch(() => {}); });
        return () => sb.removeChannel(channel);
      },
    };
    return api;
  }

  /* ---------- downloads: save a file on phone or computer ---------- */
  const downloads = {
    async save({ filename, data }) {
      const type = /\.xlsx$/i.test(filename) ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : (data.type || "application/octet-stream");
      const blob = data instanceof Blob && data.type ? data : new Blob([data], { type });
      const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (isIOS && navigator.canShare) {
        const file = new File([blob], filename, { type });
        if (navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: filename }); return; }
          catch (e) { if (e && e.name === "AbortError") return; }
        }
      }
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: filename });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    },
  };

  /* ---------- sign-in screen ---------- */
  const css = `
  .gate{position:fixed;inset:0;z-index:100;background:var(--bg,#F3F5F4);display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom))}
  .gate form{width:min(380px,100%);background:var(--surface,#fff);border:1px solid var(--line,#D5DCD9);border-radius:14px;padding:24px 22px;display:flex;flex-direction:column;gap:14px;box-shadow:var(--shadow)}
  .gate .gl{display:flex;align-items:center;gap:12px}
  .gate .gl img{width:48px;height:48px}
  .gate h2{font-family:var(--display);font-weight:800;font-size:24px;margin:0;line-height:1.1}
  .gate p{margin:0;color:var(--muted)}
  .gate .err{color:var(--bad);font-weight:600}
  .gate .ok{color:var(--good);font-weight:600}
  .gate .btn{justify-content:center;padding:11px 14px}
  .gate .field input{font-size:16px}
  .whoami{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted)}
  @media (max-width:560px){.whoami .em{display:none}}`;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function crest() { const img = document.querySelector(".brand .crest"); return img ? img.src : "icons/icon-192.png"; }

  function gate(mode, msg) {
    let g = document.getElementById("gate");
    if (!g) { g = document.createElement("div"); g.id = "gate"; g.className = "gate"; document.body.appendChild(g); }
    const head = `<div class="gl"><img src="${crest()}" alt=""><div><h2>CCA Planner</h2><p>Sherborne School Jeddah</p></div></div>`;
    if (mode === "setup") {
      g.innerHTML = `<form onsubmit="return false">${head}<p class="err">This copy of the app isn't connected to its database yet.</p><p>Fill in <code>config.js</code> with the Supabase project address and publishable key (see README).</p></form>`;
      return;
    }
    if (mode === "newpass") {
      const intro = arrivedVia === "invite" ? "Welcome! Choose a password for your account. You'll use it with your email to sign in from now on." : "Choose a new password.";
      g.innerHTML = `<form id="gform">${head}<p>${intro}</p>
        <div class="field"><label for="g_pw">New password</label><input id="g_pw" type="password" autocomplete="new-password" minlength="8" required></div>
        ${msg ? `<p class="err">${esc(msg)}</p>` : ""}<button class="btn primary" type="submit">Save password</button></form>`;
      g.querySelector("#gform").onsubmit = async (ev) => {
        ev.preventDefault();
        const { error } = await sb.auth.updateUser({ password: g.querySelector("#g_pw").value });
        if (error) gate("newpass", error.message); else { g.remove(); start(); }
      };
      return;
    }
    const prev = g.querySelector("#g_em") ? g.querySelector("#g_em").value : "";
    g.innerHTML = `<form id="gform">${head}<p>Sign in with the email and password the CCA coordinator gave you.</p>
      <div class="field"><label for="g_em">Email</label><input id="g_em" type="email" autocomplete="username" inputmode="email" required value="${esc(prev)}"></div>
      <div class="field"><label for="g_pw">Password</label><input id="g_pw" type="password" autocomplete="current-password" required></div>
      ${msg ? `<p class="${msg.ok ? "ok" : "err"}">${esc(msg.text || msg)}</p>` : ""}
      <button class="btn primary" type="submit">Sign in</button>
      <button class="linkbtn" type="button" id="g_forgot">Forgot password?</button></form>`;
    const form = g.querySelector("#gform");
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector("[type=submit]"); btn.disabled = true; btn.textContent = "Signing in…";
      const { error } = await sb.auth.signInWithPassword({ email: form.g_em.value.trim(), password: form.g_pw.value });
      if (error) gate("login", /invalid/i.test(error.message) ? "That email and password don't match." : error.message);
      else { g.remove(); start(); }
    };
    g.querySelector("#g_forgot").onclick = async () => {
      const email = form.g_em.value.trim();
      if (!email) { gate("login", "Type your email first, then tap Forgot password."); return; }
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      gate("login", error ? error.message : { ok: true, text: "Check your email for a link to set a new password." });
    };
  }

  /* ---------- the window.claude stand-in ---------- */
  let signedIn; const ready = new Promise((r) => (signedIn = r));
  let started = false;
  function start() {
    if (started) return; started = true;
    sb.auth.getUser().then(({ data }) => {
      const email = data && data.user ? data.user.email : "";
      window.CCA_USER_EMAIL = email;
      const top = document.querySelector(".topin");
      if (top && !document.querySelector(".whoami")) {
        const w = document.createElement("div"); w.className = "whoami";
        w.innerHTML = `<span class="em">${esc(email)}</span><button class="btn small" type="button">Sign out</button>`;
        w.querySelector("button").onclick = async () => { await sb.auth.signOut(); location.reload(); };
        top.appendChild(w);
      }
    });
    signedIn();
  }

  window.claude = {
    async use(name) {
      if (!sb) return null;
      await ready;
      if (name === "db") return { collection, doc };
      if (name === "downloads") return downloads;
      if (name === "user") return {
        async can(perm) {
          if (perm !== "data.write") return true;
          const { data, error } = await sb.rpc("cca_is_editor");
          return error ? false : !!data;
        },
      };
      return null;
    },
  };

  if (!sb) { document.addEventListener("DOMContentLoaded", () => gate("setup")); return; }
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") location.reload();
  });
  sb.auth.getSession().then(({ data }) => {
    const session = data && data.session;
    const show = (mode, msg) => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", () => gate(mode, msg)) : gate(mode, msg);
    if (session && (arrivedVia === "invite" || arrivedVia === "recovery")) show("newpass");
    else if (session) start();
    else if (linkError) (history.replaceState(null, "", location.pathname), show("login", /expired|invalid/i.test(linkError) ? "That email link has expired or was already used. Ask the CCA coordinator for a new invitation, or use Forgot password." : linkError));
    else show("login");
  });
})();
