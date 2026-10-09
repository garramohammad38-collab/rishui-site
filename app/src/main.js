import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Device } from "@capacitor/device";
import { LocalNotifications } from "@capacitor/local-notifications";
import * as api from "./api.js";
import { T, topicName as fallbackTopic } from "./i18n.js";
import { REF } from "./reference.js";
import { calcQuestion } from "./calc.js";
import { initPurchases, priceOf, buy, restore, storeAvailable, logoutPurchases } from "./purchases.js";

/* ---------------- state ---------------- */
const app = document.getElementById("app");
const wm = document.getElementById("wm");
const LEGAL = window.__env.VITE_LEGAL_BASE || "";
const SUPPORT = window.__env.VITE_SUPPORT_EMAIL || "";

function storeGetter() {
  return {
    get: (k) => { try { return JSON.parse(localStorage.getItem("rishui:" + k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem("rishui:" + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
}
const store = storeGetter();

const st = {
  lang: store.get("lang") || "he",
  user: null, profile: null,
  answers: new Map(), marks: new Set(), counts: {}, best: null, tracks: [], topics: {}, ents: [],
  ui: { signup: false, plan: "exam", msg: null, msgBad: false, flashI: 0, flashBack: false, delArmed: false },
};
let S = null; // current session (quiz / mock / screen state)

/* ---------------- helpers ---------------- */
const t = (k) => T[st.lang][k];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const $ = (id) => document.getElementById(id);
const LET = { en: ["A", "B", "C", "D"], he: ["א", "ב", "ג", "ד"] };
const fwd = () => (st.lang === "he" ? "←" : "→");
const bwd = () => (st.lang === "he" ? "→" : "←");
const today = () => new Date().toLocaleDateString("en-CA"); // the student's own date
const TR = () => st.profile?.track || "nursing";
const ent = () => st.ents.find((e) => e.track === TR() && new Date(e.until) > new Date());
const hasAccess = () => !!st.profile && (st.profile.role === "admin" || st.freeMode || !!ent());
const trackOf = (id) => st.tracks.find((x) => x.id === id);
const trackName = (id) => { const x = trackOf(id); return x ? `${x.icon || ""} ${x[st.lang]}`.trim() : id; };
const topicName = (k, lang) => { const x = st.topics[k]; return x ? x[lang] : fallbackTopic(k, lang); };
const posKey = () => `pos:${st.user.id}:${TR()}`;
const isAdmin = () => st.profile?.role === "admin";
const errMsg = (e) => {
  const m = String(e?.message || e || "");
  if (m.includes("daily limit")) return t("dailyLimit");
  if (m.includes("Failed to fetch") || m.includes("NetworkError")) return t("netErr");
  return t("loadErr");
};

/* each track has its own colors: [accent, soft, background] for light and dark */
const THEMES = {
  nursing:     { l: ["#1554A8", "#E2ECF8", "#F3F7FC"], d: ["#5B9CF0", "#16305A", "#0C1626"] },
  medicine:    { l: ["#0F7A5C", "#DDF2E9", "#F2F9F6"], d: ["#46C79C", "#123D30", "#0A1A15"] },
  physio:      { l: ["#B54E14", "#FBE6D8", "#FDF6F1"], d: ["#F08A4B", "#45240F", "#1C120B"] },
  ot:          { l: ["#6D3FB5", "#ECE3FA", "#F8F5FD"], d: ["#A98BEA", "#2E2050", "#130F1F"] },
  radiography: { l: ["#B42357", "#FAE1EA", "#FDF4F7"], d: ["#EE6E9A", "#4A1529", "#1C0C12"] },
};
const EXTRA = [["#0B7285", "#D3EEF2", "#E9F6F8"], ["#7A6A12", "#F1EBC8", "#F8F5E6"], ["#2F7D32", "#DCEFDC", "#EEF7EE"]];
function themeOf(id) {
  if (THEMES[id]) return THEMES[id];
  const i = [...(id || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % EXTRA.length, l = EXTRA[i];
  return { l, d: [l[0], "#1E2A30", "#0E1418"] };
}
function applyTheme() {
  const th = themeOf(st.profile?.track || "nursing");
  let el = document.getElementById("track-theme");
  if (!el) { el = document.createElement("style"); el.id = "track-theme"; document.head.appendChild(el); }
  const v = ([a, s, b], dark) => `--accent:${a};--accent-soft:${s};--bg:${b};--on-accent:${dark ? b : "#FFFFFF"};`;
  el.textContent = `:root{${v(th.l)}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${v(th.d, true)}}}
:root[data-theme="dark"]{${v(th.d, true)}}
html,body{transition:background-color .3s}`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", th.l[0]);
}

function stopTimer() { if (S?.tick) { clearInterval(S.tick); S.tick = null; } }
function watermark(on) {
  wm.hidden = !on;
  if (on) $("wm-text").innerHTML = Array(120).fill(`<span>${esc(st.user?.email || "")}</span>`).join("");
}
function frame(inner, { protect = false, wide = false, nav = null } = {}) {
  stopTimer();
  watermark(false);
  applyTheme();
  document.documentElement.lang = st.lang;
  document.documentElement.dir = t("dir");
  app.className = "app" + (protect ? " protect" : "") + (wide ? " wide" : "") + (nav ? " has-nav" : "");
  app.innerHTML = `<div class="top"><div class="brand"><div class="mark">${st.lang === "he" ? "מ" : "M"}</div><div><h1>${t("name")}</h1><small>${st.profile?.track ? trackName(st.profile.track) : t("tag")}</small></div></div>
  <div class="lang"><button data-l="he" class="${st.lang === "he" ? "on" : ""}">עב</button><button data-l="en" class="${st.lang === "en" ? "on" : ""}">EN</button></div></div>${nav ? navHtml(nav) : ""}${inner}`;
  if (nav) bindNav();
  app.querySelectorAll(".lang button").forEach((b) => (b.onclick = () => {
    st.lang = b.dataset.l; store.set("lang", st.lang);
    if (st.user) api.updateProfile(st.lang, null).catch(() => {});
    (S?.screen || route)();
  }));
  window.scrollTo(0, 0);
}
function loading() { frame(`<div class="loading"><div class="spin"></div></div>`); }
function msgHtml() { return st.ui.msg ? `<div class="banner ${st.ui.msgBad ? "bad" : ""}">${esc(st.ui.msg)}</div>` : ""; }
function flash(msg, bad = false) { st.ui.msg = msg; st.ui.msgBad = bad; }
function openUrl(url) { if (url) Browser.open({ url }).catch(() => window.open(url, "_blank")); }
function legalLinks() {
  return `<div class="small-links"><button class="link" id="lg-c">✉️ ${t("contact")}</button><button class="link" id="lg-t">${t("terms")}</button><button class="link" id="lg-p">${t("privacy")}</button>${st.user ? `<button class="link" id="lg-o">${t("logout")}</button>` : ""}</div>`;
}
function bindLegal() {
  if ($("lg-c")) { const from = S?.screen; $("lg-c").onclick = () => contact(from); }
  if ($("lg-o")) $("lg-o").onclick = logout;
  if ($("lg-t")) $("lg-t").onclick = () => openUrl(`${LEGAL}/terms-${st.lang}.html`);
  if ($("lg-p")) $("lg-p").onclick = () => openUrl(`${LEGAL}/privacy-${st.lang}.html`);
}
document.addEventListener("contextmenu", (e) => { if (e.target.closest?.(".protect")) e.preventDefault(); });
document.addEventListener("copy", (e) => { if (e.target?.closest?.(".protect")) e.preventDefault(); });

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return saveExam();
  // back in the app after a while: refresh question totals (new questions may have been added)
  if (st.user && st.profile?.track && Date.now() - (st.loadedAt || 0) > 10 * 60e3) {
    st.loadedAt = Date.now();
    api.counts(TR()).then((c) => { st.counts = Object.fromEntries(c.map((r) => [r.topic, Number(r.n)])); if (S?.screen === home) home(); }).catch(() => {});
  }
});
// a small bar while there is no internet; answers are kept and sent again when it is back
function netBar() {
  let el = document.getElementById("netbar");
  if (navigator.onLine) { el?.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "netbar"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = t("offline");
}
window.addEventListener("offline", netBar);
window.addEventListener("online", netBar);

/* ---------------- boot ---------------- */
async function boot() {
  loading();
  CapApp.addListener("backButton", () => { if (S?.back) S.back(); else route(); }).catch(() => {});
  // opened from a "reset password" email: ask for the new password first
  let recovery = /type=recovery/.test(location.hash);
  api.auth.onChange((event) => { if (event === "PASSWORD_RECOVERY") { recovery = true; newPassword(); } });
  const session = await api.auth.session().catch(() => null);
  if (session && recovery) return newPassword();
  if (session) await afterLogin(session.user); else login();
}

async function afterLogin(user) {
  st.user = user;
  loading();
  try {
    const dev = await deviceInfo();
    const ok = await api.registerDevice(dev.id, dev.label);
    if (!ok) return blocked();
    await loadUserData();
    try { api.setTz(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* ignore */ }
    await initPurchases(user.id).catch(() => {});
    route();
  } catch (e) {
    frame(`<div class="card"><p>${esc(errMsg(e))}</p><button class="primary" id="rt">${t("retry")}</button></div>`);
    $("rt").onclick = () => afterLogin(user);
  }
}
async function deviceInfo() {
  let id = store.get("device-id");
  try { id = (await Device.getId()).identifier || id; } catch { /* web */ }
  if (!id) { id = crypto.randomUUID(); store.set("device-id", id); }
  let label = Capacitor.getPlatform();
  try { const i = await Device.getInfo(); label = `${i.platform} ${i.model}`; } catch { /* web */ }
  return { id, label };
}
async function loadUserData() {
  const uid = st.user.id;
  [st.profile, st.tracks, st.ents, st.freeMode, st.soon] = await Promise.all([api.getProfile(uid), api.tracks(), api.entitlements(uid), api.freeMode(), api.soonTracks().catch(() => [])]);
  const profile = st.profile;
  if (!profile.track) return;
  const tr = profile.track;
  const [answers, marks, counts, best, topics] = await Promise.all([
    api.myAnswers(uid, tr), api.myBookmarks(uid, tr), api.counts(tr), api.bestMock(uid, tr), api.topics(tr),
  ]);
  st.topics = Object.fromEntries(topics.map((x) => [x.id, x]));
  if (profile.lang && !store.get("lang")) st.lang = profile.lang;
  st.answers = new Map(answers.map((r) => [r.question_id, r.correct]));
  st.marks = new Set(marks);
  st.loadedAt = Date.now();
  st.counts = Object.fromEntries(counts.map((r) => [r.topic, Number(r.n)]));
  st.best = best;
}
function route() {
  S = null;
  if (!st.user) return login();
  if (!st.profile?.track) {
    // only one track open (e.g. launch with nursing only): pick it, no choice screen
    if (st.tracks?.length === 1) return autoTrack(st.tracks[0].id);
    return chooseTrack();
  }
  if (!hasAccess() && !store.get(`skip-plans:${st.user.id}:${TR()}`)) return plans();
  // opened from a friend's challenge link (?c=CODE)
  const fcode = new URLSearchParams(location.search).get("c");
  if (fcode && !st.ui.fcodeUsed) { st.ui.fcodeUsed = true; return friendStart(fcode.toUpperCase().slice(0, 8), friendNick()); }
  if (!store.get(`intro:${st.user.id}`)) return intro();
  home();
}

async function autoTrack(id) {
  loading();
  try {
    await api.updateProfile(null, null, id);
    await loadUserData();
  } catch { return chooseTrack(); }
  if (!st.profile?.track) return chooseTrack();
  route();
}

/* ---------------- auth ---------------- */
function login() {
  S = { screen: login };
  const u = st.ui;
  frame(`${msgHtml()}
  <form class="card" id="f" novalidate>
    <h2>${u.signup ? t("signup") : t("login")}</h2>
    <div class="field"><label for="em">${t("email")}</label><input id="em" type="email" dir="ltr" autocomplete="email" autocapitalize="off"></div>
    <div class="field"><label for="pw">${t("pass")}</label><input id="pw" type="password" dir="ltr" autocomplete="${u.signup ? "new-password" : "current-password"}"></div>
    <div class="err" id="er" hidden></div>
    <button class="primary" type="submit" id="sb">${t("cont")}</button>
    <p class="muted">${u.signup ? t("haveAcct") : t("noAcct")} <button type="button" class="link" id="sw">${u.signup ? t("login") : t("signup")}</button></p>
    ${u.signup ? "" : `<p class="muted"><button type="button" class="link" id="fg">${t("forgot")}</button></p>`}
  </form>${legalLinks()}`);
  bindLegal();
  st.ui.msg = null;
  const err = (m) => { $("er").textContent = m; $("er").hidden = false; };
  $("sw").onclick = () => { u.signup = !u.signup; login(); };
  if ($("fg")) $("fg").onclick = async () => {
    const em = $("em").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return err(t("badEmail"));
    await api.auth.reset(em).catch(() => {});
    flash(t("resetSent")); login();
  };
  $("f").onsubmit = async (e) => {
    e.preventDefault();
    const em = $("em").value.trim(), pw = $("pw").value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return err(t("badEmail"));
    if (pw.length < 8) return err(t("shortPass"));
    $("sb").disabled = true;
    try {
      if (u.signup) {
        const { data, error } = await api.auth.signUp(em, pw);
        if (error) throw error;
        if (data.session) return afterLogin(data.user);
        u.signup = false; flash(t("checkEmail")); return login();
      }
      const { data, error } = await api.auth.signIn(em, pw);
      if (error) {
        const m = String(error.message || "");
        if (/not confirmed/i.test(m)) {
          err(st.lang === "he" ? "עוד לא אישרת את האימייל. פתח את המייל מ-Supabase (בדוק גם בספאם) ולחץ על הקישור." : "You haven't confirmed your email yet. Open the email (check spam too) and tap the link.");
          $("er").insertAdjacentHTML("beforeend", ` <button type="button" class="link" id="rs2">${st.lang === "he" ? "שלח שוב" : "Send again"}</button>`);
          $("rs2").onclick = async () => { const r = await api.auth.resend(em).catch((x) => ({ error: x })); err(r?.error ? authMsg(r.error) : (st.lang === "he" ? "שלחנו שוב. בדוק את המייל." : "Sent again. Check your email.")); };
          return;
        }
        return err(m.includes("fetch") ? t("netErr") : t("wrongLogin"));
      }
      await afterLogin(data.user);
    } catch (ex) { err(authMsg(ex)); } finally { if ($("sb")) $("sb").disabled = false; }
  };
}
// readable sign-up / sign-in errors
function authMsg(e) {
  const m = String(e?.message || e || "");
  const he = st.lang === "he";
  if (/already registered|already exists/i.test(m)) return he ? "כבר קיים חשבון עם האימייל הזה. נסה להתחבר." : "An account with this email already exists. Try signing in.";
  if (/rate limit/i.test(m)) return he ? "יותר מדי ניסיונות. נסה שוב בעוד כמה דקות." : "Too many attempts. Try again in a few minutes.";
  if (/signups? not allowed|disabled/i.test(m)) return he ? "ההרשמה סגורה כרגע." : "Sign-ups are currently closed.";
  if (/password/i.test(m)) return he ? "הסיסמה לא עומדת בדרישות. נסה סיסמה ארוכה יותר." : "The password doesn't meet the requirements. Try a longer one.";
  if (/fetch|network/i.test(m)) return t("netErr");
  return m || t("loadErr");
}
function newPassword() {
  S = { screen: newPassword };
  frame(`<form class="card" id="f" novalidate>
    <h2>${t("newPass")}</h2>
    <div class="field"><label for="pw">${t("pass")}</label><input id="pw" type="password" dir="ltr" autocomplete="new-password"></div>
    <div class="field"><label for="pw2">${t("passAgain")}</label><input id="pw2" type="password" dir="ltr" autocomplete="new-password"></div>
    <div class="err" id="er" hidden></div>
    <button class="primary" type="submit" id="sb">${t("newPassBtn")}</button>
  </form>${legalLinks()}`);
  bindLegal();
  const err = (m) => { $("er").textContent = m; $("er").hidden = false; };
  $("f").onsubmit = async (e) => {
    e.preventDefault();
    const a = $("pw").value, b = $("pw2").value;
    if (a.length < 8) return err(t("shortPass"));
    if (a !== b) return err(t("passMismatch"));
    $("sb").disabled = true;
    const { data, error } = await api.auth.setPassword(a);
    if (error) { $("sb").disabled = false; return err(authMsg(error)); }
    history.replaceState(null, "", location.pathname);
    flash(t("passChanged"));
    await afterLogin(data.user);
  };
}
function blocked() {
  frame(`<div class="card"><h2>${t("acct")}</h2><p>${t("tooMany")}</p>${SUPPORT ? `<p class="muted">${t("support")}: <bdi dir="ltr">${esc(SUPPORT)}</bdi></p>` : ""}
  <button class="ghost" id="lo">${t("logout")}</button></div>`);
  $("lo").onclick = logout;
}
async function logout() {
  await api.auth.signOut().catch(() => {});
  await logoutPurchases();
  st.user = null; st.profile = null; st.answers = new Map(); st.marks = new Set();
  route();
}

/* ---------------- track ---------------- */
// tracks this student may open: everything before the first choice; afterwards only tracks they hold
// a plan or code for (admins can open all)
function allowedTracks() {
  if (!st.profile?.track || isAdmin()) return st.tracks;
  const now = new Date();
  const paid = new Set(st.ents.filter((e) => new Date(e.until) > now).map((e) => e.track));
  return st.tracks.filter((x) => x.id === st.profile.track || paid.has(x.id));
}
const canSwitch = () => allowedTracks().length > 1;
const soonName = (x) => (st.lang === "he" ? x.he : x.en);
const soonCard = (x) => `<div class="plan soon" aria-disabled="true"><span class="soonicon" aria-hidden="true">${esc(x.icon || "🔒")}</span>
  <span class="info"><b>${esc(soonName(x))}</b><span class="muted">${esc(x[st.lang + "_desc"] || "")}</span></span><span class="soontag">${t("soonTag")}</span></div>`;
// small card on home: which tracks are coming
const soonStrip = () => (st.soon || []).length ? `<div class="card soonbox"><b>${t("soonTitle")}</b><div class="chips">${st.soon.map((x) => `<span class="chip">${esc(x.icon || "")} ${esc(soonName(x))}</span>`).join("")}</div><span class="muted">${t("soonD")}</span></div>` : "";

function chooseTrack(pending) {
  S = { screen: () => chooseTrack(pending), back: st.profile?.track ? route : null };
  const cur = st.profile?.track, first = !cur;
  const list = allowedTracks();
  const card = (x) => { const c = themeOf(x.id).l; return `<button class="plan ${(pending || cur) === x.id ? "on" : ""}" data-k="${esc(x.id)}" style="border-color:${c[0]};background:${c[2]};color:#0F1E33;border-inline-start-width:6px"><span class="dot" style="border-color:${c[0]}"></span>
      <span class="info"><b>${esc(trackName(x.id))}</b><span class="muted" style="color:#4A5A6E">${esc(x[st.lang + "_desc"] || "")}</span></span></button>`; };
  frame(`<div class="card"><h2>${t("chooseTrack")}</h2>
    <div class="plans">${list.map(card).join("")}${(st.soon || []).map(soonCard).join("")}</div>
    ${first && pending ? `<div class="banner">⚠️ ${t("lockWarn")}</div>
      <div class="actions"><button class="primary" id="ok">${t("confirmTrack")}</button><button class="ghost" id="no">${t("pickOther")}</button></div>` : ""}
  </div>${cur ? `<button class="ghost" id="bk">${t("home")}</button>` : ""}${legalLinks()}`);
  bindLegal();
  if ($("bk")) $("bk").onclick = route;
  if ($("no")) $("no").onclick = () => chooseTrack();
  const pick = async (k) => {
    loading();
    try {
      await api.updateProfile(null, null, k);
      st.profile = await api.getProfile(st.user.id);
      if (st.profile.track !== k) throw new Error("track locked");
      await loadUserData();
      route();
    } catch (e) { flash(errMsg(e), true); chooseTrack(); }
  };
  if ($("ok")) $("ok").onclick = () => pick(pending);
  app.querySelectorAll(".plan").forEach((b) => (b.onclick = () => {
    const k = b.dataset.k;
    if (first && !isAdmin()) return chooseTrack(k); // first choice needs a confirm
    if (k !== cur) pick(k);
  }));
}

/* ---------------- plans + purchase ---------------- */
function plans() {
  S = { screen: plans, back: hasAccess() ? route : null };
  const d = new Date(); d.setMonth(d.getMonth() + 3);
  const exam = st.profile?.exam_date || d.toISOString().slice(0, 10);
  const pm = priceOf(TR(), "month"), pe = priceOf(TR(), "exam");
  frame(`${msgHtml()}
  <div class="card">
    <h2>${t("choose")}</h2>
    <span class="chip" ${canSwitch() ? 'id="trk" role="button" style="align-self:flex-start;cursor:pointer"' : 'style="align-self:flex-start"'}>${esc(trackName(TR()))}${canSwitch() ? " · " + t("switchTrack") : ""}</span>
    <div class="plans">
      <button class="plan ${st.ui.plan === "month" ? "on" : ""}" data-p="month"><span class="dot"></span><span class="info"><b>${t("monthly")}</b><span class="muted">${t("monthlyD")}</span></span>${pm ? `<span class="price">${esc(pm)}</span>` : ""}</button>
      <button class="plan ${st.ui.plan === "exam" ? "on" : ""}" data-p="exam"><span class="dot"></span><span class="info"><b>${t("untilExam")}</b><span class="muted">${t("untilD")}</span><span class="badge">${t("best")}</span></span>${pe ? `<span class="price">${esc(pe)}</span>` : ""}</button>
    </div>
    <div class="field" ${st.ui.plan === "exam" ? "" : "hidden"}><label for="ex">${t("examDate")}</label><input id="ex" type="date" value="${esc(exam)}" min="${today()}"></div>
    ${storeAvailable ? `<button class="primary" id="go">${t("buy")}</button><button class="link" id="rs">${t("restore")}</button>` : `<p class="muted">${t("storeOnly")}</p>`}
  </div>
  <div class="card">
    <h3>${t("haveCode")}</h3>
    <div class="field"><label for="cd">${t("code")}</label><div class="row2"><input id="cd" dir="ltr" autocomplete="off" autocapitalize="characters"><button class="ghost" id="ap">${t("apply")}</button></div></div>
  </div>
  <div class="card"><p class="muted">${t("freeNote")}</p><button class="ghost" id="fr">${t("tryFree")}</button></div>
  ${legalLinks()}`);
  bindLegal();
  st.ui.msg = null;
  app.querySelectorAll(".plan").forEach((b) => (b.onclick = () => { st.ui.plan = b.dataset.p; plans(); }));
  if ($("trk")) $("trk").onclick = () => chooseTrack();
  if ($("go")) $("go").onclick = async () => {
    const plan = st.ui.plan;
    if (plan === "exam") await api.updateProfile(null, $("ex").value).catch(() => {});
    $("go").disabled = true; $("go").textContent = t("buying");
    const r = await buy(TR(), plan);
    if (r === "cancelled") return plans();
    if (r !== "ok") { flash(t("payFail"), true); return plans(); }
    await waitForActivation();
  };
  if ($("rs")) $("rs").onclick = async () => {
    const ok = await restore();
    if (ok) return waitForActivation();
    flash(t("nothingRestore"), true); plans();
  };
  $("ap").onclick = async () => {
    const v = $("cd").value.trim();
    if (!v) return;
    try {
      const r = await api.redeem(v);
      if (r === "ok") { st.ents = await api.entitlements(st.user.id); flash(t("codeOk")); return hasAccess() ? route() : plans(); }
      flash(r === "used" ? t("codeUsed") : t("codeBad"), true); plans();
    } catch (e) { flash(errMsg(e), true); plans(); }
  };
  $("fr").onclick = () => { store.set(`skip-plans:${st.user.id}:${TR()}`, true); home(); };
}
// the store confirms the purchase to our server (webhook); poll the profile until the plan shows up
async function waitForActivation() {
  frame(`<div class="card"><div class="wait"><div class="spin"></div><h2>${t("activating")}</h2></div></div>`);
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try { st.ents = await api.entitlements(st.user.id); } catch { /* retry */ }
    if (hasAccess()) { flash(t("activated")); return route(); }
  }
  flash(t("payPending")); home();
}

/* ---------------- home ---------------- */
function daysLeft() {
  const d = st.profile?.exam_date; if (!d) return null;
  return Math.max(0, Math.ceil((new Date(d + "T00:00") - new Date(today() + "T00:00")) / 864e5));
}
function totals() {
  const n = Object.values(st.counts).reduce((a, b) => a + b, 0);
  let right = 0; st.answers.forEach((c) => { if (c) right++; });
  // unique questions answered (answering again doesn't add); never more than the bank
  return { n, done: Math.min(st.answers.size, n || st.answers.size), right, wrong: st.answers.size - right };
}
/* ---------------- navigation (6 sections) ---------------- */
const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  newx: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M12 10v6M9 13h6"/>',
  exams: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  qs: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.5v.01"/>',
  stats: '<path d="M3 21h18M6 17v-5M11 17V6M16 17V9M20 17v-3"/>',
  tools: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
};
const NAV = [["home", "navHome", () => home()], ["newx", "navNew", () => newExam()], ["exams", "navExams", () => myExams()], ["qs", "navQs", () => myQuestions()], ["stats", "navStats", () => stats()], ["tools", "navTools", () => tools()]];
function navHtml(on) {
  return `<nav class="tabs" aria-label="${t("name")}">${NAV.map(([k, label]) => `<button class="tab ${k === on ? "on" : ""}" data-nav="${k}" ${k === on ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg><span>${t(label)}</span></button>`).join("")}</nav>`;
}
function bindNav() {
  app.querySelectorAll("[data-nav]").forEach((b) => (b.onclick = () => NAV.find((x) => x[0] === b.dataset.nav)[2]()));
}
const fmtDate = (d) => { const x = new Date(d); return `${String(x.getDate()).padStart(2, "0")}.${String(x.getMonth() + 1).padStart(2, "0")}.${x.getFullYear()}`; };
const fmtTime = (d) => { const x = new Date(d); return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
function ringSvg(p, size = 120, label = `${p}%`) {
  const R = 50, C = 2 * Math.PI * R, col = p >= 80 ? "var(--ok)" : p >= 60 ? "var(--amber)" : p > 0 ? "var(--accent)" : "var(--line)";
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--line)" stroke-width="11"/>
  <circle cx="60" cy="60" r="${R}" fill="none" stroke="${col}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p / 100)}" transform="rotate(-90 60 60)"/>
  <text x="60" y="68" text-anchor="middle" font-size="24" font-weight="700" fill="var(--ink)" font-family="Rubik, sans-serif">${label}</text></svg>`;
}
// bars for the last 14 days of answers
function activityChart(rows, days = 14) {
  const by = Object.fromEntries((rows || []).map((r) => [r.day, r]));
  const list = [...Array(days)].map((_, i) => { const d = new Date(Date.now() - (days - 1 - i) * 864e5).toLocaleDateString("en-CA"); return { d, n: by[d]?.n || 0, c: by[d]?.correct || 0 }; });
  const max = Math.max(5, ...list.map((x) => x.n)), W = 300, H = 110, bw = W / days;
  return `<svg class="act" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="${t("activityL")}">
    ${list.map((x, i) => { const h = (x.n / max) * H, hc = (x.c / max) * H, xx = i * bw + 3; return `<rect x="${xx}" y="${H - h}" width="${bw - 6}" height="${h}" rx="3" fill="var(--accent-soft)"><title>${x.d}: ${x.n}</title></rect><rect x="${xx}" y="${H - hc}" width="${bw - 6}" height="${hc}" rx="3" fill="var(--accent)"/>${i % 2 === days % 2 ? "" : `<text x="${xx + (bw - 6) / 2}" y="${H + 14}" text-anchor="middle" font-size="9" fill="var(--muted)">${x.d.slice(8)}.${x.d.slice(5, 7)}</text>`}`; }).join("")}
    <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line)"/></svg>`;
}
function topicBars(rows) {
  return `<div class="card bars">${rows.map(({ k, a, b, sub, acc }) => { const r = b ? a / b : 0, q = acc ?? r, cc = q >= 0.8 ? "var(--ok)" : q >= 0.5 ? "var(--amber)" : "var(--bad)"; return `<div class="bar-row"><div class="lbl"><span>${esc(topicName(k, st.lang))}</span><span>${sub ?? `${a}/${b}`}</span></div><div class="bar"><i style="width:${r * 100}%;background:${b ? cc : "transparent"}"></i></div></div>`; }).join("")}</div>`;
}

/* ---------------- home ---------------- */
// newest admin announcement the student hasn't closed yet
async function fillAnnouncement() {
  const key = `ann-seen:${st.user.id}`, seen = new Set(store.get(key) || []);
  const list = (await api.announcements(TR()).catch(() => [])).filter((a) => !seen.has(a.id));
  const box = $("annw"); if (!box || !list.length) return;
  const a = list[0];
  box.innerHTML = `<div class="newbox ann" role="status"><div class="newbox-h"><b>📢 ${esc(a.title)}</b><button class="link" id="annx">${t("gotIt")}</button></div>${a.body ? `<p class="ann-b">${esc(a.body)}</p>` : ""}</div>`;
  $("annx").onclick = () => { seen.add(a.id); store.set(key, [...seen].slice(-50)); box.innerHTML = ""; fillAnnouncement(); };
}

function home() {
  S = { screen: home };
  const tt = totals(), pct = pctOf(tt.done, tt.n), dl = daysLeft(), e = ent();
  // "what's new": compare published counts per topic with what this student saw last time
  const seenKey = `seen-counts:${st.user.id}:${TR()}`;
  let seen = store.get(seenKey);
  if (!seen || typeof seen !== "object") { seen = st.counts; store.set(seenKey, st.counts); }
  const added = Object.fromEntries(Object.keys(st.counts).map((k) => [k, Math.max(0, st.counts[k] - (seen[k] || 0))]).filter(([, n]) => n > 0));
  const addedTotal = Object.values(added).reduce((a, b) => a + b, 0);
  const newBox = addedTotal ? `<div class="newbox" role="status"><div class="newbox-h"><b>${st.lang === "he" ? `נוספו ${addedTotal} שאלות חדשות` : `${addedTotal} ${t("newQs")}`}</b><button class="link" id="nok">${t("gotIt")}</button></div>
    <div class="newbox-l">${Object.entries(added).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="chip cool">+${n} ${t("newIn")}${st.lang === "he" ? "" : " "}${esc(topicName(k, st.lang))}</span>`).join("")}</div></div>` : "";
  const pkg = isAdmin() ? t("admin") : st.freeMode ? t("freeNow") : e ? `${t("validUntil")}: <bdi>${fmtDate(e.until)}</bdi>` : t("planNone");
  const h = new Date().getHours(), greet = t(h < 5 ? "gNight" : h < 12 ? "gMorning" : h < 17 ? "gNoon" : h < 22 ? "gEvening" : "gNight");
  frame(`${msgHtml()}<div id="annw"></div>${newBox}
  ${!hasAccess() ? `<button class="banner" id="lock" style="border:0;text-align:start;cursor:pointer">🔒 ${t("locked")}</button>` : ""}
  <div class="welcome"><h2>${greet} 👋</h2>
    <div class="chips"><span class="chip cool" ${canSwitch() ? 'id="trk" role="button" style="cursor:pointer"' : ""}>${esc(trackName(TR()))}${canSwitch() ? " · " + t("switchTrack") : ""}</span>${dl != null ? `<span class="chip">📅 ${dl} ${t("daysLeft")}</span>` : ""}<span class="chip ${hasAccess() ? "ok" : ""}">${pkg}</span></div></div>
  ${tt.n === 0 ? `<div class="banner">${t("noneYet")}</div>` : ""}
  <div id="openx"><button class="examcta" id="nx2"><span class="jicon" aria-hidden="true">📝</span><span><b>${t("startExam")}</b><small>${t("startExamD")}</small></span><span aria-hidden="true">${fwd()}</span></button></div>
  <div id="missionw">${missionCard(null, "loading")}</div>
  <div class="hero">
    <div class="hero-row">
      <div class="ring2" style="--p:${pct}"><span>${pct}%</span></div>
      <div class="hero-txt">
        <span class="eyebrow">${t("progress")}</span>
        <div class="bignum"><b>${tt.done}</b><span>/</span><b>${tt.n}</b></div>
        <span class="muted">${t("solved")} · ${t("inBank")}</span>
        ${tt.done ? `<span class="okline">${t("accuracy")} ${pctOf(tt.right, tt.done)}%</span>` : ""}
      </div>
    </div>
    <button class="primary" id="go">${t("cont2")} ${fwd()}</button>
  </div>
  <div id="journeyw">${!st.profile.exam_date ? `<div class="card exq"><h3>${t("examWhen")}</h3><p class="muted">${t("examWhenD")}</p><div class="row2"><input id="exd" type="date" aria-label="${t("examWhen")}"><button class="primary slim" id="exs">${t("saveDate")}</button></div></div>` : ""}</div>
  <div id="leaguew"></div>
  <div class="section-title">${t("quick")}</div>
  <div class="grid">
    <button class="tile" id="mis"><b>${t("mistakes")}</b><span class="n">${tt.wrong}</span></button>
    <button class="tile" id="smr"><b>${t("smart")}</b><span>${t("smartD")}</span></button>
    <button class="tile" id="una"><b>${t("unansweredQs")}</b><span class="n">${Math.max(0, tt.n - tt.done)}</span></button>
    <button class="tile" id="bm"><b>${t("bookmarks")}</b><span class="n">${st.marks.size}</span></button>
    <button class="tile" id="srch"><b>🔍 ${t("search")}</b><span>${t("searchD")}</span></button>
    <button class="tile" id="clc"><b>${t("calcT")}</b><span>${t("calcD")}</span></button>
    <button class="tile" id="rfp"><b>${t("refT")}</b><span>${t("refD")}</span></button>
    <button class="tile" id="fl"><b>${t("flash")}</b><span>EN · עב</span></button>
  </div>
  <div class="card"><div id="goalw">${goalCard([])}</div></div>
  <details class="topics-d"><summary>${t("bytopic")} <span class="muted">(${Object.keys(st.counts).length})</span></summary>
  <div class="list">${Object.keys(st.counts).sort().map((k) => `<button class="li" data-t="${esc(k)}"><span>${esc(topicName(k, st.lang))} <span class="sub">${esc(topicName(k, st.lang === "he" ? "en" : "he"))}</span></span><span class="count">${added[k] ? `<span class="newtag">+${added[k]} ${t("newBadge")}</span> ` : ""}${st.counts[k]} ${t("qs")}</span></button>`).join("")}</div></details>
  ${soonStrip()}
  ${legalLinks()}`, { wide: true, nav: "home" });
  bindLegal();
  st.ui.msg = null;
  fillAnnouncement();
  $("una").onclick = () => practice({ kind: "unanswered" });
  if ($("nok")) $("nok").onclick = () => { store.set(seenKey, st.counts); home(); };
  if ($("lock")) $("lock").onclick = plans;
  if ($("trk")) $("trk").onclick = () => chooseTrack();
  $("go").onclick = () => practice({ kind: "seq" });
  $("nx2").onclick = newExam;
  $("mis").onclick = () => practice({ kind: "ids", ids: [...st.answers].filter(([, c]) => !c).map(([id]) => id) });
  $("bm").onclick = () => practice({ kind: "ids", ids: [...st.marks] });
  $("fl").onclick = () => { st.ui.flashI = 0; st.ui.flashBack = false; cards(); };
  app.querySelectorAll(".li").forEach((b) => (b.onclick = () => practice({ kind: "topic", topic: b.dataset.t })));
  // async parts: activity chart + an unfinished exam to continue
  bindGoal([]);
  fillMission().then(fillJourney).then(fillLeague);
  $("smr").onclick = smartReview; $("clc").onclick = () => calcTrainer(home); $("rfp").onclick = () => refPage(home); $("srch").onclick = () => searchPage(home);
  if ($("exs")) $("exs").onclick = async () => { const v = $("exd").value; if (!v) return; await api.updateProfile(null, v).catch(() => {}); st.profile.exam_date = v; home(); };
  api.activity(st.user.id, TR(), 60).then((rows) => { if (S?.screen !== home) return; if ($("goalw")) { $("goalw").innerHTML = goalCard(rows); bindGoal(rows); } }).catch(() => {});
  api.myExams(st.user.id, TR()).then((list) => {
    const x = list.find((r) => r.status === "open"); if (!x || S?.screen !== home || !$("openx")) return;
    const done = (x.picked || []).filter((v) => v != null).length;
    $("openx").innerHTML = `<div class="newbox"><div class="newbox-h"><b>${t("unfinished")}</b><span class="muted">${done}/${x.ids.length} ${t("answeredOf")}</span></div>
      <div class="row2"><button class="primary" id="umr">${t("contExam")} ${fwd()}</button><button class="ghost" id="nx3">${t("startExam")}</button></div></div>`;
    $("umr").onclick = () => runExam(x); $("nx3").onclick = newExam;
  }).catch(() => {});
}

/* ---------------- new exam (builder) ---------------- */
const EXAM_SECONDS_PER_Q = 90, EXAM_MAX = 180;
function newExam() {
  const saved = store.get("exam-cfg") || {};
  const cfg = { n: saved.n || 50, timed: saved.timed ?? true, guided: saved.guided ?? false, topics: saved.topics || [], pool: saved.pool || "all" };
  S = { screen: newExam };
  const topics = Object.keys(st.counts).sort();
  const counts = new Map(); let note = "";
  const key = () => `${[...cfg.topics].sort().join(",")}|${cfg.pool}`;
  // how many questions match the filters: counted on the server (falls back to the topic totals)
  const ensureCount = () => {
    const k = key(); if (counts.has(k)) return;
    counts.set(k, null);
    api.examCount(TR(), cfg.topics, cfg.pool).then((n) => { counts.set(k, n); if (S?.screen === newExam && key() === k) draw(); })
      .catch(() => counts.set(k, undefined));
  };
  const draw = () => {
    ensureCount();
    const est = cfg.topics.length ? cfg.topics.reduce((a, k) => a + (st.counts[k] || 0), 0) : totals().n;
    const real = counts.get(key()), match = real ?? est, avail = Math.min(EXAM_MAX, match) || 0;
    if (cfg.n > avail && avail) { if (real != null) note = `${t("askedFor")} ${cfg.n}, ${t("onlyAvail")} ${avail}`; cfg.n = avail; }
    const opts = [10, 25, 50, 100, 150, 180].filter((n) => n <= avail);
    const seg = (id, a, b, on) => `<div class="seg" role="group"><button class="segb ${on ? "on" : ""}" data-s="${id}" data-v="1"><b>${a[0]}</b>${a[1] ? `<small>${a[1]}</small>` : ""}</button><button class="segb ${!on ? "on" : ""}" data-s="${id}" data-v="0"><b>${b[0]}</b>${b[1] ? `<small>${b[1]}</small>` : ""}</button></div>`;
    frame(`<h2 class="page-h">${t("navNew")}</h2>
    <div class="card exb">
      <h3>${t("exSettings")}</h3>
      <div class="exgrid">
        <div class="field"><label>${t("timing")}</label>${seg("timed", [t("timed"), `${EXAM_SECONDS_PER_Q} ${t("sec")} / ${t("q")}`], [t("untimed"), ""], cfg.timed)}</div>
        <div class="field"><label>${t("solutions")}</label>${seg("guided", [t("guided"), t("guidedD")], [t("unguided"), t("unguidedD")], cfg.guided)}</div>
      </div>
      <div class="field"><label>${t("pool")}</label><div class="chips">${[["all", "poolAll"], ["unanswered", "poolUn"], ["wrong", "poolWrong"], ["saved", "poolSaved"]].map(([v, l]) => `<button class="chip pick ${cfg.pool === v ? "cool" : ""}" data-pool="${v}">${t(l)}</button>`).join("")}</div></div>
      <div class="field"><label>${t("topicsL")}</label><div class="chips"><button class="chip pick ${!cfg.topics.length ? "cool" : ""}" data-tp="">${t("allTopics")}</button>${topics.map((k) => `<button class="chip pick ${cfg.topics.includes(k) ? "cool" : ""}" data-tp="${esc(k)}">${esc(topicName(k, st.lang))} <span class="muted">${st.counts[k]}</span></button>`).join("")}</div></div>
      <div class="availbox ${real === 0 ? "bad" : ""}">${real == null ? `<span class="spin sm"></span>` : ""}<b>${match}</b> ${t("matchQs")}${match > EXAM_MAX ? ` · ${t("maxPer")} ${EXAM_MAX}` : ""}</div>
      ${note ? `<div class="banner">${esc(note)}</div>` : ""}
      <div class="field"><label>${t("qCount")}</label>
        <div class="chips">${opts.map((o) => `<button class="chip pick ${o === cfg.n ? "cool" : ""}" data-n="${o}">${o}</button>`).join("")}</div>
        <input id="mn" type="number" inputmode="numeric" min="1" max="${avail}" value="${cfg.n}" dir="ltr" aria-label="${t("mockCustom")}"></div>
      ${cfg.timed ? `<p class="muted">${t("mockTime")}: ${Math.round((cfg.n * EXAM_SECONDS_PER_Q) / 60)} ${t("min")}</p>` : ""}
      <div class="err" id="er" hidden></div>
      <button class="primary" id="ms" ${avail ? "" : "disabled"}>${t("next")} ${fwd()}</button>
    </div>`, { wide: true, nav: "newx" });
    note = "";
    app.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { cfg[b.dataset.s] = b.dataset.v === "1"; draw(); }));
    app.querySelectorAll("[data-pool]").forEach((b) => (b.onclick = () => { cfg.pool = b.dataset.pool; draw(); }));
    app.querySelectorAll("[data-tp]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.tp; if (!k) cfg.topics = [];
      else cfg.topics = cfg.topics.includes(k) ? cfg.topics.filter((x) => x !== k) : [...cfg.topics, k];
      draw();
    }));
    app.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => { cfg.n = +b.dataset.n; draw(); }));
    $("mn").onchange = () => { cfg.n = Math.max(1, Math.min(avail || 1, Math.round(+$("mn").value || 1))); draw(); };
    $("ms").onclick = () => summary(avail);
  };
  // summary of the chosen settings before the exam starts
  const summary = (avail) => {
    const tl = cfg.topics.length ? cfg.topics.map((k) => topicName(k, st.lang)).join(", ") : t("allTopics");
    const pl = t({ all: "poolAll", unanswered: "poolUn", wrong: "poolWrong", saved: "poolSaved" }[cfg.pool]);
    frame(`<h2 class="page-h">${t("navNew")}</h2>
    <div class="card exb"><h3>${t("summaryT")}</h3>
      <dl class="sumlist">
        <dt>${t("qCount")}</dt><dd>${cfg.n}</dd>
        <dt>${t("timing")}</dt><dd>${cfg.timed ? `${t("timed")} · ${Math.round((cfg.n * EXAM_SECONDS_PER_Q) / 60)} ${t("min")}` : t("untimed")}</dd>
        <dt>${t("solutions")}</dt><dd>${cfg.guided ? t("guided") : t("unguided")}</dd>
        <dt>${t("pool")}</dt><dd>${esc(pl)}</dd>
        <dt>${t("topicsL")}</dt><dd>${esc(tl)}</dd>
      </dl>
      ${cfg.timed ? `<p class="muted" style="font-size:13px">⏱ ${t("timerPolicy")}</p>` : ""}
      <div class="err" id="er" hidden></div>
      <div class="row2"><button class="primary" id="ms">${t("create")} ${fwd()}</button><button class="ghost" id="chg">${t("change")}</button></div>
    </div>`, { wide: true, nav: "newx" });
    $("chg").onclick = draw;
    $("ms").onclick = async () => {
      store.set("exam-cfg", cfg);
      $("ms").disabled = true;
      try {
        const ids = await api.examIds(TR(), cfg.n, cfg.topics, cfg.pool);
        if (!ids.length) { $("er").textContent = t("noneMatch"); $("er").hidden = false; $("ms").disabled = false; return; }
        const limit = cfg.timed ? ids.length * EXAM_SECONDS_PER_Q : null;
        const row = await api.createExam({ track: TR(), settings: { timed: cfg.timed, guided: cfg.guided, topics: cfg.topics, pool: cfg.pool, deadline: limit ? new Date(Date.now() + limit * 1000).toISOString() : null }, ids, picked: ids.map(() => null), time_limit: limit });
        runExam(row);
      } catch (e) { $("er").textContent = errMsg(e); $("er").hidden = false; $("ms").disabled = false; }
    };
  };
  draw();
}

/* ---------------- exam engine (saved on the server) ---------------- */
async function runExam(row) {
  loading();
  try {
    const items = await api.questionsByIds(TR(), row.ids);
    if (!items.length) { frame(`<div class="card"><p class="muted">${t("noItems")}</p><button class="ghost" id="hm">${t("home")}</button></div>`); $("hm").onclick = route; return; }
    keepTerms(items);
    // the copy saved on this phone wins when it has more answers (e.g. the last save didn't reach the server)
    const bk = store.get(`exb:${row.id}`), answeredIn = (arr) => (arr || []).filter((v) => v != null).length;
    const src = bk && bk.ids?.join() === row.ids.join() && answeredIn(bk.picked) >= answeredIn(row.picked) ? { ...row, picked: bk.picked, i: bk.i, used: Math.max(bk.used || 0, row.used || 0) } : row;
    const at = new Map(src.ids.map((id, i) => [id, i]));
    const picked = items.map((q) => { const v = src.picked?.[at.get(q.id)]; return v == null ? null : +v; });
    // timer policy: a timed exam has a fixed end time. Closing the app does not stop or reset the clock.
    const deadline = row.time_limit && row.settings?.deadline ? Date.parse(row.settings.deadline) : null;
    S = { mode: "exam", ex: row, items, picked, saved: picked.map((v) => v != null && !!row.settings?.guided), i: Math.min(src.i || 0, items.length - 1),
      start: deadline ? deadline - row.time_limit * 1000 : Date.now() - (src.used || 0) * 1000, deadline, limit: row.time_limit || null, guided: !!row.settings?.guided, tick: null, back: () => { saveExam(); myExams(); } };
    if (S.limit && examUsed() >= S.limit) { S.expired = true; return examEnd(); }
    examQ();
  } catch (e) {
    frame(`<div class="card"><p>${esc(errMsg(e))}</p><button class="primary" id="rt">${t("retry")}</button><button class="ghost" id="hm">${t("home")}</button></div>`);
    $("rt").onclick = () => runExam(row); $("hm").onclick = route;
  }
}
function examUsed() { const u = Math.floor((Date.now() - S.start) / 1000); return S.limit ? Math.min(S.limit, u) : u; }
// every change is kept on the phone first, then sent to the server; if the network is down it is sent again later
function saveExam() {
  if (S?.mode !== "exam" || S.ended) return;
  const ids = S.items.map((q) => q.id), body = { ids, picked: S.picked, i: S.i, used: examUsed() }, id = S.ex.id;
  store.set(`exb:${id}`, { ...body, ts: Date.now() });
  api.updateExam(id, body).then(() => { st.unsynced = null; }).catch(() => { st.unsynced = { id, body }; });
}
window.addEventListener("online", () => {
  const u = st.unsynced; if (!u) return;
  api.updateExam(u.id, u.body).then(() => { if (st.unsynced === u) st.unsynced = null; }).catch(() => {});
});
// finish now, with a confirmation that says how many questions are still unanswered
function confirmFinish() {
  document.querySelector(".sheet")?.remove();
  const left = S.picked.filter((x) => x == null).length;
  const el = document.createElement("div");
  el.className = "sheet"; el.dir = t("dir"); el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
  el.innerHTML = `<div class="sheet-in"><h2>${t("finishQ")}</h2><p>${left ? `${left} ${t("unanswered")}. ${t("finishLeft")}` : t("finishAll")}</p>
    <div class="row2"><button class="primary" id="cf1">${t("finish")}</button><button class="ghost" id="cf0">${t("keepGoing")}</button></div></div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.querySelector("#cf0").onclick = close; el.onclick = (e) => { if (e.target === el) close(); };
  el.querySelector("#cf1").onclick = () => { close(); examEnd(); };
  el.querySelector("#cf0").focus();
}
function examQ() {
  S.screen = examQ;
  const q = S.items[S.i], c = q[st.lang], tot = S.items.length, sel = S.picked[S.i];
  const locked = S.guided && sel != null;
  frame(`${qHead(S.i + 1, tot)}
  <div class="card">${qBody(q, S.i + 1, tot)}
    <div class="opts">${c.o.map((o, k) => `<button class="opt ${!S.guided && sel === k ? "sel" : ""}" data-k="${k}"><span class="l">${LET[st.lang][k]}</span><span>${esc(o)}</span></button>`).join("")}</div>
    ${S.guided ? `<div id="fb" style="margin-top:12px"></div>` : ""}
    <div class="mocknav stickynav"><button class="ghost" id="pv" ${S.i === 0 ? "disabled" : ""}>${bwd()} ${t("prev")}</button>${S.i < tot - 1 ? `<button class="primary" id="nx">${t("next")} ${fwd()}</button>` : `<button class="primary" id="fin">${t("finish")}</button>`}</div>
    <div class="exfoot"><span class="muted">${S.picked.filter((x) => x == null).length} ${t("unanswered")}</span>${S.i < tot - 1 ? `<button class="link" id="fin2">${t("finishNow")}</button>` : ""}</div>
  </div>`, { protect: true });
  const el = $("tm"), upd = () => {
    if (S?.screen !== examQ) return;
    const used = examUsed();
    if (S.limit) { const left = S.limit - used; if (left <= 0) { S.expired = true; return examEnd(); } clock(el, left); } else clock(el, used);
    if (used % 20 === 0) saveExam();
  };
  upd(); S.tick = setInterval(upd, 1000);
  $("bk").onclick = () => S.back(); bindMark(q);
  if (locked) $("fb").innerHTML = reveal(q, sel);
  else app.querySelectorAll(".opt").forEach((b) => (b.onclick = () => {
    const k = +b.dataset.k; S.picked[S.i] = k;
    if (S.guided) {
      const ok = k === q.answer; st.answers.set(q.id, ok); S.saved[S.i] = true;
      api.saveAnswer(st.user.id, TR(), q.id, k, ok).catch(() => {});
      $("fb").innerHTML = reveal(q, k);
      requestAnimationFrame(() => app.querySelector(".opts")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } else app.querySelectorAll(".opt").forEach((x) => x.classList.toggle("sel", x === b));
    saveExam();
  }));
  $("pv").onclick = () => { S.i--; saveExam(); examQ(); };
  if ($("nx")) $("nx").onclick = () => { S.i++; saveExam(); examQ(); };
  if ($("fin")) $("fin").onclick = confirmFinish;
  if ($("fin2")) $("fin2").onclick = confirmFinish;
}
async function examEnd() {
  stopTimer();
  const used = Math.min(examUsed(), S.limit || 1e9);
  S.ended = true;
  const ans = S.items.map((q, i) => S.picked[i] === q.answer);
  const saves = [];
  S.items.forEach((q, i) => {
    if (S.picked[i] == null || S.saved[i]) return;
    st.answers.set(q.id, ans[i]); saves.push(api.saveAnswer(st.user.id, TR(), q.id, S.picked[i], ans[i]).catch(() => {}));
  });
  const score = ans.filter(Boolean).length, p = pctOf(score, S.items.length);
  if (st.best == null || p > st.best) st.best = p;
  const ex = { ...S.ex, ids: S.items.map((q) => q.id), picked: S.picked, used, status: "done", score, finished_at: new Date().toISOString(), expired: !!S.expired };
  store.set(`exb:${ex.id}`, null);
  Promise.all([...saves, api.updateExam(ex.id, { ids: ex.ids, picked: ex.picked, i: S.i, used, status: "done", score, finished_at: ex.finished_at }).catch(() => {})])
    .then(() => api.claimMockXp(ex.id)).then(xpToast).catch(() => {});
  api.saveMock(st.user.id, TR(), score, S.items.length).catch(() => {});
  examResult(ex, S.items, "all");
}
// result / view / analysis of one exam
function examResult(ex, items, part = "all") {
  const picked = items.map((q) => { const i = ex.ids.indexOf(q.id); const v = ex.picked?.[i]; return v == null ? null : +v; });
  const n = items.length, c = items.filter((q, i) => picked[i] === q.answer).length, p = pctOf(c, n), s = ex.used || 0;
  const answered = picked.filter((v) => v != null).length, wrong = answered - c, blank = n - answered;
  const by = {}; items.forEach((q, i) => { by[q.topic] = by[q.topic] || [0, 0]; by[q.topic][1]++; if (picked[i] === q.answer) by[q.topic][0]++; });
  const weakT = Object.entries(by).filter(([, [a, b]]) => b >= 2 && a / b < 0.6).map(([k]) => k);
  const missIds = items.filter((q, i) => picked[i] !== q.answer).map((q) => q.id);
  S = { screen: () => examResult(ex, items, part), back: myExams, ex, items };
  const showA = part !== "review", showR = part !== "analysis";
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><h2 style="flex:1">${t("examNo")} #${ex.id}</h2></div>
  ${ex.expired ? `<div class="banner">⏱ ${t("timeUp")}</div>` : ""}
  <div class="card score">${ringSvg(p, 130)}
    <h2>${p >= 80 ? t("r80") : p >= 60 ? t("r60") : t("r0")}</h2>
    <div class="rw"><div><b class="okc">${c}</b><span>${t("rightN")}</span></div><div><b class="badc">${wrong}</b><span>${t("wrongN")}</span></div><div><b>${blank}</b><span>${t("unanswered")}</span></div></div>
    <p class="muted">⏱ ${Math.floor(s / 60)} ${t("min")} ${s % 60} ${t("sec")}${answered ? ` · ${Math.round(s / answered)} ${t("sec")} / ${t("q")}` : ""}</p>
    <div id="cmp" class="muted"></div>
  </div>
  <div class="actions res-actions">${showR && part === "all" ? `<button class="ghost" id="rv">${t("review")}</button>` : ""}${missIds.length ? `<button class="primary" id="rw">${t("retryWrong")} (${missIds.length})</button>` : ""}<button class="ghost" id="hm">${t("home")}</button></div>
  ${showA ? `<div class="section-title">${t("strengths")}</div>
  ${topicBars(Object.entries(by).map(([k, [a, b]]) => ({ k, a, b })))}
  ${weakT.length ? `<div class="section-title">${t("reviewTopics")}</div><div class="chips">${weakT.map((k) => `<button class="chip pick warm" data-tp="${esc(k)}">${esc(topicName(k, st.lang))}</button>`).join("")}</div>` : ""}` : ""}
  ${showR ? `<div class="section-title" id="rvs">${t("review")}</div><div class="review protect">${items.map((q, i) => { const pk = picked[i], ok = pk === q.answer, c2 = q[st.lang]; return `<div class="rv"><span class="st ${ok ? "okc" : "badc"}">${i + 1}. ${ok ? t("correct") : pk == null ? t("none") : t("wrong")}</span><span>${esc(c2.q)}</span>${ok ? "" : `<span class="muted">${t("yourAns")}: ${pk == null ? t("none") : esc(c2.o[pk])}</span>`}<span class="muted">${t("rightAns")}: <b>${esc(c2.o[q.answer])}</b></span><span class="muted" style="white-space:pre-line">${esc(c2.e || t("noExp"))}</span></div>`; }).join("")}</div>` : ""}
  <div class="actions"><button class="primary" id="nw">${t("newExamGo")}</button><button class="ghost" id="ml">${t("navExams")}</button></div>`, { protect: showR });
  $("bk").onclick = myExams; $("nw").onclick = newExam; $("ml").onclick = myExams; $("hm").onclick = route;
  if ($("rv")) $("rv").onclick = () => $("rvs").scrollIntoView({ behavior: "smooth" });
  if ($("rw")) $("rw").onclick = () => practice({ kind: "ids", ids: missIds });
  app.querySelectorAll("[data-tp]").forEach((b) => (b.onclick = () => practice({ kind: "topic", topic: b.dataset.tp })));
  // comparison with earlier finished exams (only real data; a message when there is nothing to compare)
  api.myExams(st.user.id, TR()).then((list) => {
    if (!$("cmp")) return;
    const prev = list.filter((x) => x.status === "done" && x.id !== ex.id && new Date(x.finished_at || x.created_at) < new Date(ex.finished_at || Date.now()));
    if (!prev.length) { $("cmp").textContent = t("noCompare"); return; }
    const last = prev.sort((a, b) => new Date(b.finished_at || b.created_at) - new Date(a.finished_at || a.created_at))[0];
    const lp = pctOf(last.score, last.ids.length), avg = Math.round(prev.reduce((a, x) => a + pctOf(x.score, x.ids.length), 0) / prev.length), d = p - lp;
    $("cmp").innerHTML = `${t("prevExam")}: <b>${lp}%</b> (${d >= 0 ? "+" : ""}${d}) · ${t("avgExams")} (${prev.length}): <b>${avg}%</b>`;
  }).catch(() => {});
}
async function openExam(ex, part) {
  loading();
  try { examResult(ex, await api.questionsByIds(TR(), ex.ids), part); }
  catch (e) { frame(`<div class="card"><p>${esc(errMsg(e))}</p><button class="ghost" id="hm">${t("back")}</button></div>`); $("hm").onclick = myExams; }
}

/* ---------------- my exams ---------------- */
async function myExams() {
  S = { screen: myExams };
  frame(`<h2 class="page-h">${t("navExams")}</h2><div class="loading"><div class="spin"></div></div>`, { wide: true, nav: "exams" });
  let list;
  try { list = await api.myExams(st.user.id, TR()); }
  catch (e) { if (S?.screen !== myExams) return; frame(`<h2 class="page-h">${t("navExams")}</h2><div class="card"><p>${esc(errMsg(e))}</p><button class="primary" id="rt">${t("retry")}</button></div>`, { wide: true, nav: "exams" }); $("rt").onclick = myExams; return; }
  if (S?.screen !== myExams) return;
  let armed = null;
  const draw = () => {
    frame(`<div class="page-hrow"><h2 class="page-h">${t("navExams")}</h2><button class="primary slim" id="nw">+ ${t("navNew")}</button></div>
    <p class="muted">${list.length} ${t("examsFound")}</p>
    ${!list.length ? `<div class="card"><p class="muted">${t("noExams")}</p><button class="primary" id="nw2">${t("newExamGo")}</button></div>` : ""}
    <div class="xlist">${list.map((x) => {
      const n = x.ids.length, done = x.status === "done", ans = (x.picked || []).filter((v) => v != null).length, set = x.settings || {};
      return `<div class="xrow">
        <div class="xmain"><b>${t("examNo")} #${x.id}</b><span class="muted">${fmtDate(x.created_at)} · ${fmtTime(x.created_at)}</span>
          <span class="xtags"><span class="tag">${set.timed ? "⏱ " + t("timed") : t("untimed")}</span><span class="tag">${set.guided ? t("guided") : t("unguided")}</span></span></div>
        <div class="xstat ${done ? "okline" : ""}">${done ? `${t("doneSt")} · <b>${pctOf(x.score, n)}%</b> <span class="muted">(${x.score}/${n})</span>` : `${t("openSt")} · ${ans}/${n}`}</div>
        <div class="xact">${done ? `<button class="ghost slim" data-v="${x.id}">${t("view")}</button><button class="ghost slim" data-a="${x.id}">${t("analysis")}</button>` : `<button class="primary slim" data-c="${x.id}">${t("contExam")}</button>`}
          <button class="link danger-l" data-d="${x.id}">${armed === x.id ? t("deleteSure") : t("delete")}</button></div>
      </div>`; }).join("")}</div>`, { wide: true, nav: "exams" });
    const get = (id) => list.find((x) => x.id === +id);
    if ($("nw")) $("nw").onclick = newExam; if ($("nw2")) $("nw2").onclick = newExam;
    app.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => runExam(get(b.dataset.c))));
    app.querySelectorAll("[data-v]").forEach((b) => (b.onclick = () => openExam(get(b.dataset.v), "review")));
    app.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => openExam(get(b.dataset.a), "analysis")));
    app.querySelectorAll("[data-d]").forEach((b) => (b.onclick = async () => {
      const id = +b.dataset.d;
      if (armed !== id) { armed = id; return draw(); }
      armed = null; list = list.filter((x) => x.id !== id); draw();
      api.deleteExam(id).catch(() => {});
    }));
  };
  draw();
}

/* ---------------- my questions (solved) ---------------- */
async function myQuestions(keep) {
  const Q = keep || { filter: "all", shown: 20, rows: null, cache: new Map() };
  S = { screen: () => myQuestions(Q) };
  if (!Q.rows) {
    frame(`<h2 class="page-h">${t("navQs")}</h2><div class="loading"><div class="spin"></div></div>`, { wide: true, nav: "qs" });
    try { Q.rows = await api.answerHistory(st.user.id, TR()); }
    catch (e) { frame(`<h2 class="page-h">${t("navQs")}</h2><div class="card"><p>${esc(errMsg(e))}</p></div>`, { wide: true, nav: "qs" }); return; }
  }
  const rows = Q.rows.filter((r) => Q.filter === "all" || (Q.filter === "right" && r.correct) || (Q.filter === "wrong" && !r.correct) || (Q.filter === "saved" && st.marks.has(r.question_id)));
  const page = rows.slice(0, Q.shown), need = page.map((r) => r.question_id).filter((id) => !Q.cache.has(id));
  if (need.length) {
    frame(`<h2 class="page-h">${t("navQs")}</h2><div class="loading"><div class="spin"></div></div>`, { wide: true, nav: "qs" });
    try { (await api.questionsByIds(TR(), need)).forEach((q) => Q.cache.set(q.id, q)); } catch { /* show what we have */ }
  }
  const keyPoint = (q) => { const { per, gen } = parseExp(q[st.lang].e); return (per[q.answer] || gen || "").split("\n")[0]; };
  frame(`<h2 class="page-h">${t("navQs")}</h2>
  <p class="muted">${Q.rows.length} ${t("qsSolved")}</p>
  <div class="chips">${[["all", "fAll"], ["right", "fRight"], ["wrong", "fWrong"], ["saved", "fSaved"]].map(([v, l]) => `<button class="chip pick ${Q.filter === v ? "cool" : ""}" data-f="${v}">${t(l)}</button>`).join("")}</div>
  ${!rows.length ? `<div class="card"><p class="muted">${t("noItems")}</p></div>` : ""}
  <div class="qlist protect">${page.map((r) => { const q = Q.cache.get(r.question_id); if (!q) return ""; return `<button class="qrow" data-q="${q.id}">
    <span class="qn ${r.correct ? "okc" : "badc"}">${r.correct ? "✓" : "✗"} <small>#${q.id}</small></span>
    <span class="qq">${esc(q[st.lang].q)}</span>
    <span class="qk"><small>${t("remember")}</small>${esc(keyPoint(q))}</span>
    <span class="qv">${t("view")} ${fwd()}</span></button>`; }).join("")}</div>
  ${rows.length > Q.shown ? `<button class="ghost" id="more">${t("loadMore")} (${rows.length - Q.shown})</button>` : ""}`, { wide: true, nav: "qs" });
  app.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { Q.filter = b.dataset.f; Q.shown = 20; myQuestions(Q); }));
  if ($("more")) $("more").onclick = () => { Q.shown += 20; myQuestions(Q); };
  app.querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => viewQuestion(Q.cache.get(+b.dataset.q), Q.rows.find((r) => r.question_id === +b.dataset.q)?.picked, () => myQuestions(Q))));
}
function viewQuestion(q, picked, back) {
  S = { screen: () => viewQuestion(q, picked, back), back };
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><h2 style="flex:1">#${q.id}</h2></div>
  <div class="card">${qBody(q, 1, 1)}
    <div class="opts">${q[st.lang].o.map((o, k) => `<button class="opt" data-k="${k}"><span class="l">${LET[st.lang][k]}</span><span>${esc(o)}</span></button>`).join("")}</div>
    <div id="fb"></div>
    <button class="ghost" id="again">${t("again")}</button>
  </div>`, { protect: true });
  app.querySelector(".qmeta span:last-child")?.remove();
  $("bk").onclick = back; bindMark(q);
  const show = (k) => { $("fb").innerHTML = reveal(q, k); };
  if (picked != null) show(+picked);
  else app.querySelectorAll(".opt").forEach((b) => (b.onclick = () => show(+b.dataset.k)));
  $("again").onclick = () => {
    app.querySelectorAll(".opt").forEach((b) => { b.disabled = false; b.className = "opt"; b.querySelector(".why")?.remove(); b.onclick = () => {
      const k = +b.dataset.k, ok = k === q.answer; st.answers.set(q.id, ok); api.saveAnswer(st.user.id, TR(), q.id, k, ok).catch(() => {}); show(k);
    }; });
    $("fb").innerHTML = "";
  };
}

/* ---------------- statistics ---------------- */
async function stats() {
  S = { screen: stats };
  frame(`<h2 class="page-h">${t("navStats")}</h2><div class="loading"><div class="spin"></div></div>`, { wide: true, nav: "stats" });
  const [hist, act, exams] = await Promise.all([api.answerHistory(st.user.id, TR()).catch(() => []), api.activity(st.user.id, TR(), 14), api.myExams(st.user.id, TR()).catch(() => [])]);
  if (S?.screen !== stats) return;
  const tt = totals(), done = hist.length || tt.done;
  const right = hist.length ? hist.filter((r) => r.correct).length : tt.right;
  const first = hist.filter((r) => (r.first_correct ?? r.correct)).length;
  const attempts = hist.reduce((a, r) => a + (r.attempts || 1), 0);
  const level = tt.n ? Math.min(5, (right / tt.n) * 5) : 0;
  const fin = exams.filter((x) => x.status === "done");
  const exQ = fin.reduce((a, x) => a + (x.picked || []).filter((v) => v != null).length, 0), exS = fin.reduce((a, x) => a + (x.used || 0), 0);
  const best = fin.length ? Math.max(...fin.map((x) => pctOf(x.score, x.ids.length))) : st.best;
  const byT = Object.keys(st.counts).sort().map((k) => ({ k, b: st.counts[k] }));
  frame(`<h2 class="page-h">${t("navStats")}</h2>
  <div class="stat-top">
    <div class="card st-main">${ringSvg(pctOf(done, tt.n), 110)}<div><div class="bignum"><b>${done}</b><span>/</span><b>${tt.n}</b></div><span class="muted">${t("solved")} · ${t("inBank")}</span></div></div>
    <div class="card st-box"><span class="muted">${t("firstTry")}</span><span class="pct">${pctOf(first, done)}%</span><span>${first} / ${done} ${t("correctAns")}</span></div>
    <div class="card st-box"><span class="muted">${t("curAvg")}</span><span class="pct">${pctOf(right, done)}%</span><span>${right} / ${done} ${t("correctAns")}</span></div>
    <div class="card st-box"><span class="muted">${t("level")}</span><span class="pct">${level.toFixed(1)}<small>/5</small></span><div class="lvl"><i style="left:${(level / 5) * 100}%"></i></div><span class="muted" style="font-size:12px">${t("levelD")}</span></div>
  </div>
  <div class="card defs"><div class="big-stat"><div class="tile"><span>${t("uniqueQs")}</span><span class="n">${done}</span></div><div class="tile"><span>${t("attemptsN")}</span><span class="n">${attempts}</span></div></div>
    <p class="muted" style="font-size:13px">ℹ️ ${t("statsDefs")}</p></div>
  <div class="card"><div class="card-h"><h3>${t("activityL")}</h3><span class="muted">${t("last14")}</span></div>${activityChart(act)}</div>
  <div class="section-title">${t("byTopicA")}</div>
  <div id="bytopic"><div class="spin sm"></div></div>
  <div class="section-title">${t("timeMgmt")}</div>
  <div class="big-stat"><div class="tile"><span>${t("avgPerQ")}</span><span class="n">${exQ ? Math.round(exS / exQ) : "—"} ${exQ ? t("sec") : ""}</span><span class="muted">${t("recPerQ")}</span></div>
  <div class="tile"><span>${t("examsDone")}</span><span class="n">${fin.length}</span><span class="muted">${t("bestExam")}: ${best == null ? "—" : best + "%"}</span></div></div>`, { wide: true, nav: "stats" });
  let agg = {};
  try { (await api.topicStats(TR())).forEach((r) => (agg[r.topic] = [r.answered, r.correct])); }
  catch {
    // older database without my_topic_stats: look the topics up from the questions
    const known = st.qTopic || (st.qTopic = new Map());
    const need = hist.map((r) => r.question_id).filter((id) => !known.has(id)).slice(0, 300);
    try { if (need.length) (await api.questionsByIds(TR(), need)).forEach((q) => known.set(q.id, q.topic)); } catch { /* partial */ }
    hist.forEach((r) => { const k = known.get(r.question_id); if (!k) return; agg[k] = agg[k] || [0, 0]; agg[k][0]++; if (r.correct) agg[k][1]++; });
  }
  if (S?.screen !== stats || !$("bytopic")) return;
  $("bytopic").innerHTML = topicBars(byT.map(({ k, b }) => { const [a, c] = agg[k] || [0, 0]; return { k, a, b, acc: a ? c / a : 0, sub: `${a}/${b} ${t("answeredL")} · ${pctOf(c, a)}%` }; }));
}

/* ---------------- tools ---------------- */
function tools() {
  S = { screen: tools };
  frame(`${msgHtml()}<h2 class="page-h">${t("navTools")}</h2>
  <div class="tools-grid">
    <div class="card"><h3>${t("acct")}</h3><p class="muted">${t("acctD")}</p><button class="primary" id="ac">${t("acct")}</button></div>
    <div class="card"><h3>${t("refT")}</h3><p class="muted">${t("refD")}</p><button class="primary" id="rfp">${t("refT")}</button></div>
    <div class="card"><h3>${t("calcT")}</h3><p class="muted">${t("calcD")}</p><button class="primary" id="clc">${t("calcT")}</button></div>
    <div class="card"><h3>${t("search")}</h3><p class="muted">${t("searchD")}</p><button class="primary" id="srch">${t("search")}</button></div>
    <div class="card"><h3>${t("flash")}</h3><p class="muted">${t("cardsD")}</p><button class="primary" id="fl">${t("flash")}</button></div>
    <div class="card"><h3>👋 ${t("introAgain")}</h3><p class="muted">${t("introAgainD")}</p><button class="ghost" id="ina">${t("introAgain")}</button></div>
    <div class="card"><h3>${t("helpT")}</h3><p class="muted">${t("helpD")}</p><button class="primary" id="hp">${t("contact")}</button></div>
    <div class="card"><h3>${t("jTitle")}</h3><p class="muted">${t("jBuildD")}</p><button class="primary" id="jt">${t("jTitle")}</button></div>
    <div class="card"><h3>🏆 ${t("league")}</h3><p class="muted">${t("leagueJoinD")}</p><button class="primary" id="lgt2">${t("league")}</button></div>
    ${reminderCard()}
    <div class="card"><h3>${t("resetT")}</h3><p class="muted">${t("resetD")}</p><button class="danger" id="rs">${st.ui.resetArmed ? t("resetSure") : t("resetBtn")}</button></div>
  </div>
  ${legalLinks()}`, { wide: true, nav: "tools" });
  bindLegal(); st.ui.msg = null; bindReminder();
  $("jt").onclick = async () => { try { st.plan = await api.getPlan(st.user.id, TR()); } catch { st.plan = null; } st.plan ? journey() : planSetup(tools); };
  $("ac").onclick = account; $("hp").onclick = () => contact(tools); $("ina").onclick = () => intro(0); $("lgt2").onclick = league;
  $("rfp").onclick = () => refPage(tools); $("clc").onclick = () => calcTrainer(tools); $("srch").onclick = () => searchPage(tools);
  $("fl").onclick = () => { st.ui.flashI = 0; st.ui.flashBack = false; cards(); };
  $("rs").onclick = async () => {
    if (!st.ui.resetArmed) { st.ui.resetArmed = true; return tools(); }
    st.ui.resetArmed = false;
    try { await api.resetProgress(TR()); st.answers = new Map(); st.best = null; st.qTopic = null; store.set(posKey(), 0); flash(t("resetDone")); }
    catch (e) { flash(errMsg(e), true); }
    tools();
  };
}

/* ---------------- daily mission (server-built, server-checked) ---------------- */
const MISSION_N = 10;
const prevDay = (s) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() - 1); return d.toLocaleDateString("en-CA"); };
// study streak: a day counts if the student answered questions or finished the mission.
// One missed day per week is forgiven, so a single bad day doesn't wipe the streak.
function streakOf(rows, mdays = st.missionDays || []) {
  const by = new Set([...(rows || []).filter((r) => r.n > 0).map((r) => r.day), ...mdays.filter((m) => m.status === "done").map((m) => m.day)]);
  let d = today(), n = 0, i = 0, lastFree = -99;
  if (!by.has(d)) d = prevDay(d);
  for (;;) {
    if (by.has(d)) n++;
    else if (i - lastFree > 7 && by.has(prevDay(d))) lastFree = i;
    else break;
    d = prevDay(d); i++;
    if (i > 400) break;
  }
  return n;
}
function missionCard(m, state) {
  if (state === "loading") return `<div class="mission sk"><span class="eyebrow">${t("mission")}</span><div class="spin sm"></div></div>`;
  if (state === "error") return `<div class="mission"><span class="eyebrow">${t("mission")}</span><p class="muted">${t("missionErr")}</p><button class="ghost slim" id="mretry">${t("retry")}</button></div>`;
  if (!m) return "";
  const n = m.ids.length, done = (m.picked || []).filter((v) => v != null).length;
  if (m.status === "done") return `<div class="mission done"><div class="mission-h"><span class="badge-ok" aria-hidden="true">✓</span><div><b>${t("missionDone")}</b><span class="muted">${m.correct}/${n} ${t("rightN")} · ${t("missionDoneD")}</span></div></div>
    <button class="ghost slim" id="mres">${t("seeResults")}</button></div>`;
  const k = (x) => (m.kinds || []).filter((v) => v === x).length;
  return `<div class="mission">
    <div class="mission-h"><div><span class="eyebrow">${t("mission")}</span><h2>${n} ${t("qs")}</h2></div><span class="mleft">${t("left")} <b>${n - done}</b></span></div>
    <div class="gbar" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${done}"><i style="width:${pctOf(done, n)}%"></i></div>
    <div class="mkinds">${k("review") ? `<span>🔁 ${k("review")} ${t("kReview")}</span>` : ""}${k("weak") ? `<span>🎯 ${k("weak")} ${t("kWeak")}</span>` : ""}${k("mix") ? `<span>🧩 ${k("mix")} ${t("kMix")}</span>` : ""}</div>
    <button class="primary" id="mgo">${done ? t("contMission") : t("startMission")} ${fwd()}</button>
  </div>`;
}
async function fillMission() {
  const w = $("missionw"); if (!w) return;
  w.innerHTML = missionCard(null, "loading");
  try {
    const [m, days] = await Promise.all([api.dailyMission(TR(), MISSION_N), api.missionDays(st.user.id, TR())]);
    st.mission = m; st.missionDays = days;
  } catch (e) {
    // database without the mission functions yet: just hide the card
    if (/get_daily_mission|function|schema cache/i.test(e?.message || "")) { w.innerHTML = ""; return; }
    if (S?.screen !== home || !$("missionw")) return;
    $("missionw").innerHTML = missionCard(null, "error"); $("mretry").onclick = fillMission; return;
  }
  if (S?.screen !== home || !$("missionw")) return;
  $("missionw").innerHTML = missionCard(st.mission);
  if ($("mgo")) $("mgo").onclick = () => missionRun(st.mission);
  if ($("mres")) $("mres").onclick = () => missionFinish();
  scheduleReminders();
}
async function missionRun(m) {
  loading();
  try {
    const items = await api.questionsByIds(TR(), m.ids);
    const byId = new Map(items.map((q) => [q.id, q]));
    keepTerms(items);
    // keep the server's order; questions that were unpublished meanwhile are skipped
    const slots = m.ids.map((id, i) => ({ q: byId.get(id), i, pick: m.picked?.[i] ?? null })).filter((x) => x.q);
    if (!slots.length) throw new Error(t("noItems"));
    const first = slots.findIndex((x) => x.pick == null);
    S = { mode: "mission", m, slots, at: first < 0 ? slots.length - 1 : first, start: Date.now(), tick: null, back: route };
    missionQ();
  } catch (e) {
    frame(`<div class="card"><p>${esc(errMsg(e))}</p><button class="primary" id="rt">${t("retry")}</button><button class="ghost" id="hm">${t("home")}</button></div>`);
    $("rt").onclick = () => missionRun(m); $("hm").onclick = route;
  }
}
function missionQ() {
  S.screen = missionQ;
  const sl = S.slots[S.at], q = sl.q, c = q[st.lang], tot = S.slots.length;
  const answered = S.slots.filter((x) => x.pick != null).length, last = S.at === tot - 1;
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("home")}">${bwd()}</button>
    <div class="progress"><i style="width:${pctOf(answered, tot)}%"></i></div><span class="timer">${t("left")} ${tot - answered}</span></div>
  <div class="card">${qBody(q, S.at + 1, tot)}
    <div class="opts">${c.o.map((o, k) => `<button class="opt" data-k="${k}"><span class="l">${LET[st.lang][k]}</span><span>${esc(o)}</span></button>`).join("")}</div>
    <div class="err" id="er" hidden></div>
    <div id="fb"></div>
  </div>`, { protect: true });
  app.querySelector(".qmeta").insertAdjacentHTML("beforeend", `<span class="tag kind">${{ review: "🔁 " + t("kReview"), weak: "🎯 " + t("kWeak"), mix: "🧩 " + t("kMix") }[S.m.kinds?.[sl.i]] || ""}</span>`);
  $("bk").onclick = route; bindMark(q);
  const after = () => {
    const allDone = S.slots.every((x) => x.pick != null);
    $("fb").insertAdjacentHTML("beforeend", `<button class="primary" id="nx" style="margin-top:12px">${allDone ? t("finishMission") : t("next") + " " + fwd()}</button>`);
    $("nx").onclick = () => {
      const nextOpen = S.slots.findIndex((x, j) => j > S.at && x.pick == null);
      const anyOpen = S.slots.findIndex((x) => x.pick == null);
      if (nextOpen >= 0) { S.at = nextOpen; missionQ(); } else if (anyOpen >= 0) { S.at = anyOpen; missionQ(); } else missionFinish();
    };
  };
  if (sl.pick != null) { $("fb").innerHTML = reveal(q, sl.pick); after(); return; }
  app.querySelectorAll(".opt").forEach((b) => (b.onclick = async () => {
    const k = +b.dataset.k;
    app.querySelectorAll(".opt").forEach((x) => (x.disabled = true));
    b.classList.add("sel");
    try {
      const ok = await api.missionAnswer(TR(), sl.i, k);
      sl.pick = k; S.m.picked[sl.i] = k; st.answers.set(q.id, !!ok);
      if (S?.screen !== missionQ) return;
      b.classList.remove("sel");
      $("fb").innerHTML = reveal(q, k); after();
      const n2 = S.slots.filter((x) => x.pick != null).length;
      app.querySelector(".qbar .progress i").style.width = pctOf(n2, tot) + "%";
      app.querySelector(".qbar .timer").textContent = `${t("left")} ${tot - n2}`;
      requestAnimationFrame(() => app.querySelector(".opts")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e) {
      b.classList.remove("sel");
      app.querySelectorAll(".opt").forEach((x) => (x.disabled = false));
      $("er").textContent = errMsg(e); $("er").hidden = false;
    }
  }));
}
async function missionFinish() {
  loading();
  let res;
  try { res = await api.completeMission(TR()); }
  catch (e) {
    frame(`<div class="card"><p>${esc(errMsg(e))}</p><button class="primary" id="rt">${t("retry")}</button><button class="ghost" id="hm">${t("home")}</button></div>`);
    $("rt").onclick = missionFinish; $("hm").onclick = route; return;
  }
  if (st.mission) st.mission.status = "done";
  const days = await api.missionDays(st.user.id, TR()).catch(() => st.missionDays || []);
  st.missionDays = days;
  const act = await api.activity(st.user.id, TR(), 60).catch(() => []);
  scheduleReminders();
  const n = res.total, c = res.correct, topics = res.topics || [];
  xpToast(res.xp);
  S = { screen: missionFinish, back: route };
  frame(`<div class="card score celebrate">
    <div class="big-emoji" aria-hidden="true">🎉</div>
    <h2>${t("bravo")}</h2>
    <div class="rw"><div><b class="okc">${c}</b><span>${t("rightN")}</span></div><div><b class="badc">${n - c}</b><span>${t("wrongN")}</span></div><div><b>🔥 ${streakOf(act, days)}</b><span>${t("streak")}</span></div></div>
    <p class="muted">${t("streakNote")}</p>
    ${res.xp ? `<p class="okc"><b>+${res.xp} XP</b> · ${t("league")}</p>` : ""}
  </div>
  <div class="section-title">${topics.length ? t("reviewTopics") : t("allGood")}</div>
  ${topics.length ? `<div class="chips">${topics.map((k) => `<button class="chip pick cool" data-tp="${esc(k)}">${esc(topicName(k, st.lang))}</button>`).join("")}</div>` : ""}
  <div class="actions"><button class="primary" id="hm">${t("home")}</button><button class="ghost" id="mp">${t("morePractice")}</button></div>
  <p class="muted" style="text-align:center">${t("missionDoneD")}</p>`);
  $("hm").onclick = route; $("mp").onclick = () => practice({ kind: "seq" });
  app.querySelectorAll("[data-tp]").forEach((b) => (b.onclick = () => practice({ kind: "topic", topic: b.dataset.tp })));
}

/* ---------------- daily reminder (phone only, local notifications) ---------------- */
const remKey = () => `reminder:${st.user.id}`;
const canNotify = () => Capacitor.getPlatform() !== "web";
async function scheduleReminders() {
  if (!canNotify() || !st.user) return;
  const r = store.get(remKey());
  try {
    const pend = await LocalNotifications.getPending();
    const mine = (pend?.notifications || []).filter((x) => x.id >= 7001 && x.id <= 7014);
    if (mine.length) await LocalNotifications.cancel({ notifications: mine.map((x) => ({ id: x.id })) });
    if (!r?.on) return;
    const [h, mi] = String(r.time || "19:00").split(":").map(Number);
    const doneToday = st.mission?.status === "done" && st.mission?.day === today();
    const list = [];
    for (let k = 0; k < 14; k++) {
      const at = new Date(); at.setDate(at.getDate() + k); at.setHours(h, mi, 0, 0);
      if (at <= new Date() || (k === 0 && doneToday)) continue;
      list.push({ id: 7001 + k, title: t("name"), body: t("remBody"), schedule: { at, allowWhileIdle: true } });
    }
    if (list.length) await LocalNotifications.schedule({ notifications: list });
  } catch { /* notifications unavailable */ }
}
function reminderCard() {
  const r = store.get(remKey()) || { on: false, time: "19:00" };
  if (!canNotify()) return `<div class="card"><h3>${t("reminder")}</h3><p class="muted">${t("remWeb")}</p></div>`;
  return `<div class="card"><h3>${t("reminder")}</h3><p class="muted">${t("reminderD")}</p>
    <div class="row2"><input id="rtm" type="time" value="${esc(r.time)}" aria-label="${t("remTime")}"><button class="${r.on ? "ghost" : "primary"} slim" id="ron">${r.on ? t("remOff") : t("remOn")}</button></div>
    <div class="err" id="rer" hidden></div></div>`;
}
function bindReminder() {
  if (!$("ron")) return;
  $("rtm").onchange = () => { const r = store.get(remKey()) || { on: false }; r.time = $("rtm").value || "19:00"; store.set(remKey(), r); scheduleReminders(); };
  $("ron").onclick = async () => {
    const r = store.get(remKey()) || { on: false, time: "19:00" };
    r.time = $("rtm").value || r.time;
    if (!r.on) {
      try {
        let p = await LocalNotifications.checkPermissions();
        if (p.display !== "granted") p = await LocalNotifications.requestPermissions();
        if (p.display !== "granted") { $("rer").textContent = t("remDenied"); $("rer").hidden = false; return; }
      } catch { $("rer").textContent = t("remDenied"); $("rer").hidden = false; return; }
    }
    r.on = !r.on; store.set(remKey(), r); await scheduleReminders(); tools();
  };
}

/* ---------------- road to the licensing exam (study plan) ---------------- */
const addDays = (s, k) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + k); return d.toLocaleDateString("en-CA"); };
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
const localDay = (ts) => new Date(ts).toLocaleDateString("en-CA");
const REST_ORDER = [6, 5, 2, 4, 1, 3, 0]; // rest days are taken from Saturday, Friday, Tuesday... first
const planN = (p) => Math.min(30, Math.max(5, Math.round(p.minutes / 1.5)));
function planPhase(left) { return left <= 7 ? "final" : left <= 21 ? "review" : "build"; }
// one day of the plan: what to do on `date`
function planDay(p, date) {
  const left = daysBetween(date, p.exam_date), wd = new Date(date + "T12:00:00").getDay();
  const rest = new Set(REST_ORDER.slice(0, 7 - p.days_per_week));
  if (left < 0) return { date, type: "after" };
  if (left === 0) return { date, type: "exam" };
  if (left === 1) return { date, type: "light", mission: Math.min(10, planN(p)) };
  if (rest.has(wd)) return { date, type: "rest" };
  const phase = planPhase(left);
  const studyDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => !rest.has(d));
  const mockDays = phase === "build" ? studyDays.slice(-1) : phase === "review" ? [studyDays[1] ?? studyDays[0], studyDays.at(-1)] : studyDays.filter((_, i) => i % 2 === 1);
  const size = Math.min(totals().n || 50, phase === "build" ? 50 : phase === "review" ? 100 : 150);
  return { date, type: "study", mission: planN(p), mock: mockDays.includes(wd) ? size : 0 };
}
function planProgress(p, mdays) {
  const start = localDay(p.created_at), end = today() < p.exam_date ? today() : p.exam_date;
  let expected = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) { const x = planDay(p, d); if (x.type === "study" || x.type === "light") expected++; }
  const done = (mdays || []).filter((m) => m.status === "done" && m.day >= start).length;
  return { expected, done, pct: expected ? Math.min(100, pctOf(done, expected)) : 0 };
}
function weeklyAccuracy(rows, weeks = 8) {
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const end = addDays(today(), -7 * w), start = addDays(end, -6);
    const r = (rows || []).filter((x) => x.day >= start && x.day <= end);
    const n = r.reduce((a, x) => a + x.n, 0), c = r.reduce((a, x) => a + x.correct, 0);
    out.push({ label: `${end.slice(8)}.${end.slice(5, 7)}`, n, p: n ? Math.round((c / n) * 100) : null });
  }
  return out;
}
function trendChart(pts) {
  const W = 300, H = 120, pad = 18, xs = (i) => pad + (i * (W - 2 * pad)) / Math.max(1, pts.length - 1), ys = (p) => H - pad - (p / 100) * (H - 2 * pad);
  const real = pts.map((x, i) => ({ ...x, i })).filter((x) => x.p != null);
  if (!real.length) return `<p class="muted">${t("noTrend")}</p>`;
  const path = real.map((x, k) => `${k ? "L" : "M"}${xs(x.i).toFixed(1)},${ys(x.p).toFixed(1)}`).join(" ");
  return `<svg class="trend" viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="${t("trendL")}">
    ${[0, 50, 100].map((g) => `<line x1="${pad}" x2="${W - pad}" y1="${ys(g)}" y2="${ys(g)}" stroke="var(--line)" stroke-dasharray="${g ? "3 4" : ""}"/><text x="2" y="${ys(g) + 3}" font-size="8" fill="var(--muted)">${g}%</text>`).join("")}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${real.map((x) => `<circle cx="${xs(x.i)}" cy="${ys(x.p)}" r="4" fill="var(--surface)" stroke="var(--accent)" stroke-width="2"><title>${x.label}: ${x.p}% (${x.n})</title></circle>`).join("")}
    ${pts.map((x, i) => (i % 2 === pts.length % 2 ? `<text x="${xs(i)}" y="${H + 10}" text-anchor="middle" font-size="8" fill="var(--muted)">${x.label}</text>` : "")).join("")}
  </svg>`;
}
function journeyCard(p, prog) {
  if (!p) return `<button class="jcta" id="jgo"><span class="jicon" aria-hidden="true">🧭</span><span><b>${t("jBuild")}</b><small>${t("jBuildD")}</small></span><span aria-hidden="true">${fwd()}</span></button>`;
  const left = Math.max(0, daysBetween(today(), p.exam_date));
  return `<button class="jcta" id="jgo"><span class="jdays"><b>${left}</b><small>${t("daysLeft")}</small></span><span><b>${t("jTitle")}</b><small>${t("jPlanDone")} ${prog.pct}%</small><span class="gbar"><i style="width:${prog.pct}%"></i></span></span><span aria-hidden="true">${fwd()}</span></button>`;
}
async function fillJourney() {
  const w = $("journeyw"); if (!w) return;
  let p;
  try { p = await api.getPlan(st.user.id, TR()); } catch { return; } // database not updated yet: keep the simple exam-date box
  st.plan = p;
  if (S?.screen !== home || !$("journeyw")) return;
  const days = st.missionDays || (await api.missionDays(st.user.id, TR()).catch(() => []));
  $("journeyw").innerHTML = journeyCard(p, p ? planProgress(p, days) : null);
  $("jgo").onclick = () => (p ? journey() : planSetup());
}

function planSetup(back = route) {
  const p = st.plan || {};
  const f = { exam: p.exam_date || st.profile.exam_date || "", minutes: p.minutes || 30, days: p.days_per_week || 5, weak: [...(p.weak_topics || [])] };
  S = { screen: () => planSetup(back), back };
  const topics = Object.keys(st.counts).sort();
  const draw = () => {
    frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><h2 style="flex:1">${t("jTitle")}</h2></div>
    <div class="card exb">
      <p class="muted">${t("jSetupD")}</p>
      <div class="field"><label for="pe">${t("jExam")}</label><input id="pe" type="date" min="${today()}" value="${esc(f.exam)}"></div>
      <div class="field"><label>${t("jMinutes")}</label><div class="chips">${[15, 30, 45, 60, 90].map((m) => `<button class="chip pick ${m === f.minutes ? "cool" : ""}" data-m="${m}">${m} ${t("min")}</button>`).join("")}</div>
        <span class="muted" style="font-size:13px">≈ ${Math.min(30, Math.max(5, Math.round(f.minutes / 1.5)))} ${t("qs")} ${t("perDay")}</span></div>
      <div class="field"><label>${t("jDays")}</label><div class="chips">${[3, 4, 5, 6, 7].map((d) => `<button class="chip pick ${d === f.days ? "cool" : ""}" data-d="${d}">${d}</button>`).join("")}</div></div>
      <div class="field"><label>${t("jWeak")}</label><div class="chips">${topics.map((k) => `<button class="chip pick ${f.weak.includes(k) ? "cool" : ""}" data-w="${esc(k)}">${esc(topicName(k, st.lang))}</button>`).join("")}</div>
        <span class="muted" style="font-size:13px">${t("jWeakD")}</span></div>
      <div class="err" id="er" hidden></div>
      <button class="primary" id="ps">${st.plan ? t("jSave") : t("jCreate")} ${fwd()}</button>
    </div>`, { wide: true });
    $("bk").onclick = () => back();
    $("pe").onchange = () => (f.exam = $("pe").value);
    app.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { f.minutes = +b.dataset.m; draw(); }));
    app.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => { f.days = +b.dataset.d; draw(); }));
    app.querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => { const k = b.dataset.w; f.weak = f.weak.includes(k) ? f.weak.filter((x) => x !== k) : [...f.weak, k]; draw(); }));
    $("ps").onclick = async () => {
      f.exam = $("pe").value;
      const err = (m) => { $("er").textContent = m; $("er").hidden = false; };
      if (!f.exam || f.exam < today()) return err(t("jBadDate"));
      $("ps").disabled = true;
      try {
        st.plan = await api.savePlan(TR(), f.exam, f.minutes, f.days, f.weak);
        st.profile.exam_date = f.exam; st.mission = null;
        journey();
      } catch (e) { $("ps").disabled = false; err(/bad exam date/.test(e?.message || "") ? t("jBadDate") : errMsg(e)); }
    };
  };
  draw();
}

async function journey() {
  S = { screen: journey, back: route };
  frame(`<h2 class="page-h">${t("jTitle")}</h2><div class="loading"><div class="spin"></div></div>`, { wide: true });
  let p, mission, mdays, act, tstats, exams, due;
  try {
    p = st.plan || (await api.getPlan(st.user.id, TR()));
    if (!p) return planSetup();
    st.plan = p;
    [mission, mdays, act, tstats, exams, due] = await Promise.all([
      api.dailyMission(TR()).catch(() => null), api.missionDays(st.user.id, TR(), 120), api.activity(st.user.id, TR(), 56),
      api.topicStats(TR()).catch(() => []), api.myExams(st.user.id, TR()).catch(() => []), api.dueReviews(st.user.id, TR(), 50).catch(() => []),
    ]);
  } catch (e) {
    frame(`<h2 class="page-h">${t("jTitle")}</h2><div class="card"><p>${esc(errMsg(e))}</p><button class="primary" id="rt">${t("retry")}</button><button class="ghost" id="hm">${t("home")}</button></div>`, { wide: true });
    $("rt").onclick = journey; $("hm").onclick = route; return;
  }
  if (S?.screen !== journey) return;
  st.mission = mission; st.missionDays = mdays;
  const left = Math.max(0, daysBetween(today(), p.exam_date)), phase = planPhase(left), prog = planProgress(p, mdays);
  const td = planDay(p, today());
  const doneDays = new Set(mdays.filter((m) => m.status === "done").map((m) => m.day));
  const mockDone = new Set(exams.filter((x) => x.status === "done" && x.finished_at).map((x) => localDay(x.finished_at)));
  const studied = new Set(act.filter((r) => r.n > 0).map((r) => r.day));
  const missed = !studied.has(today()) && !studied.has(addDays(today(), -1)) && !studied.has(addDays(today(), -2)) && daysBetween(localDay(p.created_at), today()) >= 2;
  // topics: mastered / to improve / not started yet
  const by = Object.fromEntries((tstats || []).map((r) => [r.topic, r]));
  const rows = Object.keys(st.counts).sort().map((k) => { const r = by[k] || { answered: 0, correct: 0 }; return { k, a: r.answered, c: r.correct, acc: r.answered ? r.correct / r.answered : 0 }; });
  const mastered = rows.filter((r) => r.a >= 5 && r.acc >= 0.8);
  const improve = rows.filter((r) => (r.a >= 3 && r.acc < 0.65) || (r.a < 3 && (p.weak_topics || []).includes(r.k)));
  const week = [...Array(7)].map((_, i) => planDay(p, addDays(today(), i))).filter((d) => d.type !== "after");
  const dayName = (d) => new Date(d + "T12:00:00").toLocaleDateString(st.lang === "he" ? "he-IL" : "en-GB", { weekday: "short" });
  const mDone = mission?.status === "done", mStarted = (mission?.picked || []).some((v) => v != null);
  const chip = (x) => x.type === "rest" ? `<span class="wk rest">☕ ${t("jRest")}</span>` : x.type === "exam" ? `<span class="wk exam">🎓 ${t("jExamDay")}</span>`
    : `${x.type === "light" ? `<span class="wk">🔁 ${t("jLight")}</span>` : `<span class="wk">📝 ${x.mission} ${t("qs")}</span>`}${x.mock ? `<span class="wk mock">⏱ ${t("mock")} ${x.mock}</span>` : ""}`;
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("home")}">${bwd()}</button><h2 style="flex:1">${t("jTitle")}</h2><button class="ghost slim" id="ped">${t("jEdit")}</button></div>
  <div class="jhero">
    <div class="jcount"><b>${left}</b><span>${left === 0 ? t("jExamDay") : t("daysLeft")}</span><small>${fmtDate(p.exam_date + "T12:00:00")}</small></div>
    <div class="jprog">${ringSvg(prog.pct, 96)}<span>${t("jPlanDone")}</span><small class="muted">${prog.done}/${prog.expected} ${t("jSessions")}</small></div>
  </div>
  <div class="banner jphase">${t("jPhase_" + phase)}</div>
  ${missed ? `<div class="banner">${t("jMissed")}</div>` : ""}
  <div class="section-title">${t("jToday")}</div>
  <div class="card jtoday">
    ${td.type === "rest" ? `<p>☕ ${t("jRestToday")}</p>` : td.type === "exam" ? `<p>🎓 ${t("jGood")}</p>` : ""}
    ${mission ? `<div class="jtask ${mDone ? "ok" : ""}"><span>${mDone ? "✓" : "📝"} ${t("mission")} · ${mission.ids.length} ${t("qs")}</span><button class="${mDone ? "ghost" : "primary"} slim" id="jm">${mDone ? t("seeResults") : mStarted ? t("contMission") : t("startMission")}</button></div>` : ""}
    ${td.mock ? `<div class="jtask ${mockDone.has(today()) ? "ok" : ""}"><span>${mockDone.has(today()) ? "✓" : "⏱"} ${t("mock")} · ${td.mock} ${t("qs")}</span>${mockDone.has(today()) ? "" : `<button class="ghost slim" id="jx">${t("mockStart")}</button>`}</div>` : ""}
    ${due.length ? `<div class="jtask"><span>🔁 ${due.length} ${t("jDue")}</span><button class="ghost slim" id="jr">${t("smart")}</button></div>` : ""}
  </div>
  <div class="section-title">${t("jWeek")}</div>
  <div class="card jweek">${week.map((x) => `<div class="wrow ${x.date === today() ? "now" : ""}"><span class="wd"><b>${dayName(x.date)}</b><small>${x.date.slice(8)}.${x.date.slice(5, 7)}</small></span><span class="wc">${chip(x)}</span><span class="wst">${doneDays.has(x.date) ? "✓" : ""}</span></div>`).join("")}</div>
  <div class="jtopics">
    <div class="card"><h3>✅ ${t("jMastered")}</h3>${mastered.length ? `<div class="chips">${mastered.map((r) => `<span class="chip ok">${esc(topicName(r.k, st.lang))} ${Math.round(r.acc * 100)}%</span>`).join("")}</div>` : `<p class="muted">${t("jNoneYet")}</p>`}</div>
    <div class="card"><h3>🎯 ${t("jImprove")}</h3>${improve.length ? `<div class="chips">${improve.map((r) => `<button class="chip pick warm" data-tp="${esc(r.k)}">${esc(topicName(r.k, st.lang))}${r.a ? ` ${Math.round(r.acc * 100)}%` : ""}</button>`).join("")}</div>` : `<p class="muted">${t("jNoImprove")}</p>`}</div>
  </div>
  <div class="card"><div class="card-h"><h3>${t("trendL")}</h3><span class="muted">${t("jWeeks")}</span></div>${trendChart(weeklyAccuracy(act))}</div>
  <p class="muted" style="font-size:12px;text-align:center">${t("jNote")}</p>`, { wide: true });
  $("bk").onclick = route; $("ped").onclick = () => planSetup(journey);
  if ($("jm")) $("jm").onclick = () => (mDone ? missionFinish() : missionRun(mission));
  if ($("jx")) $("jx").onclick = () => planMock(td.mock);
  if ($("jr")) $("jr").onclick = smartReview;
  app.querySelectorAll("[data-tp]").forEach((b) => (b.onclick = () => practice({ kind: "topic", topic: b.dataset.tp })));
}
async function planMock(n) {
  loading();
  try {
    const ids = await api.examIds(TR(), n, [], "all");
    if (!ids.length) throw new Error(t("noneMatch"));
    const limit = ids.length * EXAM_SECONDS_PER_Q;
    const row = await api.createExam({ track: TR(), settings: { timed: true, guided: false, topics: [], pool: "all", plan: true, deadline: new Date(Date.now() + limit * 1000).toISOString() }, ids, picked: ids.map(() => null), time_limit: limit });
    runExam(row);
  } catch (e) { frame(`<div class="card"><p>${esc(errMsg(e))}</p><button class="ghost" id="hm">${t("back")}</button></div>`); $("hm").onclick = journey; }
}

/* ---------------- nursing league, daily challenge, friend challenges ---------------- */
const TIER = { 1: ["🥉", "tier1"], 2: ["🥈", "tier2"], 3: ["🥇", "tier3"], 4: ["💎", "tier4"] };
const tierName = (n) => `${TIER[n]?.[0] || ""} ${t(TIER[n]?.[1] || "tier1")}`;
function xpToast(n) {
  if (!n) return;
  const el = document.createElement("div");
  el.className = "xptoast"; el.setAttribute("role", "status"); el.textContent = `+${n} XP`;
  document.body.appendChild(el); setTimeout(() => el.remove(), 2200);
}
function timeLeft(endIso) {
  const ms = Math.max(0, new Date(endIso) - Date.now()), d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return d ? `${d} ${t("dShort")} ${h} ${t("hShort")}` : `${h} ${t("hShort")} ${m} ${t("mShort")}`;
}
function zones(L) {
  const n = (L.board || []).length;
  return { n, up: L.group_tier < 4 ? Math.ceil(n * 0.2) : 0, down: L.group_tier > 1 && n >= 5 ? Math.floor(n * 0.2) : 0 };
}
async function fillLeague() {
  const w = $("leaguew"); if (!w) return;
  let L, C;
  try { [L, C] = await Promise.all([api.getLeague(TR()), api.dailyChallenge(TR()).catch(() => null)]); }
  catch { w.innerHTML = ""; return; } // database not updated yet: hide
  if (S?.screen !== home || !$("leaguew")) return;
  const chDone = C ? (C.answers || []).length : 0, chN = C ? (C.ids || []).length : 0;
  if (!L.member) {
    $("leaguew").innerHTML = `<button class="jcta" id="lgo"><span class="jicon" aria-hidden="true">🏆</span><span><b>${t("league")}</b><small>${t("leagueJoinD")}</small></span><span aria-hidden="true">${fwd()}</span></button>`;
  } else {
    const me = (L.board || []).findIndex((x) => x.me) + 1;
    $("leaguew").innerHTML = `<button class="jcta" id="lgo"><span class="jdays lg"><b>#${me || "–"}</b><small>${t("rank")}</small></span>
      <span><b>${tierName(L.group_tier)}</b><small>${(L.board || []).find((x) => x.me)?.xp || 0} XP · ${t("weekEnds")} ${timeLeft(L.week_end)}</small>
      ${chN ? `<small>⚡ ${t("dailyCh")}: ${chDone}/${chN}</small>` : ""}</span><span aria-hidden="true">${fwd()}</span></button>`;
  }
  $("lgo").onclick = () => league();
}

async function league() {
  S = { screen: league, back: route };
  frame(`<h2 class="page-h">${t("league")}</h2><div class="loading"><div class="spin"></div></div>`, { wide: true });
  let L, C;
  try { [L, C] = await Promise.all([api.getLeague(TR()), api.dailyChallenge(TR()).catch(() => null)]); }
  catch (e) {
    frame(`<h2 class="page-h">${t("league")}</h2><div class="card"><p>${esc(errMsg(e))}</p><button class="primary" id="rt">${t("retry")}</button><button class="ghost" id="hm">${t("home")}</button></div>`, { wide: true });
    $("rt").onclick = league; $("hm").onclick = route; return;
  }
  if (S?.screen !== league) return;
  if (L.member && L.last) return leagueResult(L.last);
  const s = L.settings || {};
  const rules = `<ul class="rules"><li>📝 ${t("xpMission")}: <b>${s.xp_mission} XP</b></li><li>⚡ ${t("xpChallenge")}: <b>${s.xp_challenge} XP</b></li><li>🔁 ${t("xpReview")}: <b>${s.xp_review} XP</b></li><li>⏱ ${t("xpMock")} (${s.mock_min_q}+ ${t("qs")}): <b>${s.xp_mock} XP</b></li></ul>
    <p class="muted" style="font-size:13px">${t("xpCap")}: ${s.daily_cap} XP · ${t("xpNoRepeat")}</p>`;
  if (!L.member) {
    frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("home")}">${bwd()}</button><h2 style="flex:1">${t("league")}</h2></div>
    <div class="card lg-intro"><div class="big-emoji" aria-hidden="true">🏆</div><h2>${t("leagueIntro")}</h2><p class="muted">${t("leagueIntroD")}</p>${rules}
      <div class="field"><label for="nk">${t("nick")}</label><input id="nk" maxlength="20" value="${esc(L.nickname || "")}" placeholder="${t("nickPh")}" autocomplete="off"></div>
      <p class="muted" style="font-size:13px">🔒 ${t("nickPrivacy")}</p>
      <div class="err" id="er" hidden></div>
      <button class="primary" id="jn">${t("joinLeague")}</button></div>
    ${friendCard()}`, { wide: true });
    $("bk").onclick = route;
    $("jn").onclick = async () => {
      const nick = $("nk").value.trim();
      if (nick.length < 2 || /[@<>]/.test(nick)) { $("er").textContent = t("nickBad"); $("er").hidden = false; return; }
      $("jn").disabled = true;
      try { await api.leagueJoin(TR(), nick); league(); } catch (e) { $("jn").disabled = false; $("er").textContent = /nickname/.test(e?.message || "") ? t("nickBad") : errMsg(e); $("er").hidden = false; }
    };
    bindFriend(); return;
  }
  const z = zones(L), board = L.board || [], meI = board.findIndex((x) => x.me), myXp = board[meI]?.xp || 0;
  const target = z.up && meI >= z.up ? board[z.up - 1].xp - myXp + 1 : 0;
  const chDone = C ? (C.answers || []).length : 0, chN = C ? (C.ids || []).length : 0, chRight = C ? (C.answers || []).filter((a) => a.correct).length : 0;
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("home")}">${bwd()}</button><h2 style="flex:1">${t("league")}</h2></div>
  <div class="lg-hero">
    <div class="lg-tier"><span class="lg-emoji" aria-hidden="true">${TIER[L.group_tier][0]}</span><b>${t(TIER[L.group_tier][1])}</b><small>${esc(L.nickname)}</small></div>
    <div class="lg-stats"><div><b>#${meI + 1}</b><span>${t("of")} ${z.n}</span></div><div><b>${myXp}</b><span>XP ${t("thisWeek")}</span></div></div>
    <div class="lg-timer">⏳ ${t("weekEnds")} <b id="lgt">${timeLeft(L.week_end)}</b></div>
    <div class="lg-today"><span>${t("todayXp")}: ${L.today_xp}/${s.daily_cap}</span><div class="gbar"><i style="width:${pctOf(L.today_xp, s.daily_cap)}%"></i></div></div>
  </div>
  <div class="banner jphase">${L.group_tier >= 4 ? t("topTier") : meI < z.up ? `⬆️ ${t("inUpZone")} ${tierName(L.group_tier + 1)}` : `${t("toNext")}${tierName(L.group_tier + 1)}: ${t("beTop")} ${z.up} ${t("firstN")}${target ? ` · ${t("need")} <bdi>${target} XP</bdi>` : ""}`}</div>
  ${chN ? `<div class="card ch-card"><div class="card-h"><h3>⚡ ${t("dailyCh")}</h3><span class="muted">${chDone}/${chN}</span></div>
    <p class="muted">${chDone >= chN ? `${t("chDone")} ${chRight}/${chN}` : t("dailyChD")}</p>
    ${chDone >= chN ? "" : `<button class="primary" id="chg">${chDone ? t("contMission") : t("chStart")}</button>`}</div>` : ""}
  <div class="section-title">${t("board")}</div>
  <div class="card board">${board.map((x, i) => `<div class="brow ${x.me ? "me" : ""} ${i < z.up ? "up" : ""} ${z.down && i >= z.n - z.down ? "down" : ""}"><span class="brk">${i + 1}</span><span class="bnk">${esc(x.nick)}${x.me ? ` <small>(${t("you")})</small>` : ""}</span><span class="bxp"><bdi>${x.xp} XP</bdi></span></div>`).join("")}
    <p class="muted" style="font-size:12px">${z.up ? `🟢 ${t("upZone")}` : ""} ${z.down ? `· 🔴 ${t("downZone")}` : ""}</p></div>
  ${friendCard()}
  <div class="card"><h3>${t("howXp")}</h3>${rules}</div>
  <div class="small-links"><button class="link" id="lnk">${t("changeNick")}</button><button class="link" id="llv">${st.ui.leaveArmed ? t("leaveSure") : t("leaveLeague")}</button></div>`, { wide: true });
  $("bk").onclick = route;
  if ($("chg")) $("chg").onclick = () => challengeRun(C);
  const tick = setInterval(() => { if (S?.screen !== league || !$("lgt")) return clearInterval(tick); $("lgt").textContent = timeLeft(L.week_end); }, 30000);
  $("lnk").onclick = () => { const v = prompt(t("nick"), L.nickname); if (v && v.trim().length >= 2) api.leagueJoin(TR(), v.trim()).then(league).catch((e) => alert(errMsg(e))); };
  $("llv").onclick = async () => { if (!st.ui.leaveArmed) { st.ui.leaveArmed = true; return league(); } st.ui.leaveArmed = false; await api.leagueLeave(TR()).catch(() => {}); league(); };
  bindFriend();
}
function leagueResult(last) {
  S = { screen: () => leagueResult(last), back: route };
  const up = last.result === "up", down = last.result === "down";
  const newTier = Math.min(4, Math.max(1, last.tier + (up ? 1 : down ? -1 : 0)));
  frame(`<div class="card score celebrate">
    <div class="big-emoji" aria-hidden="true">${up ? "🎉" : down ? "💪" : "👏"}</div>
    <h2>${t("weekOver")}</h2>
    <p>${t("youFinished")} <b>#${last.rank}</b> ${t("of")} ${last.size} · ${last.xp} XP</p>
    <p class="lg-res ${up ? "okc" : down ? "badc" : ""}">${up ? t("resUp") : down ? t("resDown") : t("resStay")} <b>${tierName(newTier)}</b></p>
    <button class="primary" id="ok">${t("newWeek")} ${fwd()}</button></div>`);
  $("ok").onclick = async () => { await api.leagueSeen(last.group).catch(() => {}); league(); };
}

/* daily challenge: same 5 questions for everyone today, one try each */
async function challengeRun(C) {
  loading();
  try {
    const items = await api.questionsByIds(TR(), C.ids);
    const done = new Map((C.answers || []).map((a) => [a.idx - 1, a]));
    const slots = C.ids.map((id, i) => ({ q: items.find((q) => q.id === id), i, pick: done.get(i)?.pick ?? null, ok: done.get(i)?.correct })).filter((x) => x.q);
    S = { mode: "challenge", slots, at: Math.max(0, slots.findIndex((x) => x.pick == null)), xp: 0, back: league };
    challengeQ();
  } catch (e) { frame(`<div class="card"><p>${esc(errMsg(e))}</p><button class="ghost" id="hm">${t("back")}</button></div>`); $("hm").onclick = league; }
}
function challengeQ() {
  S.screen = challengeQ;
  const sl = S.slots[S.at], q = sl.q, tot = S.slots.length, answered = S.slots.filter((x) => x.pick != null).length;
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><div class="progress"><i style="width:${pctOf(answered, tot)}%"></i></div><span class="timer">⚡ ${answered}/${tot}</span></div>
  <div class="card">${qBody(q, S.at + 1, tot)}
    <div class="opts">${q[st.lang].o.map((o, k) => `<button class="opt" data-k="${k}"><span class="l">${LET[st.lang][k]}</span><span>${esc(o)}</span></button>`).join("")}</div>
    <div class="err" id="er" hidden></div><div id="fb"></div></div>`, { protect: true });
  $("bk").onclick = league; bindMark(q);
  const after = () => {
    const next = S.slots.findIndex((x) => x.pick == null);
    $("fb").insertAdjacentHTML("beforeend", `<button class="primary" id="nx" style="margin-top:12px">${next < 0 ? t("seeResults") : t("next") + " " + fwd()}</button>`);
    $("nx").onclick = () => { if (next < 0) challengeDone(); else { S.at = next; challengeQ(); } };
  };
  if (sl.pick != null) { $("fb").innerHTML = reveal(q, sl.pick); return after(); }
  app.querySelectorAll(".opt").forEach((b) => (b.onclick = async () => {
    const k = +b.dataset.k; app.querySelectorAll(".opt").forEach((x) => (x.disabled = true));
    try {
      const r = await api.challengeAnswer(TR(), sl.i, k);
      sl.pick = k; sl.ok = r.correct; S.xp += r.xp || 0; st.answers.set(q.id, !!r.correct); xpToast(r.xp);
      $("fb").innerHTML = reveal(q, k); after();
    } catch (e) { app.querySelectorAll(".opt").forEach((x) => (x.disabled = false)); $("er").textContent = errMsg(e); $("er").hidden = false; }
  }));
}
function challengeDone() {
  const tot = S.slots.length, right = S.slots.filter((x) => x.ok).length, xp = S.xp;
  S = { screen: challengeDone, back: league };
  frame(`<div class="card score celebrate"><div class="big-emoji" aria-hidden="true">⚡</div><h2>${t("chDone")} ${right}/${tot}</h2>
    ${xp ? `<p class="okc"><b>+${xp} XP</b></p>` : ""}<p class="muted">${t("chTomorrow")}</p>
    <button class="primary" id="ok">${t("league")}</button></div>`);
  $("ok").onclick = league;
}

/* friend challenges: share a code, both answer the same questions; accuracy first, then time */
const friendCodes = () => store.get(`friend-codes:${st.user.id}`) || [];
function rememberCode(c) { store.set(`friend-codes:${st.user.id}`, [c, ...friendCodes().filter((x) => x !== c)].slice(0, 5)); }
function friendCard() {
  const codes = friendCodes();
  return `<div class="card"><h3>🤝 ${t("friendT")}</h3><p class="muted">${t("friendD")}</p>
    <button class="primary" id="fcr">${t("friendNew")}</button>
    <div class="row2"><input id="fcc" maxlength="8" placeholder="${t("codePh")}" autocapitalize="characters" dir="ltr" aria-label="${t("codePh")}"><button class="ghost slim" id="fcj">${t("join")}</button></div>
    <div class="err" id="fer" hidden></div>
    ${codes.length ? `<div class="chips">${codes.map((c) => `<button class="chip pick" data-fc="${esc(c)}"><bdi dir="ltr">${esc(c)}</bdi></button>`).join("")}</div>` : ""}</div>`;
}
function bindFriend() {
  const err = (m) => { $("fer").textContent = m; $("fer").hidden = false; };
  $("fcr").onclick = async () => {
    $("fcr").disabled = true;
    try { const code = await api.createFriend(TR()); rememberCode(code); friendReady(code); }
    catch (e) { $("fcr").disabled = false; err(/too many/.test(e?.message || "") ? t("tooMany") : errMsg(e)); }
  };
  $("fcj").onclick = () => { const c = $("fcc").value.trim().toUpperCase(); if (c.length < 4) return err(t("codeBad")); friendStart(c, friendNick()); };
  app.querySelectorAll("[data-fc]").forEach((b) => (b.onclick = () => friendStart(b.dataset.fc, friendNick())));
}
function friendReady(code) {
  S = { screen: () => friendReady(code), back: league };
  const link = `${api.appUrl}?c=${code}`, text = `${t("shareText")} ${code}\n${link}`;
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><h2 style="flex:1">${t("friendT")}</h2></div>
  <div class="card score"><p class="muted">${t("codeIs")}</p><div class="bigcode" dir="ltr">${code}</div>
    <button class="primary" id="sh">📤 ${t("share")}</button><span class="okline" id="cp" hidden>${t("copied")}</span>
    <button class="ghost" id="go">${t("startMine")} ${fwd()}</button></div>`);
  $("bk").onclick = league;
  $("sh").onclick = async () => {
    try { if (navigator.share) return await navigator.share({ text }); } catch { return; }
    try { await navigator.clipboard.writeText(text); $("cp").hidden = false; } catch { prompt(t("share"), text); }
  };
  $("go").onclick = () => friendStart(code, friendNick());
}
async function friendStart(code, nick) {
  loading();
  try {
    const fc = await api.startFriend(code, nick);
    rememberCode(fc.code);
    if (fc.finished) return friendBoard(fc.code, fc.board);
    const items = await api.questionsByIds(fc.track, fc.ids);
    const slots = fc.ids.map((id, i) => ({ q: items.find((q) => q.id === id), i, pick: fc.picked?.[i] ?? null })).filter((x) => x.q);
    S = { mode: "friend", code: fc.code, slots, at: Math.max(0, slots.findIndex((x) => x.pick == null)), start: Date.now(), tick: null, back: league };
    friendQ();
  } catch (e) {
    const m = /not found/.test(e?.message || "") ? t("codeBad") : /full/.test(e?.message || "") ? t("chFull") : errMsg(e);
    frame(`<div class="card"><p>${esc(m)}</p><button class="ghost" id="hm">${t("back")}</button></div>`); $("hm").onclick = league;
  }
}
function friendQ() {
  S.screen = friendQ;
  const sl = S.slots[S.at], q = sl.q, tot = S.slots.length, answered = S.slots.filter((x) => x.pick != null).length;
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><div class="progress"><i style="width:${pctOf(answered, tot)}%"></i></div><span class="timer" id="tm">00:00</span></div>
  <div class="card">${qBody(q, S.at + 1, tot)}
    <div class="opts">${q[st.lang].o.map((o, k) => `<button class="opt" data-k="${k}"><span class="l">${LET[st.lang][k]}</span><span>${esc(o)}</span></button>`).join("")}</div>
    <div class="err" id="er" hidden></div><div id="fb"></div></div>`, { protect: true });
  const el = $("tm"), upd = () => clock(el, Math.floor((Date.now() - S.start) / 1000)); upd(); S.tick = setInterval(upd, 1000);
  $("bk").onclick = league; bindMark(q);
  const after = () => {
    const next = S.slots.findIndex((x) => x.pick == null);
    $("fb").insertAdjacentHTML("beforeend", `<button class="primary" id="nx" style="margin-top:12px">${next < 0 ? t("seeResults") : t("next") + " " + fwd()}</button>`);
    $("nx").onclick = async () => {
      if (next >= 0) { S.at = next; return friendQ(); }
      const code = S.code; loading();
      try { friendBoard(code, await api.finishFriend(code)); } catch (e) { frame(`<div class="card"><p>${esc(errMsg(e))}</p></div>`); }
    };
  };
  if (sl.pick != null) { $("fb").innerHTML = reveal(q, sl.pick); return after(); }
  app.querySelectorAll(".opt").forEach((b) => (b.onclick = async () => {
    const k = +b.dataset.k; app.querySelectorAll(".opt").forEach((x) => (x.disabled = true));
    try { const ok = await api.friendAnswer(S.code, sl.i, k); sl.pick = k; st.answers.set(q.id, !!ok); $("fb").innerHTML = reveal(q, k); after(); }
    catch (e) { app.querySelectorAll(".opt").forEach((x) => (x.disabled = false)); $("er").textContent = errMsg(e); $("er").hidden = false; }
  }));
}
function friendBoard(code, board) {
  S = { screen: () => friendBoard(code, board), back: league };
  const fin = (board || []).filter((x) => x.finished), winner = fin[0];
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><h2 style="flex:1">${t("friendT")} <bdi dir="ltr">${esc(code)}</bdi></h2></div>
  <div class="card score celebrate"><div class="big-emoji" aria-hidden="true">${winner?.me ? "🏆" : "🤝"}</div><h2>${winner ? (winner.me ? t("youWon") : `${esc(winner.nick)} ${t("leads")}`) : t("waiting")}</h2>
    <p class="muted">${t("rule")}</p></div>
  <div class="card board">${(board || []).map((x, i) => `<div class="brow ${x.me ? "me" : ""}"><span class="brk">${x.finished ? i + 1 : "…"}</span><span class="bnk">${esc(x.nick)}${x.me ? ` <small>(${t("you")})</small>` : ""}</span><span class="bxp">${x.finished ? `${x.correct} ✓ · ${clockText(x.seconds)}` : t("playing")}</span></div>`).join("")}</div>
  <div class="actions"><button class="primary" id="rf2">${t("refresh")}</button><button class="ghost" id="lg">${t("league")}</button></div>`);
  $("bk").onclick = league; $("lg").onclick = league;
  $("rf2").onclick = () => friendStart(code);
}
const clockText = (s) => `${String(Math.floor((s || 0) / 60)).padStart(2, "0")}:${String((s || 0) % 60).padStart(2, "0")}`;
function friendNick() {
  let n = store.get(`friend-nick:${st.user.id}`);
  if (!n) { n = (prompt(t("friendNick")) || "").trim().slice(0, 20); if (n) store.set(`friend-nick:${st.user.id}`, n); }
  return n || null;
}


/* ---------------- first-time intro (short, can be skipped) ---------------- */
function intro(i = 0) {
  const steps = [["🎯", "in1T", "in1D"], ["📝", "in2T", "in2D"], ["🔁", "in3T", "in3D"], ["📊", "in4T", "in4D"]];
  const done = () => { store.set(`intro:${st.user.id}`, 1); home(); };
  S = { screen: () => intro(i), back: done };
  const [em, h, d] = steps[i], last = i === steps.length - 1;
  frame(`<div class="card intro">
    <div class="big-emoji" aria-hidden="true">${em}</div><h2>${t(h)}</h2><p class="muted">${t(d)}</p>
    <div class="dots" aria-hidden="true">${steps.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("")}</div>
    <button class="primary" id="in">${last ? t("inGo") : t("next") + " " + fwd()}</button>
    ${last ? "" : `<button class="link" id="sk">${t("skip")}</button>`}
  </div>`);
  $("in").onclick = () => (last ? done() : intro(i + 1));
  if ($("sk")) $("sk").onclick = done;
}

/* ---------------- daily goal + streak ---------------- */
const goalKey = () => `goal:${st.user.id}`;
const goalOf = () => store.get(goalKey()) || 20;
function goalCard(rows) {
  const g = goalOf(), td = (rows || []).find((r) => r.day === today())?.n || 0, s = streakOf(rows), p = Math.min(100, pctOf(td, g));
  const dl = daysLeft(), left = Math.max(0, totals().n - totals().done);
  return `<div class="goalc">
    <div class="goal-row"><div><span class="eyebrow">${t("goal")}</span><div class="bignum"><b>${td}</b><span>/</span><b>${g}</b></div><span class="muted">${t("goalOf")}</span></div>
      <div class="streak"><span class="fire" aria-hidden="true">🔥</span><b>${s}</b><span>${t("streak")}</span></div></div>
    <div class="gbar"><i style="width:${p}%"></i></div>
    ${td >= g ? `<span class="okline">${t("goalDone")}</span>` : ""}
    ${dl ? `<span class="muted" style="font-size:13px">${t("pace")} <b>${Math.ceil(left / Math.max(1, dl))}</b> ${t("qs")} ${t("perDay")}</span>` : ""}
    <div class="chips">${[10, 20, 30, 50, 100].map((n) => `<button class="chip pick ${n === g ? "cool" : ""}" data-goal="${n}">${n}</button>`).join("")}</div>
  </div>`;
}
function bindGoal(rows) {
  app.querySelectorAll("[data-goal]").forEach((b) => (b.onclick = () => { store.set(goalKey(), +b.dataset.goal); if ($("goalw")) { $("goalw").innerHTML = goalCard(rows); bindGoal(rows); } }));
}

/* ---------------- smart review ---------------- */
async function smartReview() {
  loading();
  try {
    const due = await api.dueReviews(st.user.id, TR(), BATCH);
    if (due.length) return practice({ kind: "ids", ids: due.map((r) => r.question_id), smart: true });
  } catch { /* older database: fall back to answer history */ }
  let hist = [];
  try { hist = await api.answerHistory(st.user.id, TR()); } catch (e) { flash(errMsg(e), true); return route(); }
  const now = Date.now(), H = 36e5, age = (r) => now - new Date(r.answered_at).getTime();
  const oldest = (a, b) => new Date(a.answered_at) - new Date(b.answered_at);
  const wrong = hist.filter((r) => !r.correct && age(r) > H).sort(oldest);
  const shaky = hist.filter((r) => r.correct && r.first_correct === false && age(r) > 72 * H).sort(oldest);
  const ids = [...wrong, ...shaky].map((r) => r.question_id).slice(0, BATCH);
  if (!ids.length) {
    S = { screen: smartReview, back: route };
    frame(`<div class="card"><h2>${t("smart")}</h2><p class="muted">${t("smartNone")}</p><button class="ghost" id="hm">${t("home")}</button></div>`);
    $("hm").onclick = route; return;
  }
  practice({ kind: "ids", ids, smart: true });
}

/* ---------------- reference sheet (page + pop-up inside questions) ---------------- */
let refTab = "lab";
function refHtml() {
  const sec = REF.find((x) => x.id === refTab) || REF[0];
  return `<div class="chips">${REF.map((x) => `<button class="chip pick ${x.id === sec.id ? "cool" : ""}" data-ref="${x.id}">${x[st.lang]}</button>`).join("")}</div>
  <table class="reft"><tbody>${sec.rows.map((r) => `<tr><th>${esc(st.lang === "he" ? r[0] : r[1])}</th><td><bdi dir="ltr">${esc(r[2])}</bdi></td></tr>`).join("")}</tbody></table>
  <p class="muted" style="font-size:12px">${t("refNote")}</p>`;
}
function bindRef(root, redraw) {
  root.querySelectorAll("[data-ref]").forEach((b) => (b.onclick = () => { refTab = b.dataset.ref; redraw(); }));
}
function refPage(back = route) {
  S = { screen: () => refPage(back), back };
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><h2 style="flex:1">${t("refT")}</h2></div>
  <div class="card" id="refw">${refHtml()}</div>`, { wide: true });
  $("bk").onclick = () => back();
  bindRef(app, () => { $("refw").innerHTML = refHtml(); bindRef($("refw"), () => refPage(back)); });
}
function refSheet() {
  document.querySelector(".sheet")?.remove();
  const el = document.createElement("div");
  el.className = "sheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.dir = t("dir");
  const draw = () => {
    el.innerHTML = `<div class="sheet-in"><div class="sheet-h"><h2>${t("refT")}</h2><button class="ghost slim" id="rfx">${t("close")}</button></div>${refHtml()}</div>`;
    el.querySelector("#rfx").onclick = close; bindRef(el, draw);
  };
  const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  el.onclick = (e) => { if (e.target === el) close(); };
  document.addEventListener("keydown", onKey);
  draw(); document.body.appendChild(el);
  el.querySelector("#rfx").focus();
}

/* ---------------- dosage-calculation trainer ---------------- */
function calcTrainer(back = route, keep) {
  const C = keep || { q: calcQuestion(st.lang), picked: null, right: 0, total: 0 };
  S = { screen: () => calcTrainer(back, C), back };
  const q = C.q;
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><h2 style="flex:1">${t("calcT")}</h2><span class="timer">${t("score")} ${C.right}/${C.total}</span></div>
  <div class="card">
    <div class="qtools"><button class="tool" id="rf">📋 ${t("refT")}</button></div>
    <div class="qtext">${esc(q.q)}</div>
    <div class="opts">${q.o.map((o, k) => `<button class="opt" data-k="${k}"><span class="l">${LET[st.lang][k]}</span><span><bdi>${esc(o)}</bdi></span></button>`).join("")}</div>
    <div id="fb"></div>
  </div>`);
  $("bk").onclick = () => back(); $("rf").onclick = refSheet;
  const show = (k) => {
    app.querySelectorAll(".opt").forEach((b) => { const n = +b.dataset.k; b.disabled = true; if (n === q.answer) b.classList.add("right"); else if (n === k) b.classList.add("wrong"); });
    $("fb").innerHTML = `<div class="explain"><b>${k === q.answer ? t("correct") : t("wrong")}</b><div>${t("solution")}: <bdi dir="ltr">${esc(q.sol)}</bdi></div><div>${t("rightAns")}: <b><bdi>${esc(q.o[q.answer])}</bdi></b></div></div>
    <button class="primary" id="nq" style="margin-top:12px">${t("newQ")} ${fwd()}</button>`;
    $("nq").onclick = () => calcTrainer(back, { q: calcQuestion(st.lang), picked: null, right: C.right, total: C.total });
  };
  if (C.picked != null) show(C.picked);
  else app.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { C.picked = +b.dataset.k; C.total++; if (C.picked === q.answer) C.right++; show(C.picked); $("bk").closest(".qbar").querySelector(".timer").textContent = `${t("score")} ${C.right}/${C.total}`; }));
}

/* ---------------- question bank: search + topic + status filters (state kept while the app is open) ---------------- */
function searchPage(back = route) {
  const Q = st.bank || (st.bank = { term: "", topic: "", status: "all", res: null, more: false, err: null, busy: false });
  S = { screen: () => searchPage(back), back };
  const topics = Object.keys(st.counts).sort();
  const badge = (r) => `${r.status === "right" ? `<span class="sb ok">✓</span>` : r.status === "wrong" ? `<span class="sb bad">✗</span>` : `<span class="sb new">${t("stNew")}</span>`}${r.saved ? `<span class="sb">★</span>` : ""}`;
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><h2 style="flex:1">${t("bankT")}</h2></div>
  <form class="card bankf" id="sf" role="search">
    <div class="row2"><input id="sq" type="search" placeholder="${t("searchPh")}" value="${esc(Q.term)}" aria-label="${t("search")}" enterkeyhint="search"><button class="primary slim" type="submit">${t("search")}</button></div>
    <div class="row2"><select id="stp" aria-label="${t("topicsL")}"><option value="">${t("allTopics")}</option>${topics.map((k) => `<option value="${esc(k)}" ${Q.topic === k ? "selected" : ""}>${esc(topicName(k, st.lang))} (${st.counts[k]})</option>`).join("")}</select></div>
    <div class="chips">${[["all", "fAll"], ["new", "stNewF"], ["answered", "stAnswered"], ["wrong", "fWrong"], ["saved", "fSaved"]].map(([v, l]) => `<button type="button" class="chip pick ${Q.status === v ? "cool" : ""}" data-st="${v}">${t(l)}</button>`).join("")}</div>
  </form>
  ${Q.err ? `<div class="banner bad">${esc(Q.err)}</div>` : ""}
  ${Q.busy && !Q.res ? `<div class="loading"><div class="spin"></div></div>` : ""}
  ${Q.res && !Q.res.length ? `<div class="card empty"><p>🔎 ${t("noResults")}</p><p class="muted">${t("tryOther")}</p></div>` : ""}
  <div class="qlist protect">${(Q.res || []).map((r) => `<button class="qrow" data-q="${r.id}"><span class="qn">${badge(r)}<small>#${r.id}</small></span><span class="qq">${esc((st.lang === "he" ? r.q_he : r.q_en) || r.q_he)}</span><span class="qk"><small>${esc(topicName(r.topic, st.lang))}</small></span><span class="qv">${t("view")} ${fwd()}</span></button>`).join("")}</div>
  ${Q.more ? `<button class="ghost" id="more" ${Q.busy ? "disabled" : ""}>${t("loadMore")}</button>` : ""}`, { wide: true });
  $("bk").onclick = () => back();
  const PAGE = 30;
  const run = async (append) => {
    Q.busy = true; if (!append) { Q.res = null; } searchPage(back);
    try {
      const rows = await api.browseQuestions(TR(), { q: Q.term, topic: Q.topic, status: Q.status, offset: append ? Q.res.length : 0, limit: PAGE });
      Q.res = append ? [...Q.res, ...rows] : rows; Q.more = rows.length === PAGE; Q.err = null;
    } catch (x) {
      // older database: plain search only
      try { if (!Q.term || Q.term.length < 2) throw x; Q.res = (await api.searchQuestions(TR(), Q.term)).map((r) => ({ ...r, status: "new" })); Q.more = false; Q.err = null; }
      catch (y) { Q.res = Q.res || []; Q.err = /browse_questions|search_questions|function/i.test(y?.message || "") ? t("searchNeed") : errMsg(y); }
    }
    Q.busy = false; if (S?.screen && $("sf")) searchPage(back);
  };
  $("sf").onsubmit = (e) => { e.preventDefault(); Q.term = $("sq").value.trim(); run(false); };
  $("stp").onchange = () => { Q.topic = $("stp").value; Q.term = $("sq").value.trim(); run(false); };
  app.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => { Q.status = b.dataset.st; Q.term = $("sq").value.trim(); run(false); }));
  if ($("more")) $("more").onclick = () => run(true);
  app.querySelectorAll("[data-q]").forEach((b) => (b.onclick = async () => {
    const id = +b.dataset.q; loading();
    try { const [q] = await api.questionsByIds(TR(), [id]); if (q) return viewQuestion(q, null, () => searchPage(back)); } catch (x) { Q.err = errMsg(x); }
    searchPage(back);
  }));
  if (!Q.res && !Q.busy && !Q.err) run(false);
}

/* ---------------- practice ---------------- */
const BATCH = 20;
async function practice(src) {
  loading();
  try {
    let items;
    if (src.kind === "unanswered") {
      const ids = await api.unansweredIds(TR(), BATCH);
      items = ids.length ? await api.questionsByIds(TR(), ids) : [];
    } else if (src.kind === "ids") {
      if (!src.ids.length) { frame(`<div class="card"><p class="muted">${t("noItems")}</p><button class="ghost" id="hm">${t("home")}</button></div>`); $("hm").onclick = route; return; }
      items = await api.questionsByIds(TR(), src.ids.slice(0, BATCH));
    } else {
      const after = src.kind === "seq" ? (store.get(posKey()) || 0) : 0;
      items = await api.questions({ track: TR(), topic: src.topic || null, afterId: after, limit: BATCH });
      if (!items.length && after) { store.set(posKey(), 0); items = await api.questions({ track: TR(), limit: BATCH }); }
    }
    if (!items.length) { frame(`<div class="card"><p class="muted">${hasAccess() ? t("noItems") : t("locked")}</p><button class="ghost" id="hm">${t("home")}</button></div>`); $("hm").onclick = route; return; }
    keepTerms(items);
    S = { mode: "practice", src, items, i: 0, ans: [], picked: [], start: Date.now(), tick: null, back: route };
    question();
  } catch (e) {
    frame(`<div class="card"><p>${esc(errMsg(e))}</p><button class="primary" id="rt">${t("retry")}</button><button class="ghost" id="hm">${t("home")}</button></div>`);
    $("rt").onclick = () => practice(src); $("hm").onclick = route;
  }
}
function clock(el, secs) { el.textContent = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`; }
function qHead(num, tot) {
  return `<div class="qbar"><button class="back" id="bk" aria-label="${t("home")}">${bwd()}</button>
  <div class="progress"><i style="width:${((num - 1) / tot) * 100}%"></i></div><span class="timer" id="tm">00:00</span></div>`;
}
function qBody(q, num, tot) {
  const c = q[st.lang], on = st.marks.has(q.id);
  return `<div class="qmeta"><span class="tag">${esc(topicName(q.topic, st.lang))}</span><span>${t("q")} ${num} ${t("of")} ${tot}</span></div>
  <div class="qtools"><button class="tool ${on ? "on" : ""}" id="mk">${on ? "★ " + t("saved") : "☆ " + t("save")}</button>${S?.mode === "exam" && !S.guided ? "" : `<button class="tool" id="rf">📋 ${t("refT")}</button>`}</div>
  <div class="qtext">${esc(c.q)}</div>
  ${q.terms?.length ? `<div class="terms">${q.terms.map((x) => `<span class="term"><bdi>${esc(x[0])}</bdi> · <bdi>${esc(x[1])}</bdi></span>`).join("")}</div>` : ""}`;
}
function bindMark(q) {
  if ($("rf")) $("rf").onclick = refSheet;
  $("mk").onclick = () => {
    const on = !st.marks.has(q.id);
    if (on) st.marks.add(q.id); else st.marks.delete(q.id);
    $("mk").className = "tool" + (on ? " on" : ""); $("mk").textContent = on ? "★ " + t("saved") : "☆ " + t("save");
    api.setBookmark(st.user.id, TR(), q.id, on).catch(() => {});
  };
}
function question() {
  S.screen = question;
  const q = S.items[S.i], c = q[st.lang];
  frame(`${qHead(S.i + 1, S.items.length)}
  <div class="card">${qBody(q, S.i + 1, S.items.length)}
    <div class="opts">${c.o.map((o, k) => `<button class="opt" data-k="${k}"><span class="l">${LET[st.lang][k]}</span><span>${esc(o)}</span></button>`).join("")}</div>
    <div id="fb"></div>
  </div>`, { protect: true });
  const el = $("tm"), upd = () => clock(el, Math.floor((Date.now() - S.start) / 1000)); upd(); S.tick = setInterval(upd, 1000);
  $("bk").onclick = route; bindMark(q);
  app.querySelectorAll(".opt").forEach((b) => (b.onclick = () => pick(+b.dataset.k)));
  if (S.picked[S.i] != null) feedback(S.picked[S.i]);
}
function pick(k) {
  const q = S.items[S.i], ok = k === q.answer;
  S.picked[S.i] = k; S.ans[S.i] = ok; st.answers.set(q.id, ok);
  api.saveAnswer(st.user.id, TR(), q.id, k, ok).catch(() => {});
  if (S.src.kind === "seq") store.set(posKey(), q.id);
  feedback(k);
}
// Split an explanation into general text + a reason per option ("✓ ג – ..." / "✗ A – ...")
function parseExp(e, lang) {
  const per = {}, gen = [];
  String(e || "").split(/\n+/).forEach((line) => {
    const m = line.match(/^\s*([✓✔✗✘xX])\s*([A-Da-dא-ד])\s*[–—\-:.)]\s*(.+)$/);
    const k = m ? LET.en.indexOf(m[2].toUpperCase()) >= 0 ? LET.en.indexOf(m[2].toUpperCase()) : LET.he.indexOf(m[2]) : -1;
    if (k >= 0) per[k] = m[3].trim(); else if (line.trim()) gen.push(line.trim());
  });
  return { per, gen: gen.join("\n") };
}
// Mark the options right/wrong and write the reason under each one; returns the explanation box html
// highlight the question's medical terms inside an (already escaped) explanation
function markTerms(html, q) {
  const words = (q.terms || []).flat().filter((w) => w && w.length > 2).sort((a, b) => b.length - a.length);
  if (!words.length) return html;
  const re = new RegExp(`(${words.map((w) => esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return html.replace(re, '<mark class="term-hl">$1</mark>');
}
function reveal(q, k) {
  const c = q[st.lang], ok = k === q.answer, { per, gen } = parseExp(c.e, st.lang), L = LET[st.lang];
  app.querySelectorAll(".opt").forEach((b) => {
    const n = +b.dataset.k; b.disabled = true; b.classList.remove("sel");
    if (n === q.answer) b.classList.add("right"); else if (n === k) b.classList.add("wrong");
  });
  const why = per[q.answer] || "", others = [0, 1, 2, 3].filter((n) => n !== q.answer && per[n]);
  const hasAny = !!(why || gen || others.length);
  const fmt = (x) => markTerms(esc(x), q);
  return `<div class="explain">
    <b class="verdict ${ok ? "okc" : "badc"}">${ok ? t("correct") : k == null ? t("none") : t("wrong")}</b>
    <div class="exsec"><h4>${t("rightAns")}</h4><p><strong>${L[q.answer]} – ${esc(c.o[q.answer])}</strong></p></div>
    ${why || gen ? `<div class="exsec"><h4>${t("whyRight")}</h4>${why ? `<p>${fmt(why)}</p>` : ""}${gen ? `<p>${fmt(gen)}</p>` : ""}</div>` : ""}
    ${others.length ? `<div class="exsec"><h4>${t("whyWrong")}</h4><ul>${others.map((n) => `<li class="${n === k ? "picked" : ""}"><b>${L[n]}</b> – ${fmt(per[n])}</li>`).join("")}</ul></div>` : ""}
    ${hasAny ? "" : `<p class="muted">${t("noExp")}</p>`}
    <div class="ref"><strong>${t("source")}:</strong> <bdi dir="ltr">${esc(q.source)}</bdi></div></div>`;
}
function feedback(k) {
  const q = S.items[S.i], last = S.i === S.items.length - 1;
  $("fb").innerHTML = `${reveal(q, k)}
  <div class="qtools" style="margin-top:10px"><button class="tool" id="rp">⚑ ${t("report")}</button></div>
  <button class="primary" id="nx" style="margin-top:12px">${last ? t("result") : t("next")}</button>`;
  $("rp").onclick = () => { api.report(st.user.id, q.id).catch(() => {}); $("rp").textContent = t("reported"); $("rp").disabled = true; };
  $("nx").onclick = () => { if (last) result(); else { S.i++; question(); } };
  requestAnimationFrame(() => app.querySelector(".opts")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

/* ---------------- result ---------------- */
function result() {
  S.screen = result;
  if (S.src?.smart && !S.reviewClaimed) { S.reviewClaimed = true; api.completeReview(TR()).then(xpToast); }
  const n = S.items.length, c = S.ans.filter(Boolean).length, p = Math.round((c / n) * 100);
  const s = Math.min(Math.floor((Date.now() - S.start) / 1000), S.limit || 1e9);
  const by = {}; S.items.forEach((q, i) => { by[q.topic] = by[q.topic] || [0, 0]; by[q.topic][1]++; if (S.ans[i]) by[q.topic][0]++; });
  const R = 60, C = 2 * Math.PI * R, col = p >= 80 ? "var(--ok)" : p >= 60 ? "var(--amber)" : "var(--bad)";
  const isMock = false, canMore = S.mode === "practice" && S.src.kind !== "ids" && n === BATCH;
  frame(`<div class="card score">
    <svg class="ring" viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--line)" stroke-width="12"/>
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p / 100)}" transform="rotate(-90 70 70)"/>
      <text x="70" y="79" text-anchor="middle" font-size="30" font-weight="700" fill="var(--ink)" font-family="Rubik, sans-serif">${p}%</text></svg>
    <h2>${p >= 80 ? t("r80") : p >= 60 ? t("r60") : t("r0")}</h2>
    <p class="muted">${c} ${t("of")} ${n} ${t("ofCorrect")} · ${Math.floor(s / 60)} ${t("min")} ${s % 60} ${t("sec")}</p>
  </div>
  <div class="section-title">${t("strengths")}</div>
  <div class="card bars">${Object.entries(by).map(([k, [a, b]]) => { const r = a / b, cc = r >= 0.8 ? "var(--ok)" : r >= 0.5 ? "var(--amber)" : "var(--bad)"; return `<div class="bar-row"><div class="lbl"><span>${esc(topicName(k, st.lang))}</span><span>${a}/${b}</span></div><div class="bar"><i style="width:${r * 100}%;background:${cc}"></i></div></div>`; }).join("")}</div>
  ${isMock ? `<div class="section-title">${t("review")}</div><div class="review protect">${S.items.map((q, i) => { const pk = S.picked[i], ok = pk === q.answer, c2 = q[st.lang]; return `<div class="rv"><span class="st ${ok ? "okc" : "badc"}">${i + 1}. ${ok ? t("correct") : t("wrong")}</span><span>${esc(c2.q)}</span>${ok ? "" : `<span class="muted">${t("yourAns")}: ${pk == null ? t("none") : esc(c2.o[pk])}</span>`}<span class="muted">${t("rightAns")}: <b>${esc(c2.o[q.answer])}</b></span><span class="muted" style="white-space:pre-line">${esc(c2.e)}</span></div>`; }).join("")}</div>` : ""}
  <div class="actions">${canMore ? `<button class="primary" id="more">${t("cont2")}</button>` : `<button class="primary" id="ag">${t("again")}</button>`}<button class="ghost" id="hm">${t("home")}</button></div>`, { protect: isMock });
  if ($("more")) $("more").onclick = () => (S.src.kind === "seq" || S.src.kind === "unanswered" ? practice(S.src) : topicNext(S.src.topic, S.items.at(-1).id));
  if ($("ag")) $("ag").onclick = () => {
    Object.assign(S, { i: 0, ans: [], picked: [], start: Date.now() });
    question();
  };
  $("hm").onclick = route;
}
async function topicNext(topic, afterId) {
  loading();
  try {
    const items = await api.questions({ track: TR(), topic, afterId, limit: BATCH });
    if (!items.length) return practice({ kind: "topic", topic });
    keepTerms(items);
    S = { mode: "practice", src: { kind: "topic", topic }, items, i: 0, ans: [], picked: [], start: Date.now(), tick: null, back: route };
    question();
  } catch (e) { frame(`<div class="card"><p>${esc(errMsg(e))}</p><button class="ghost" id="hm">${t("home")}</button></div>`); $("hm").onclick = route; }
}

/* ---------------- term cards ---------------- */
function keepTerms(items) {
  const all = store.get("terms") || {};
  for (const q of items) for (const [en, he] of q.terms || []) all[en] = { en, he, t: q.topic };
  store.set("terms", all);
}
function cards() {
  S = { screen: cards, back: route };
  const list = Object.values(store.get("terms") || {});
  if (!list.length) { frame(`<div class="card"><h2>${t("flash")}</h2><p class="muted">${t("noItems")}</p><button class="ghost" id="hm">${t("home")}</button></div>`); $("hm").onclick = route; return; }
  const i = st.ui.flashI % list.length, c = list[i], other = st.lang === "he" ? "en" : "he";
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("home")}">${bwd()}</button><div class="progress"><i style="width:${((i + 1) / list.length) * 100}%"></i></div><span class="timer">${i + 1}/${list.length}</span></div>
  <h2>${t("flash")}</h2>
  <button class="flash ${st.ui.flashBack ? "back" : ""}" id="fc">
    <span class="tag">${esc(topicName(c.t, st.lang))}</span>
    <span class="big"><bdi>${esc(st.ui.flashBack ? c[other] : c[st.lang])}</bdi></span>
    <span class="hint">${st.ui.flashBack ? (other === "en" ? "English" : "עברית") : t("tap")}</span>
  </button>
  <div class="mocknav"><button class="ghost" id="pv">${bwd()} ${t("prev")}</button><button class="primary" id="nx">${fwd()}</button></div>`);
  $("bk").onclick = route;
  $("fc").onclick = () => { st.ui.flashBack = !st.ui.flashBack; cards(); };
  $("pv").onclick = () => { st.ui.flashI = (i - 1 + list.length) % list.length; st.ui.flashBack = false; cards(); };
  $("nx").onclick = () => { st.ui.flashI = (i + 1) % list.length; st.ui.flashBack = false; cards(); };
}

/* ---------------- contact ---------------- */
function contact(from) {
  const back = from || route;
  S = { screen: () => contact(from), back };
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("home")}">${bwd()}</button><h2 style="flex:1">${t("contact")}</h2></div>
  ${msgHtml()}
  <form class="card" id="cf" novalidate>
    <p class="muted">${t("contactD")}</p>
    <div class="field"><label for="cm">${t("email")}</label><input id="cm" type="email" dir="ltr" autocomplete="email" autocapitalize="off" value="${esc(st.user?.email || "")}"></div>
    <div class="field"><label for="cb">${t("yourMsg")}</label><textarea id="cb" rows="6" maxlength="3000" style="width:100%;font:inherit;padding:10px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--ink);resize:vertical"></textarea></div>
    <div class="err" id="er" hidden></div>
    <button class="primary" type="submit" id="cs">${t("send")}</button>
    ${SUPPORT ? `<p class="muted">${t("orEmail")} <a class="link" href="mailto:${esc(SUPPORT)}?subject=${encodeURIComponent(t("name") + " – " + t("contact"))}"><bdi dir="ltr">${esc(SUPPORT)}</bdi></a></p>` : ""}
  </form>`);
  st.ui.msg = null;
  $("bk").onclick = () => back();
  const err = (m) => { $("er").textContent = m; $("er").hidden = false; };
  $("cf").onsubmit = async (e) => {
    e.preventDefault();
    const em = $("cm").value.trim(), body = $("cb").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return err(t("badEmail"));
    if (body.length < 2) return err(t("shortMsg"));
    $("cs").disabled = true;
    try { await api.sendMessage(st.user?.id, em, st.profile?.track, body); }
    catch (x) { $("cs").disabled = false; return err(errMsg(x)); }
    flash(t("sent")); back();
  };
}

/* ---------------- account ---------------- */
function account() {
  S = { screen: account, back: tools };
  const p = st.profile;
  const e = ent();
  const plan = isAdmin() ? t("admin") : !e ? t("planNone") : e.plan === "month" ? t("planM") : e.plan === "code" ? t("planC") : t("planE");
  const until = e ? new Date(e.until).toISOString().slice(0, 10) : "";
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("home")}">${bwd()}</button><h2 style="flex:1">${t("acct")}</h2></div>
  ${msgHtml()}
  <div class="card">
    <div class="acct"><span class="who"><bdi dir="ltr">${esc(st.user.email)}</bdi></span><span class="tag">${plan}${hasAccess() && until ? ` · ${t("until")} <bdi>${until}</bdi>` : ""}</span></div>
    ${!hasAccess() ? `<button class="primary" id="pl">${t("choose")}</button>` : ""}
    <div class="field"><label for="ex">${t("changeExam")}</label><div class="row2"><input id="ex" type="date" value="${esc(p.exam_date || "")}"><button class="ghost" id="sx">${t("saveDate")}</button></div></div>
    ${storeAvailable ? `<button class="ghost" id="mg">${t("manage")}</button>` : ""}
    ${SUPPORT ? `<p class="muted">${t("support")}: <bdi dir="ltr">${esc(SUPPORT)}</bdi></p>` : ""}
    <button class="ghost" id="lo">${t("logout")}</button>
  </div>
  <div class="card"><button class="danger" id="del">${st.ui.delArmed ? t("delSure") : t("del")}</button></div>
  ${legalLinks()}`);
  bindLegal();
  st.ui.msg = null;
  $("bk").onclick = tools;
  if ($("pl")) $("pl").onclick = plans;
  $("sx").onclick = async () => { const v = $("ex").value; if (!v) return; await api.updateProfile(null, v).catch(() => {}); st.profile.exam_date = v; flash("✓"); account(); };
  if ($("mg")) $("mg").onclick = () => openUrl(Capacitor.getPlatform() === "ios" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions");
  $("lo").onclick = logout;
  $("del").onclick = async () => {
    if (!st.ui.delArmed) { st.ui.delArmed = true; return account(); }
    st.ui.delArmed = false;
    try { await api.deleteAccount(); } catch (e) { flash(errMsg(e), true); return account(); }
    await logout();
  };
}

boot();
