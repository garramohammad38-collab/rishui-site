import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Device } from "@capacitor/device";
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
const today = () => new Date().toISOString().slice(0, 10);
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

document.addEventListener("visibilitychange", () => { if (document.hidden) saveExam(); });

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
  [st.profile, st.tracks, st.ents, st.freeMode] = await Promise.all([api.getProfile(uid), api.tracks(), api.entitlements(uid), api.freeMode()]);
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
      if (error) return err(String(error.message).includes("fetch") ? t("netErr") : t("wrongLogin"));
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
function chooseTrack(pending) {
  S = { screen: () => chooseTrack(pending), back: st.profile?.track ? route : null };
  const cur = st.profile?.track, first = !cur;
  const list = allowedTracks();
  const card = (x) => { const c = themeOf(x.id).l; return `<button class="plan ${(pending || cur) === x.id ? "on" : ""}" data-k="${esc(x.id)}" style="border-color:${c[0]};background:${c[2]};color:#0F1E33;border-inline-start-width:6px"><span class="dot" style="border-color:${c[0]}"></span>
      <span class="info"><b>${esc(trackName(x.id))}</b><span class="muted" style="color:#4A5A6E">${esc(x[st.lang + "_desc"] || "")}</span></span></button>`; };
  frame(`<div class="card"><h2>${t("chooseTrack")}</h2>
    <div class="plans">${list.map(card).join("")}</div>
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
  return { n, done: st.answers.size, right, wrong: st.answers.size - right };
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
  const list = [...Array(days)].map((_, i) => { const d = new Date(Date.now() - (days - 1 - i) * 864e5).toISOString().slice(0, 10); return { d, n: by[d]?.n || 0, c: by[d]?.correct || 0 }; });
  const max = Math.max(5, ...list.map((x) => x.n)), W = 300, H = 110, bw = W / days;
  return `<svg class="act" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="${t("activityL")}">
    ${list.map((x, i) => { const h = (x.n / max) * H, hc = (x.c / max) * H, xx = i * bw + 3; return `<rect x="${xx}" y="${H - h}" width="${bw - 6}" height="${h}" rx="3" fill="var(--accent-soft)"><title>${x.d}: ${x.n}</title></rect><rect x="${xx}" y="${H - hc}" width="${bw - 6}" height="${hc}" rx="3" fill="var(--accent)"/>${i % 2 === days % 2 ? "" : `<text x="${xx + (bw - 6) / 2}" y="${H + 14}" text-anchor="middle" font-size="9" fill="var(--muted)">${x.d.slice(8)}.${x.d.slice(5, 7)}</text>`}`; }).join("")}
    <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line)"/></svg>`;
}
function topicBars(rows) {
  return `<div class="card bars">${rows.map(({ k, a, b, sub, acc }) => { const r = b ? a / b : 0, q = acc ?? r, cc = q >= 0.8 ? "var(--ok)" : q >= 0.5 ? "var(--amber)" : "var(--bad)"; return `<div class="bar-row"><div class="lbl"><span>${esc(topicName(k, st.lang))}</span><span>${sub ?? `${a}/${b}`}</span></div><div class="bar"><i style="width:${r * 100}%;background:${b ? cc : "transparent"}"></i></div></div>`; }).join("")}</div>`;
}

/* ---------------- home ---------------- */
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
  frame(`${msgHtml()}${newBox}<div id="openx"></div>
  ${!hasAccess() ? `<button class="banner" id="lock" style="border:0;text-align:start;cursor:pointer">🔒 ${t("locked")}</button>` : ""}
  <div class="pkgline"><h2>${t("pkg")}</h2><span class="${hasAccess() ? "okline" : "muted"}">${pkg}</span></div>
  <div class="chips"><span class="chip cool" ${canSwitch() ? 'id="trk" role="button" style="cursor:pointer"' : ""}>${esc(trackName(TR()))}${canSwitch() ? " · " + t("switchTrack") : ""}</span>${dl != null ? `<span class="chip">${dl} ${t("daysLeft")}</span>` : ""}</div>
  ${tt.n === 0 ? `<div class="banner">${t("noneYet")}</div>` : ""}
  ${!st.profile.exam_date ? `<div class="card exq"><h3>${t("examWhen")}</h3><p class="muted">${t("examWhenD")}</p><div class="row2"><input id="exd" type="date" aria-label="${t("examWhen")}"><button class="primary slim" id="exs">${t("saveDate")}</button></div></div>` : ""}
  <div class="home-main">
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
    <div class="row2"><button class="primary" id="go">${t("cont2")} ${fwd()}</button><button class="ghost" id="nx2">${t("navNew")}</button></div>
  </div>
  <div class="grid">
    <button class="tile" id="mis"><b>${t("mistakes")}</b><span class="n">${tt.wrong}</span></button>
    <button class="tile" id="una"><b>${t("unansweredQs")}</b><span class="n">${Math.max(0, tt.n - tt.done)}</span></button>
    <button class="tile" id="smr"><b>${t("smart")}</b><span>${t("smartD")}</span></button>
    <button class="tile" id="bm"><b>${t("bookmarks")}</b><span class="n">${st.marks.size}</span></button>
    <button class="tile" id="clc"><b>${t("calcT")}</b><span>${t("calcD")}</span></button>
    <button class="tile" id="rfp"><b>${t("refT")}</b><span>${t("refD")}</span></button>
    <button class="tile" id="srch"><b>🔍 ${t("search")}</b><span>${t("searchD")}</span></button>
    <button class="tile" id="fl"><b>${t("flash")}</b><span>EN · עב</span></button>
  </div>
  </div>
  <div class="card"><div id="goalw">${goalCard([])}</div></div>
  <div class="card"><div class="card-h"><h3>${t("activityL")}</h3><span class="muted">${t("last14")}</span></div><div id="actc"><div class="spin sm"></div></div></div>
  <div class="section-title">${t("bytopic")}</div>
  <div class="list">${Object.keys(st.counts).sort().map((k) => `<button class="li" data-t="${esc(k)}"><span>${esc(topicName(k, st.lang))} <span class="sub">${esc(topicName(k, st.lang === "he" ? "en" : "he"))}</span></span><span class="count">${added[k] ? `<span class="newtag">+${added[k]} ${t("newBadge")}</span> ` : ""}${st.counts[k]} ${t("qs")}</span></button>`).join("")}</div>
  ${legalLinks()}`, { wide: true, nav: "home" });
  bindLegal();
  st.ui.msg = null;
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
  $("smr").onclick = smartReview; $("clc").onclick = () => calcTrainer(home); $("rfp").onclick = () => refPage(home); $("srch").onclick = () => searchPage(home);
  if ($("exs")) $("exs").onclick = async () => { const v = $("exd").value; if (!v) return; await api.updateProfile(null, v).catch(() => {}); st.profile.exam_date = v; home(); };
  api.activity(st.user.id, TR(), 60).then((rows) => { if (S?.screen !== home) return; if ($("actc")) $("actc").innerHTML = activityChart(rows); if ($("goalw")) { $("goalw").innerHTML = goalCard(rows); bindGoal(rows); } }).catch(() => {});
  api.myExams(st.user.id, TR()).then((list) => {
    const x = list.find((r) => r.status === "open"); if (!x || S?.screen !== home || !$("openx")) return;
    const done = (x.picked || []).filter((v) => v != null).length;
    $("openx").innerHTML = `<div class="newbox"><div class="newbox-h"><b>${t("unfinished")}</b><span class="muted">${done}/${x.ids.length} ${t("answeredOf")}</span></div>
      <div class="row2"><button class="primary" id="umr">${t("resume")} ${fwd()}</button><button class="ghost" id="uml">${t("navExams")}</button></div></div>`;
    $("umr").onclick = () => runExam(x); $("uml").onclick = myExams;
  }).catch(() => {});
}

/* ---------------- new exam (builder) ---------------- */
const EXAM_SECONDS_PER_Q = 90, EXAM_MAX = 180;
function newExam() {
  const saved = store.get("exam-cfg") || {};
  const cfg = { n: saved.n || 50, timed: saved.timed ?? true, guided: saved.guided ?? false, topics: saved.topics || [], pool: saved.pool || "all" };
  S = { screen: newExam };
  const topics = Object.keys(st.counts).sort();
  const draw = () => {
    const avail = Math.min(EXAM_MAX, cfg.topics.length ? cfg.topics.reduce((a, k) => a + (st.counts[k] || 0), 0) : totals().n) || 0;
    if (cfg.n > avail && avail) cfg.n = avail;
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
      <div class="field"><label>${t("qCount")} <span class="muted">(${avail} ${t("maxAvail")})</span></label>
        <div class="chips">${opts.map((o) => `<button class="chip pick ${o === cfg.n ? "cool" : ""}" data-n="${o}">${o}</button>`).join("")}</div>
        <input id="mn" type="number" inputmode="numeric" min="1" max="${avail}" value="${cfg.n}" dir="ltr" aria-label="${t("mockCustom")}"></div>
      ${cfg.timed ? `<p class="muted">${t("mockTime")}: ${Math.round((cfg.n * EXAM_SECONDS_PER_Q) / 60)} ${t("min")}</p>` : ""}
      <div class="err" id="er" hidden></div>
      <button class="primary" id="ms" ${avail ? "" : "disabled"}>${t("create")} ${fwd()}</button>
    </div>`, { wide: true, nav: "newx" });
    app.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { cfg[b.dataset.s] = b.dataset.v === "1"; draw(); }));
    app.querySelectorAll("[data-pool]").forEach((b) => (b.onclick = () => { cfg.pool = b.dataset.pool; draw(); }));
    app.querySelectorAll("[data-tp]").forEach((b) => (b.onclick = () => {
      const k = b.dataset.tp; if (!k) cfg.topics = [];
      else cfg.topics = cfg.topics.includes(k) ? cfg.topics.filter((x) => x !== k) : [...cfg.topics, k];
      draw();
    }));
    app.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => { cfg.n = +b.dataset.n; draw(); }));
    $("mn").onchange = () => { cfg.n = Math.max(1, Math.min(avail || 1, Math.round(+$("mn").value || 1))); draw(); };
    $("ms").onclick = async () => {
      store.set("exam-cfg", cfg);
      $("ms").disabled = true;
      try {
        const ids = await api.examIds(TR(), cfg.n, cfg.topics, cfg.pool);
        if (!ids.length) { $("er").textContent = t("noneMatch"); $("er").hidden = false; $("ms").disabled = false; return; }
        const row = await api.createExam({ track: TR(), settings: { timed: cfg.timed, guided: cfg.guided, topics: cfg.topics, pool: cfg.pool }, ids, picked: ids.map(() => null), time_limit: cfg.timed ? ids.length * EXAM_SECONDS_PER_Q : null });
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
    const at = new Map(row.ids.map((id, i) => [id, i]));
    const picked = items.map((q) => { const v = row.picked?.[at.get(q.id)]; return v == null ? null : +v; });
    S = { mode: "exam", ex: row, items, picked, saved: picked.map((v) => v != null), i: Math.min(row.i || 0, items.length - 1), start: Date.now() - (row.used || 0) * 1000, limit: row.time_limit || null, guided: !!row.settings?.guided, tick: null, back: () => { saveExam(); myExams(); } };
    examQ();
  } catch (e) {
    frame(`<div class="card"><p>${esc(errMsg(e))}</p><button class="primary" id="rt">${t("retry")}</button><button class="ghost" id="hm">${t("home")}</button></div>`);
    $("rt").onclick = () => runExam(row); $("hm").onclick = route;
  }
}
function examUsed() { return Math.floor((Date.now() - S.start) / 1000); }
function saveExam() {
  if (S?.mode !== "exam" || S.ended) return;
  const ids = S.items.map((q) => q.id);
  api.updateExam(S.ex.id, { ids, picked: S.picked, i: S.i, used: examUsed() }).catch(() => {});
}
function examQ() {
  S.screen = examQ;
  const q = S.items[S.i], c = q[st.lang], tot = S.items.length, sel = S.picked[S.i];
  const locked = S.guided && sel != null;
  frame(`${qHead(S.i + 1, tot)}
  <div class="card">${qBody(q, S.i + 1, tot)}
    <div class="opts">${c.o.map((o, k) => `<button class="opt ${!S.guided && sel === k ? "sel" : ""}" data-k="${k}"><span class="l">${LET[st.lang][k]}</span><span>${esc(o)}</span></button>`).join("")}</div>
    ${S.guided ? `<div id="fb" style="margin-top:12px"></div>` : ""}
    <div class="mocknav"><button class="ghost" id="pv" ${S.i === 0 ? "disabled" : ""}>${bwd()} ${t("prev")}</button>${S.i < tot - 1 ? `<button class="primary" id="nx">${t("next")} ${fwd()}</button>` : `<button class="primary" id="fin">${t("finish")}</button>`}</div>
    <p class="muted">${S.picked.filter((x) => x == null).length} ${t("unanswered")}</p>
  </div>`, { protect: true });
  const el = $("tm"), upd = () => {
    if (S?.screen !== examQ) return;
    const used = examUsed();
    if (S.limit) { const left = S.limit - used; if (left <= 0) return examEnd(); clock(el, left); } else clock(el, used);
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
  if ($("fin")) $("fin").onclick = examEnd;
}
async function examEnd() {
  stopTimer();
  const used = Math.min(examUsed(), S.limit || 1e9);
  S.ended = true;
  const ans = S.items.map((q, i) => S.picked[i] === q.answer);
  S.items.forEach((q, i) => {
    if (S.picked[i] == null || S.saved[i]) return;
    st.answers.set(q.id, ans[i]); api.saveAnswer(st.user.id, TR(), q.id, S.picked[i], ans[i]).catch(() => {});
  });
  const score = ans.filter(Boolean).length, p = pctOf(score, S.items.length);
  if (st.best == null || p > st.best) st.best = p;
  const ex = { ...S.ex, ids: S.items.map((q) => q.id), picked: S.picked, used, status: "done", score, finished_at: new Date().toISOString() };
  api.updateExam(ex.id, { ids: ex.ids, picked: ex.picked, i: S.i, used, status: "done", score, finished_at: ex.finished_at }).catch(() => {});
  api.saveMock(st.user.id, TR(), score, S.items.length).catch(() => {});
  examResult(ex, S.items, "all");
}
// result / view / analysis of one exam
function examResult(ex, items, part = "all") {
  const picked = items.map((q) => { const i = ex.ids.indexOf(q.id); const v = ex.picked?.[i]; return v == null ? null : +v; });
  const n = items.length, c = items.filter((q, i) => picked[i] === q.answer).length, p = pctOf(c, n), s = ex.used || 0;
  const by = {}; items.forEach((q, i) => { by[q.topic] = by[q.topic] || [0, 0]; by[q.topic][1]++; if (picked[i] === q.answer) by[q.topic][0]++; });
  const answered = picked.filter((v) => v != null).length;
  S = { screen: () => examResult(ex, items, part), back: myExams, ex, items };
  const showA = part !== "review", showR = part !== "analysis";
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><h2 style="flex:1">${t("examNo")} #${ex.id}</h2></div>
  <div class="card score">${ringSvg(p, 130)}
    <h2>${p >= 80 ? t("r80") : p >= 60 ? t("r60") : t("r0")}</h2>
    <p class="muted">${c} ${t("of")} ${n} ${t("ofCorrect")} · ${Math.floor(s / 60)} ${t("min")} ${s % 60} ${t("sec")}</p>
  </div>
  ${showA ? `<div class="section-title">${t("strengths")}</div>
  ${topicBars(Object.entries(by).map(([k, [a, b]]) => ({ k, a, b })))}
  <div class="big-stat"><div class="tile"><span>${t("avgPerQ")}</span><span class="n">${answered ? Math.round(s / answered) : 0} ${t("sec")}</span><span class="muted">${t("recPerQ")}</span></div>
  <div class="tile"><span>${t("answeredL")}</span><span class="n">${answered}/${n}</span></div></div>` : ""}
  ${showR ? `<div class="section-title">${t("review")}</div><div class="review protect">${items.map((q, i) => { const pk = picked[i], ok = pk === q.answer, c2 = q[st.lang]; return `<div class="rv"><span class="st ${ok ? "okc" : "badc"}">${i + 1}. ${ok ? t("correct") : t("wrong")}</span><span>${esc(c2.q)}</span>${ok ? "" : `<span class="muted">${t("yourAns")}: ${pk == null ? t("none") : esc(c2.o[pk])}</span>`}<span class="muted">${t("rightAns")}: <b>${esc(c2.o[q.answer])}</b></span><span class="muted" style="white-space:pre-line">${esc(c2.e)}</span></div>`; }).join("")}</div>` : ""}
  <div class="actions"><button class="primary" id="nw">${t("newExamGo")}</button><button class="ghost" id="ml">${t("navExams")}</button></div>`, { protect: showR });
  $("bk").onclick = myExams; $("nw").onclick = newExam; $("ml").onclick = myExams;
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
    <div class="card"><h3>${t("helpT")}</h3><p class="muted">${t("helpD")}</p><button class="primary" id="hp">${t("contact")}</button></div>
    <div class="card"><h3>${t("resetT")}</h3><p class="muted">${t("resetD")}</p><button class="danger" id="rs">${st.ui.resetArmed ? t("resetSure") : t("resetBtn")}</button></div>
  </div>
  ${legalLinks()}`, { wide: true, nav: "tools" });
  bindLegal(); st.ui.msg = null;
  $("ac").onclick = account; $("hp").onclick = () => contact(tools);
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

/* ---------------- daily goal + streak ---------------- */
const goalKey = () => `goal:${st.user.id}`;
const goalOf = () => store.get(goalKey()) || 20;
function streakOf(rows) {
  const by = new Set((rows || []).filter((r) => r.n > 0).map((r) => r.day));
  let d = new Date(today() + "T00:00Z"), n = 0;
  if (!by.has(d.toISOString().slice(0, 10))) d = new Date(d - 864e5);
  while (by.has(d.toISOString().slice(0, 10))) { n++; d = new Date(d - 864e5); }
  return n;
}
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
  practice({ kind: "ids", ids });
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

/* ---------------- search all questions ---------------- */
function searchPage(back = route, keep) {
  const Q = keep || { term: "", res: null, err: null };
  S = { screen: () => searchPage(back, Q), back };
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("back")}">${bwd()}</button><h2 style="flex:1">${t("search")}</h2></div>
  <form class="card" id="sf"><div class="row2"><input id="sq" type="search" placeholder="${t("searchPh")}" value="${esc(Q.term)}" aria-label="${t("search")}" enterkeyhint="search"><button class="primary slim" type="submit">${t("search")}</button></div></form>
  ${Q.err ? `<div class="banner bad">${esc(Q.err)}</div>` : ""}
  ${Q.res && !Q.res.length ? `<div class="card"><p class="muted">${t("noResults")}</p></div>` : ""}
  <div class="qlist protect">${(Q.res || []).map((r) => `<button class="qrow" data-q="${r.id}"><span class="qn"><small>#${r.id}</small></span><span class="qq">${esc(st.lang === "he" ? r.q_he : r.q_en)}</span><span class="qk"><small>${esc(topicName(r.topic, st.lang))}</small></span><span class="qv">${t("view")} ${fwd()}</span></button>`).join("")}</div>`, { wide: true });
  $("bk").onclick = () => back();
  if (!Q.res) $("sq").focus();
  $("sf").onsubmit = async (e) => {
    e.preventDefault();
    Q.term = $("sq").value.trim(); if (Q.term.length < 2) return;
    try { Q.res = await api.searchQuestions(TR(), Q.term); Q.err = null; }
    catch (x) { Q.res = null; Q.err = /search_questions|function/i.test(x?.message || "") ? t("searchNeed") : errMsg(x); }
    searchPage(back, Q);
  };
  app.querySelectorAll("[data-q]").forEach((b) => (b.onclick = async () => {
    const id = +b.dataset.q; loading();
    try { const [q] = await api.questionsByIds(TR(), [id]); if (q) return viewQuestion(q, null, () => searchPage(back, Q)); } catch (x) { Q.err = errMsg(x); }
    searchPage(back, Q);
  }));
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
function reveal(q, k) {
  const c = q[st.lang], ok = k === q.answer, { per, gen } = parseExp(c.e, st.lang);
  app.querySelectorAll(".opt").forEach((b) => {
    const n = +b.dataset.k; b.disabled = true;
    if (n === q.answer) b.classList.add("right"); else if (n === k) b.classList.add("wrong");
    if (per[n] && !b.querySelector(".why")) b.children[1].insertAdjacentHTML("beforeend", `<small class="why">${n === q.answer ? "✓" : "✗"} ${esc(per[n])}</small>`);
  });
  const hasPer = Object.keys(per).length > 0;
  return `<div class="explain"><b>${ok ? t("correct") : t("wrong")}</b>
    <div class="rans">${t("rightAns")}: <strong>${LET[st.lang][q.answer]} – ${esc(c.o[q.answer])}</strong></div>
    ${hasPer ? (gen ? `<span>${esc(gen)}</span>` : "") : `<span>${esc(c.e)}</span>`}
    ${hasPer ? `<div class="muted" style="font-size:13px">${t("whyEach")}</div>` : ""}
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
