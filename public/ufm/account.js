/*
 * Saving & accounts.
 *
 * - Local saves: the full career is written to IndexedDB (no 5 MB quota like
 *   localStorage, which large careers exceeded so saving silently failed).
 *   localStorage is still written as a fallback when it fits.
 * - Cloud saves: the career JSON is gzip-compressed and stored through the
 *   /api/public/saves server route (Lovable Cloud). A 10-character code is returned.
 * - Accounts: "Sign in with Google" through Lovable Cloud (./identity.js is built from
 *   src/game/auth-bridge.ts). Saves made while signed in are listed on every device.
 */

const DB_NAME = "ufm";
const STORE = "saves";
const LOCAL_KEY = "ufm.save.v2";

/* ------------------------------------------------------------ IndexedDB */

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}
async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const idbGet = (k) => idb("readonly", (s) => s.get(k));
export const idbSet = (k, v) => idb("readwrite", (s) => s.put(v, k));
export const idbDel = (k) => idb("readwrite", (s) => s.delete(k));

/* --------------------------------------------------------- local saving */

let cache = null; // newest known local save string
const savedAtOf = (str) => {
  const m = /"savedAt":"([^"]+)"/.exec(str.slice(-400)) || /"savedAt":"([^"]+)"/.exec(str);
  return m ? m[1] : "";
};

/** Loads the IndexedDB save into memory. Resolves true if a save exists. */
export async function initLocal() {
  try {
    const v = await idbGet("current");
    if (typeof v === "string" && v) {
      const ls = safeLocalGet();
      cache = !ls || savedAtOf(v) >= savedAtOf(ls) ? v : ls;
      return true;
    }
  } catch {}
  return safeLocalGet() != null;
}
function safeLocalGet() {
  try {
    return localStorage.getItem(LOCAL_KEY) ?? localStorage.getItem("ufm.save.v1");
  } catch {
    return null;
  }
}
/** Newest local save as a JSON string (or null). */
export function readLocal() {
  const ls = safeLocalGet();
  if (cache && (!ls || savedAtOf(cache) >= savedAtOf(ls))) return cache;
  return ls;
}
/** Writes a save. Returns true when at least one storage accepted it. */
export function writeLocal(str) {
  cache = str;
  let ok = false;
  try {
    localStorage.setItem(LOCAL_KEY, str);
    ok = true;
  } catch {
    // too big for localStorage: drop the stale copy so it never wins on load
    try {
      localStorage.removeItem(LOCAL_KEY);
      localStorage.removeItem("ufm.save.v1");
    } catch {}
  }
  const hasIdb = typeof indexedDB !== "undefined";
  if (hasIdb) idbSet("current", str).catch((e) => console.warn("IndexedDB save failed", e));
  return ok || hasIdb;
}

/* ---------------------------------------------------------- compression */

async function streamToBytes(stream) {
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export async function pack(str) {
  if (typeof CompressionStream === "undefined") return "raw:" + str;
  const cs = new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"));
  return "gz:" + bytesToB64(await streamToBytes(cs));
}
export async function unpack(data) {
  if (data.startsWith("raw:")) return data.slice(4);
  if (data.startsWith("gz:")) {
    const ds = new Blob([b64ToBytes(data.slice(3))]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new TextDecoder().decode(await streamToBytes(ds));
  }
  return data; // legacy plain JSON
}

/* ---------------------------------------------------------- cloud saves */

async function api(method, query, body) {
  const headers = {};
  if (body) headers["content-type"] = "application/json";
  try {
    const tok = await (await identity())?.getToken?.();
    if (tok) headers.authorization = `Bearer ${tok}`;
  } catch {}
  const res = await fetch("/api/public/saves" + (query || ""), {
    method,
    credentials: "same-origin",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  if (!res.ok) {
    const err = new Error(json?.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

/** Replacement for the old server function: { data: {id, managerName, clubName, season, data} } -> { id } */
export async function cloudSave({ data: d }) {
  return api("POST", "", { ...d, data: await pack(d.data) });
}
/** Replacement for the old server function: { data: {id} } -> { found, data, clubName } */
export async function cloudLoad({ data: d }) {
  const r = await api("GET", `?code=${encodeURIComponent(d.id)}`);
  if (!r?.found) return { found: false };
  return { ...r, data: await unpack(r.data) };
}
export const listMine = () => api("GET", "").then((r) => r.saves || []);
export const deleteSave = (code) => api("DELETE", `?code=${encodeURIComponent(code)}`);

/* ------------------------------------------------------------ identity */

let idPromise = null;
function identity() {
  idPromise ??= import("./identity.js?v=2").catch((e) => {
    console.warn("Identity client unavailable", e);
    return null;
  });
  return idPromise;
}

let currentUser = null;
let providers = null; // { google: bool, email: bool, ... } from the Identity settings
let signupDisabled = false;
let authAvailable = false; // false when the hosting has no sign-in service
let authNotice = null; // "recovery" | "confirmed" | "callback-error"
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(currentUser));
let authReady = null;
function initAuth() {
  authReady ??= (async () => {
    const id = await identity();
    if (!id) return;
    const hadHash = typeof location !== "undefined" && /(access_token|error|_token)=/.test(location.hash);
    try {
      const r = await id.handleAuthCallback();
      if (r?.user) currentUser = r.user;
      if (r?.type === "recovery") authNotice = "recovery";
      else if (r?.type === "confirmation") authNotice = "confirmed";
    } catch (e) {
      console.warn("Auth callback failed", e);
      authNotice = "callback-error";
    }
    if (hadHash && typeof history !== "undefined") history.replaceState(null, "", location.pathname + location.search);
    try {
      const st = await id.getSettings();
      authAvailable = true;
      providers = st?.providers || null;
      signupDisabled = !!st?.disableSignup;
    } catch {}
    try {
      currentUser = currentUser || (await id.getUser());
    } catch {}
    try {
      id.onAuthChange((ev, user) => {
        currentUser = user || null;
        emit();
      });
    } catch {}
    emit();
  })();
  return authReady;
}
if (typeof window !== "undefined") initAuth();

/** Background sync of a career already linked to the signed-in account. */
let lastSync = 0;
let syncing = false;
export function maybeAutoSync(game, meta) {
  if (!currentUser || !game?.cloudId || syncing) return;
  const now = Date.now();
  if (now - lastSync < 180000) return;
  lastSync = now;
  syncing = true;
  cloudSave({ data: { id: game.cloudId, ...meta(game), data: JSON.stringify(game) } })
    .catch((e) => console.warn("Account sync failed", e))
    .finally(() => (syncing = false));
}

/* ------------------------------------------------------------------ UI */

/* Styles for the email sign-in form (kept here so no CSS file has to change). */
if (typeof document !== "undefined" && !document.getElementById("acc-gfont")) {
  const lk = document.createElement("link");
  lk.id = "acc-gfont";
  lk.rel = "stylesheet";
  lk.href = "https://fonts.googleapis.com/css2?family=Google+Sans:wght@500&display=swap";
  document.head.appendChild(lk);
}
if (typeof document !== "undefined" && !document.getElementById("acc-form-css")) {
  const st = document.createElement("style");
  st.id = "acc-form-css";
  st.textContent =
    ".acc-links{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center}" +
    ".acc-google{display:inline-flex;align-items:center;gap:10px;padding:0 12px;height:40px;width:fit-content;border:1px solid #747775;background:#FFFFFF;color:#1F1F1F;font-family:'Google Sans',var(--font-sans,system-ui),sans-serif;font-weight:500;font-size:14px;line-height:20px}" +
    ".acc-google:hover{background:#F8F9FA;color:#1F1F1F}" +
    ".acc-g-logo{width:18px;height:18px;flex:none}" +
    ".acc-form{display:grid;gap:.6rem;padding:.75rem;border:1px solid var(--border);border-radius:.6rem;background:var(--muted)}" +
    ".acc-field{display:grid;gap:.25rem;font-size:.85rem;font-weight:500}" +
    ".acc-field input{height:2.25rem;padding:0 .6rem;border:1px solid var(--input,var(--border));border-radius:calc(var(--radius,.5rem) - 2px);background:var(--background);color:var(--foreground);font-size:.9rem}" +
    ".acc-field input:focus-visible{outline:none;border-color:var(--ring);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring) 50%,transparent)}";
  document.head.appendChild(st);
}

export function createAccount(deps) {
  const { React, useI18n, Button, toast } = deps;
  const { useEffect, useState, useCallback } = React;
  const h = React.createElement;

  function useUser() {
    const [user, setUser] = useState(currentUser);
    const [ready, setReady] = useState(false);
    useEffect(() => {
      const fn = (u) => setUser(u);
      listeners.add(fn);
      initAuth().finally(() => {
        setUser(currentUser);
        setReady(true);
      });
      return () => listeners.delete(fn);
    }, []);
    return { user, ready };
  }

  const GoogleIcon = () =>
    h(
      "svg",
      { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": "true", className: "acc-g-logo" },
      h("path", { fill: "#4285F4", d: "M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" }),
      h("path", { fill: "#34A853", d: "M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" }),
      h("path", { fill: "#FBBC05", d: "M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" }),
      h("path", { fill: "#EA4335", d: "M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" }),
    );

  /**
   * props: game (active career, optional), meta(game) -> {managerName, clubName, season},
   *        onLoad(gameJson), onLinked(code)
   */
  return function AccountPanel({ wrapClass, ...props }) {
    const { ready } = useUser();
    if (!ready || !authAvailable) return null;
    const panel = h(AccountPanelInner, props);
    return wrapClass ? h("div", { className: wrapClass }, panel) : panel;
  };

  function AccountPanelInner({ game, meta, onLoad, onLinked, compact }) {
    const { L } = useI18n();
    const { user, ready } = useUser();
    const [saves, setSaves] = useState(null);
    const [busy, setBusy] = useState(null);
    const [err, setErr] = useState(null);
    const [info, setInfo] = useState(null);
    const [mode, setMode] = useState(null); // null | "login" | "signup" | "forgot" | "reset"
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [googleOn, setGoogleOn] = useState(null);
    useEffect(() => {
      if (!ready) return;
      setGoogleOn(providers ? !!providers.google : null);
      if (authNotice === "recovery") setMode("reset");
      else if (authNotice === "confirmed") setInfo(L("E-postanız onaylandı, giriş yapıldı.", "Email confirmed, you're signed in."));
      else if (authNotice === "callback-error") setErr(L("Giriş tamamlanamadı. Tekrar deneyin.", "Sign-in could not be completed. Try again."));
      authNotice = null;
    }, [ready]);

    const refresh = useCallback(() => {
      if (!user) return setSaves(null);
      listMine()
        .then(setSaves)
        .catch((e) => {
          setSaves([]);
          if (e.status !== 401) setErr(L("Kayıtlar alınamadı.", "Could not fetch saves."));
        });
    }, [user?.id]);
    useEffect(refresh, [refresh]);

    async function signIn() {
      setErr(null);
      const id = await identity();
      if (!id) return setErr(L("Giriş servisi şu an kullanılamıyor.", "Sign-in is unavailable right now."));
      let googleOn = providers?.google;
      if (googleOn == null) {
        try {
          googleOn = !!(await id.getSettings())?.providers?.google;
        } catch {
          googleOn = false;
        }
      }
      if (!googleOn) {
        setMode("login");
        return setErr(
          L(
            "Google ile giriş bu sitede henüz etkin değil. Şimdilik e-posta ve şifre ile giriş yapabilirsiniz.",
            "Google sign-in isn't enabled on this site yet. You can sign in with email and password for now.",
          ),
        );
      }
      setBusy("auth");
      try {
        const r = await id.oauthLogin("google");
        if (r?.user) {
          currentUser = r.user;
          emit();
        }
      } catch (e) {
        setErr(L("Google ile giriş tamamlanamadı. Tekrar deneyin.", "Google sign-in could not be completed. Try again."));
      } finally {
        setBusy(null);
      }
    }
    async function submitEmail(e) {
      e.preventDefault();
      setErr(null);
      setInfo(null);
      const id = await identity();
      if (!id) return setErr(L("Giriş servisi şu an kullanılamıyor.", "Sign-in is unavailable right now."));
      setBusy("auth");
      try {
        if (mode === "signup") {
          await id.signup(email.trim(), password, { full_name: email.trim().split("@")[0] });
          if (!(await id.getUser().catch(() => null))) {
            setInfo(L("Hesap oluşturuldu. E-postanıza gelen onay bağlantısına tıklayın, ardından giriş yapın.", "Account created. Click the confirmation link in your email, then sign in."));
            setMode("login");
          }
        } else if (mode === "forgot") {
          await id.requestPasswordRecovery(email.trim());
          setInfo(L("Şifre sıfırlama bağlantısı e-postanıza gönderildi.", "A password reset link was sent to your email."));
          setMode("login");
        } else if (mode === "reset") {
          await id.updateUser({ password });
          setInfo(L("Şifreniz güncellendi.", "Your password was updated."));
          setMode(null);
        } else {
          await id.login(email.trim(), password);
        }
        setPassword("");
        try {
          currentUser = (await id.getUser()) || currentUser;
        } catch {}
        emit();
      } catch (ex) {
        const st = ex?.status ?? ex?.cause?.status;
        const msg = String(ex?.message || "") + " " + String(ex?.cause?.json?.msg || ex?.cause?.json?.error_description || "");
        if (/not confirmed/i.test(msg))
          return setErr(L("E-postanız henüz onaylanmadı. Gelen kutunuzdaki onay bağlantısına tıklayın.", "Your email isn't confirmed yet. Click the confirmation link in your inbox."));
        setErr(
          /invalid_grant/i.test(msg) || st === 401 || st === 400
            ? mode === "signup"
              ? L("Kayıt yapılamadı. E-posta geçersiz olabilir ya da şifre en az 6 karakter olmalı.", "Sign-up failed. The email may be invalid or the password needs at least 6 characters.")
              : L("E-posta veya şifre hatalı ya da e-posta henüz onaylanmadı.", "Wrong email or password, or the email isn't confirmed yet.")
            : st === 422
              ? L("E-posta geçersiz, zaten kayıtlı ya da şifre çok kısa.", "The email is invalid or already registered, or the password is too short.")
              : st === 403
                ? L("Yeni kayıtlar şu an kapalı.", "Sign-ups are currently closed.")
                : L("İşlem başarısız oldu. Tekrar deneyin.", "Something went wrong. Try again."),
        );
      } finally {
        setBusy(null);
      }
    }
    async function signOut() {
      const id = await identity();
      try {
        await id?.logout();
      } catch {}
      currentUser = null;
      emit();
    }
    async function saveToAccount() {
      if (!game) return;
      setBusy("save");
      setErr(null);
      try {
        const r = await cloudSave({ data: { id: game.cloudId, ...meta(game), data: JSON.stringify(game) } });
        onLinked?.(r.id);
        toast.success(L("Kariyer hesabınıza kaydedildi", "Career saved to your account"));
        refresh();
      } catch (e) {
        setErr(
          e.status === 413
            ? L("Kayıt çok büyük.", "The save is too large.")
            : e.status === 409
              ? L("Hesap başına en fazla 20 kayıt tutulabilir. Eski bir kaydı silin.", "Up to 20 saves per account. Delete an old one.")
              : L("Hesaba kaydetme başarısız oldu. Tekrar deneyin.", "Saving to your account failed. Try again."),
        );
      } finally {
        setBusy(null);
      }
    }
    async function load(code) {
      setBusy(code);
      setErr(null);
      try {
        const r = await cloudLoad({ data: { id: code } });
        if (!r.found) throw new Error("not found");
        const g = JSON.parse(r.data);
        g.cloudId = code;
        onLoad?.(g, r);
      } catch {
        setErr(L("Kayıt yüklenemedi.", "The save could not be loaded."));
      } finally {
        setBusy(null);
      }
    }
    async function remove(code) {
      if (typeof window !== "undefined" && !window.confirm(L("Bu kayıt silinsin mi?", "Delete this save?"))) return;
      setBusy(code);
      try {
        await deleteSave(code);
        refresh();
      } catch {
        setErr(L("Silinemedi.", "Could not delete."));
      } finally {
        setBusy(null);
      }
    }

    const fmt = (d) => {
      try {
        return new Date(d).toLocaleString(L("tr-TR", "en-GB"), { dateStyle: "medium", timeStyle: "short" });
      } catch {
        return "";
      }
    };

    // Hidden until the sign-in service answers (also keeps the first render identical to the
    // prerendered page, avoiding a hydration mismatch).
    return h(
      "section",
      { className: `acc ${compact ? "acc--compact" : ""} rounded-xl border bg-card p-4` },
      h(
        "div",
        { className: "acc-head" },
        h(
          "div",
          null,
          h("p", { className: "acc-title" }, L("Hesap ile Bulut Kaydı", "Save to Your Account")),
          h(
            "p",
            { className: "acc-sub" },
            user
              ? L(`${user.email || user.name} olarak giriş yapıldı`, `Signed in as ${user.email || user.name}`)
              : L(
                  providers?.email === false
                    ? "Google hesabınla giriş yap; kariyerlerin hesabına kaydedilsin ve her cihazdan devam et."
                    : "Google veya e-posta ile giriş yapın; kariyerleriniz hesabınıza kaydedilsin ve her cihazdan devam edin.",
                  providers?.email === false
                    ? "Sign in with Google to keep your careers in your account and continue on any device."
                    : "Sign in with Google or email to keep your careers in your account and continue on any device.",
                ),
          ),
        ),
        user && h(Button, { size: "sm", variant: "ghost", onClick: signOut }, L("Çıkış", "Sign out")),
      ),
      !user &&
        googleOn !== false &&
        h(
          Button,
          { variant: "outline", className: "acc-google", onClick: signIn, disabled: !ready || busy === "auth" },
          h(GoogleIcon),
          h("span", null, L("Google ile oturum aç", "Sign in with Google")),
        ),
      !user &&
        googleOn === false &&
        !mode &&
        h(
          "p",
          { className: "acc-note" },
          L("Google ile giriş şu an kapalı; e-posta ile giriş yapabilirsiniz.", "Google sign-in is currently off; you can sign in with email."),
        ),
      (!user || mode === "reset") &&
        !mode &&
        providers?.email !== false &&
        h(
          "div",
          { className: "acc-links" },
          h(Button, { size: "sm", variant: googleOn === false ? "outline" : "ghost", onClick: () => (setErr(null), setMode("login")), disabled: !ready }, L("E-posta ile giriş", "Sign in with email")),
          !signupDisabled && h(Button, { size: "sm", variant: "ghost", onClick: () => (setErr(null), setMode("signup")), disabled: !ready }, L("Hesap oluştur", "Create account")),
        ),
      mode &&
        (!user || mode === "reset") &&
        h(
          "form",
          { className: "acc-form", onSubmit: submitEmail },
          h(
            "p",
            { className: "acc-list-title" },
            mode === "signup"
              ? L("Hesap oluştur", "Create account")
              : mode === "forgot"
                ? L("Şifremi unuttum", "Forgot password")
                : mode === "reset"
                  ? L("Yeni şifre belirle", "Set a new password")
                  : L("E-posta ile giriş", "Sign in with email"),
          ),
          mode !== "reset" &&
            h(
              "label",
              { className: "acc-field" },
              h("span", null, L("E-posta", "Email")),
              h("input", { type: "email", required: true, autoComplete: "email", value: email, onChange: (e) => setEmail(e.target.value) }),
            ),
          mode !== "forgot" &&
            h(
              "label",
              { className: "acc-field" },
              h("span", null, mode === "reset" ? L("Yeni şifre", "New password") : L("Şifre", "Password")),
              h("input", {
                type: "password",
                required: true,
                minLength: mode === "login" ? undefined : 6,
                autoComplete: mode === "login" ? "current-password" : "new-password",
                value: password,
                onChange: (e) => setPassword(e.target.value),
              }),
            ),
          h(
            "div",
            { className: "acc-links" },
            h(
              Button,
              { type: "submit", size: "sm", disabled: busy === "auth" },
              busy === "auth"
                ? L("Bekleyin…", "Please wait…")
                : mode === "signup"
                  ? L("Kayıt ol", "Sign up")
                  : mode === "forgot"
                    ? L("Bağlantı gönder", "Send link")
                    : mode === "reset"
                      ? L("Şifreyi kaydet", "Save password")
                      : L("Giriş yap", "Sign in"),
            ),
            mode === "login" && h(Button, { type: "button", size: "sm", variant: "ghost", onClick: () => (setErr(null), setMode("forgot")) }, L("Şifremi unuttum", "Forgot password")),
            mode === "login" && !signupDisabled && h(Button, { type: "button", size: "sm", variant: "ghost", onClick: () => (setErr(null), setMode("signup")) }, L("Hesap oluştur", "Create account")),
            mode !== "reset" && h(Button, { type: "button", size: "sm", variant: "ghost", onClick: () => (setErr(null), setMode(null)) }, L("Vazgeç", "Cancel")),
          ),
        ),
      info && h("p", { className: "acc-note", role: "status" }, info),
      user &&
        game &&
        h(
          Button,
          { onClick: saveToAccount, disabled: busy === "save" },
          busy === "save" ? L("Kaydediliyor…", "Saving…") : L("Hesabıma Kaydet", "Save to My Account"),
        ),
      user &&
        game?.cloudId &&
        h(
          "p",
          { className: "acc-note" },
          L(
            "Bu kariyer hesabınıza bağlı; oynarken birkaç dakikada bir otomatik olarak güncellenir.",
            "This career is linked to your account and syncs automatically every few minutes while you play.",
          ),
        ),
      user &&
        h(
          "div",
          { className: "acc-list" },
          h("p", { className: "acc-list-title" }, L("Hesabımdaki kayıtlar", "Saves in my account")),
          saves == null
            ? h("p", { className: "acc-empty" }, L("Yükleniyor…", "Loading…"))
            : saves.length === 0
              ? h("p", { className: "acc-empty" }, L("Henüz kayıt yok.", "No saves yet."))
              : h(
                  "ul",
                  null,
                  saves.map((s) =>
                    h(
                      "li",
                      { key: s.code, className: "acc-item" },
                      h(
                        "div",
                        { className: "acc-item-main" },
                        h("b", null, `${s.managerName || "—"} · ${s.clubName || "—"}`),
                        h("span", null, `${s.season || ""} · ${fmt(s.updatedAt)} · ${s.code}`),
                      ),
                      onLoad &&
                        h(Button, { size: "sm", variant: "secondary", disabled: busy === s.code, onClick: () => load(s.code) }, L("Yükle", "Load")),
                      h(Button, { size: "sm", variant: "ghost", disabled: busy === s.code, onClick: () => remove(s.code), "aria-label": L("Sil", "Delete") }, "✕"),
                    ),
                  ),
                ),
        ),
      err && h("p", { role: "alert", className: "acc-err" }, err),
    );
  };
}
