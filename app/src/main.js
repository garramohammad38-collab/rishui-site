import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Device } from "@capacitor/device";
import * as api from "./api.js";
import { T, topicName as fallbackTopic } from "./i18n.js";
import { initPurchases, priceOf, buy, restore, storeAvailable, logoutPurchases } from "./purchases.js";

/* ---------------- state ---------------- */
const app = document.getElementById("app");
const wm = document.getElementById("wm");
const LEGAL = window.__env.VITE_LEGAL_BASE || "";
const SUPPORT = window.__env.VITE_SUPPORT_EMAIL || "";
const MOCK_N = 50, MOCK_SECONDS_PER_Q = 90;

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
const hasAccess = () => !!st.profile && (st.profile.role === "admin" || !!ent());
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
  nursing:     { l: ["#1554A8", "#DCE8F8", "#EAF1FA"], d: ["#5B9CF0", "#16305A", "#0C1626"] },
  medicine:    { l: ["#0F7A5C", "#D5F0E5", "#E8F5EF"], d: ["#46C79C", "#123D30", "#0A1A15"] },
  physio:      { l: ["#C2581B", "#FBE2D2", "#FBF1E9"], d: ["#F08A4B", "#45240F", "#1C120B"] },
  ot:          { l: ["#6D3FB5", "#E7DCF8", "#F3EEFB"], d: ["#A98BEA", "#2E2050", "#130F1F"] },
  radiography: { l: ["#B42357", "#F8DAE5", "#FBEEF3"], d: ["#EE6E9A", "#4A1529", "#1C0C12"] },
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
function frame(inner, { protect = false } = {}) {
  stopTimer();
  watermark(protect);
  applyTheme();
  document.documentElement.lang = st.lang;
  document.documentElement.dir = t("dir");
  app.className = "app" + (protect ? " protect" : "");
  app.innerHTML = `<div class="top"><div class="brand"><div class="mark">${st.lang === "he" ? "מ" : "M"}</div><div><h1>${t("name")}</h1><small>${st.profile?.track ? trackName(st.profile.track) : t("tag")}</small></div></div>
  <div class="lang"><button data-l="he" class="${st.lang === "he" ? "on" : ""}">עב</button><button data-l="en" class="${st.lang === "en" ? "on" : ""}">EN</button></div></div>${inner}`;
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
  return `<div class="small-links"><button class="link" id="lg-t">${t("terms")}</button><button class="link" id="lg-p">${t("privacy")}</button></div>`;
}
function bindLegal() {
  if ($("lg-t")) $("lg-t").onclick = () => openUrl(`${LEGAL}/terms-${st.lang}.html`);
  if ($("lg-p")) $("lg-p").onclick = () => openUrl(`${LEGAL}/privacy-${st.lang}.html`);
}
document.addEventListener("contextmenu", (e) => { if (e.target.closest?.(".protect")) e.preventDefault(); });
document.addEventListener("copy", (e) => { if (e.target?.closest?.(".protect")) e.preventDefault(); });

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
  [st.profile, st.tracks, st.ents] = await Promise.all([api.getProfile(uid), api.tracks(), api.entitlements(uid)]);
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
  if (!st.profile?.track) return chooseTrack();
  if (!hasAccess() && !store.get(`skip-plans:${st.user.id}:${TR()}`)) return plans();
  home();
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
  </form>`);
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
function chooseTrack() {
  S = { screen: chooseTrack, back: st.profile?.track ? route : null };
  const cur = st.profile?.track;
  frame(`<div class="card"><h2>${t("chooseTrack")}</h2>
    <div class="plans">${st.tracks.map((x) => { const c = themeOf(x.id).l; return `<button class="plan ${cur === x.id ? "on" : ""}" data-k="${esc(x.id)}" style="border-color:${c[0]};background:${c[2]};color:#0F1E33;border-inline-start-width:6px"><span class="dot" style="border-color:${c[0]}"></span>
      <span class="info"><b>${esc(trackName(x.id))}</b><span class="muted" style="color:#4A5A6E">${esc(x[st.lang + "_desc"] || "")}</span></span></button>`; }).join("")}</div>
  </div>${cur ? `<button class="ghost" id="bk">${t("home")}</button>` : ""}`);
  if ($("bk")) $("bk").onclick = route;
  app.querySelectorAll(".plan").forEach((b) => (b.onclick = async () => {
    const k = b.dataset.k;
    loading();
    try {
      await api.updateProfile(null, null, k);
      st.profile.track = k;
      await loadUserData();
      route();
    } catch (e) { flash(errMsg(e), true); chooseTrack(); }
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
    <button class="chip" id="trk" style="align-self:flex-start;cursor:pointer">${esc(trackName(TR()))} · ${t("switchTrack")}</button>
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
  $("trk").onclick = chooseTrack;
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
function home() {
  S = { screen: home };
  const tt = totals(), pct = tt.n ? Math.round((tt.done / tt.n) * 100) : 0, dl = daysLeft();
  frame(`${msgHtml()}
  ${!hasAccess() ? `<button class="banner" id="lock" style="border:0;text-align:start;cursor:pointer">🔒 ${t("locked")}</button>` : ""}
  <div class="chips"><button class="chip" id="trk" style="cursor:pointer">${esc(trackName(TR()))} · ${t("switchTrack")}</button>${dl != null ? `<span class="chip cool">📅 ${dl} ${t("daysLeft")}</span>` : ""}</div>
  ${tt.n === 0 ? `<div class="banner">${t("noneYet")}</div>` : ""}
  <div class="hero">
    <div class="eyebrow">${t("progress")}</div>
    <h2>${tt.done} ${t("of")} ${tt.n} ${t("done")}</h2>
    <div class="pbar"><i style="width:${pct}%"></i></div>
    <button class="primary" id="go">${t("cont2")} ${fwd()}</button>
  </div>
  <div class="grid">
    <button class="tile" id="mk"><b>${t("mock")}</b><span>${t("mockD")}</span></button>
    <button class="tile" id="mis"><b>${t("mistakes")}</b><span class="n">${tt.wrong}</span></button>
    <button class="tile" id="bm"><b>${t("bookmarks")}</b><span class="n">${st.marks.size}</span></button>
    <button class="tile" id="fl"><b>${t("flash")}</b><span>EN · עב</span></button>
    <button class="tile" id="sts"><b>${t("stats")}</b><span>${tt.done ? Math.round((tt.right / tt.done) * 100) : 0}% ${t("accuracy")}</span></button>
    <button class="tile" id="ac"><b>${t("acct")}</b><span><bdi dir="ltr">${esc(st.user.email)}</bdi></span></button>
  </div>
  <div class="section-title">${t("bytopic")}</div>
  <div class="list">${Object.keys(st.counts).sort().map((k) => `<button class="li" data-t="${esc(k)}"><span>${esc(topicName(k, st.lang))} <span class="sub">${esc(topicName(k, st.lang === "he" ? "en" : "he"))}</span></span><span class="count">${st.counts[k]} ${t("qs")}</span></button>`).join("")}</div>`);
  st.ui.msg = null;
  if ($("lock")) $("lock").onclick = plans;
  $("trk").onclick = chooseTrack;
  $("go").onclick = () => practice({ kind: "seq" });
  $("mk").onclick = mock;
  $("mis").onclick = () => practice({ kind: "ids", ids: [...st.answers].filter(([, c]) => !c).map(([id]) => id) });
  $("bm").onclick = () => practice({ kind: "ids", ids: [...st.marks] });
  $("fl").onclick = () => { st.ui.flashI = 0; st.ui.flashBack = false; cards(); };
  $("sts").onclick = stats;
  $("ac").onclick = account;
  app.querySelectorAll(".li").forEach((b) => (b.onclick = () => practice({ kind: "topic", topic: b.dataset.t })));
}

/* ---------------- practice ---------------- */
const BATCH = 20;
async function practice(src) {
  loading();
  try {
    let items;
    if (src.kind === "ids") {
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
  <div class="qtools"><button class="tool ${on ? "on" : ""}" id="mk">${on ? "★ " + t("saved") : "☆ " + t("save")}</button></div>
  <div class="qtext">${esc(c.q)}</div>
  ${q.terms?.length ? `<div class="terms">${q.terms.map((x) => `<span class="term"><bdi>${esc(x[0])}</bdi> · <bdi>${esc(x[1])}</bdi></span>`).join("")}</div>` : ""}`;
}
function bindMark(q) {
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
function feedback(k) {
  const q = S.items[S.i], ok = k === q.answer, last = S.i === S.items.length - 1;
  app.querySelectorAll(".opt").forEach((b) => { const n = +b.dataset.k; b.disabled = true; if (n === q.answer) b.classList.add("right"); else if (n === k) b.classList.add("wrong"); });
  $("fb").innerHTML = `<div class="explain"><b>${ok ? t("correct") : t("wrong")}</b><span>${esc(q[st.lang].e)}</span>
    <div class="ref"><strong>${t("source")}:</strong> <bdi dir="ltr">${esc(q.source)}</bdi></div></div>
  <div class="qtools" style="margin-top:10px"><button class="tool" id="rp">⚑ ${t("report")}</button></div>
  <button class="primary" id="nx" style="margin-top:12px">${last ? t("result") : t("next")}</button>`;
  $("rp").onclick = () => { api.report(st.user.id, q.id).catch(() => {}); $("rp").textContent = t("reported"); $("rp").disabled = true; };
  $("nx").onclick = () => { if (last) result(); else { S.i++; question(); } };
}

/* ---------------- mock exam ---------------- */
async function mock() {
  loading();
  try {
    const ids = await api.mockIds(TR(), MOCK_N);
    if (!ids.length) { frame(`<div class="card"><p class="muted">${t("noItems")}</p><button class="ghost" id="hm">${t("home")}</button></div>`); $("hm").onclick = route; return; }
    const items = await api.questionsByIds(TR(), ids);
    keepTerms(items);
    S = { mode: "mock", items, i: 0, picked: Array(items.length).fill(null), start: Date.now(), limit: items.length * MOCK_SECONDS_PER_Q, tick: null, back: route };
    mockQ();
  } catch (e) {
    frame(`<div class="card"><p>${esc(errMsg(e))}</p><button class="ghost" id="hm">${t("home")}</button></div>`); $("hm").onclick = route;
  }
}
function mockQ() {
  S.screen = mockQ;
  const q = S.items[S.i], c = q[st.lang], tot = S.items.length, sel = S.picked[S.i];
  frame(`${qHead(S.i + 1, tot)}
  <div class="card">${qBody(q, S.i + 1, tot)}
    <div class="opts">${c.o.map((o, k) => `<button class="opt ${sel === k ? "sel" : ""}" data-k="${k}"><span class="l">${LET[st.lang][k]}</span><span>${esc(o)}</span></button>`).join("")}</div>
    <div class="mocknav"><button class="ghost" id="pv" ${S.i === 0 ? "disabled" : ""}>${bwd()} ${t("prev")}</button>${S.i < tot - 1 ? `<button class="primary" id="nx">${t("next")} ${fwd()}</button>` : `<button class="primary" id="fin">${t("finish")}</button>`}</div>
    <p class="muted">${S.picked.filter((x) => x == null).length} ${t("unanswered")}</p>
  </div>`, { protect: true });
  const el = $("tm"), upd = () => { if (S?.screen !== mockQ) return; const left = S.limit - Math.floor((Date.now() - S.start) / 1000); if (left <= 0) return mockEnd(); clock(el, left); };
  upd(); S.tick = setInterval(upd, 1000);
  $("bk").onclick = route; bindMark(q);
  app.querySelectorAll(".opt").forEach((b) => (b.onclick = () => { S.picked[S.i] = +b.dataset.k; app.querySelectorAll(".opt").forEach((x) => x.classList.toggle("sel", x === b)); }));
  $("pv").onclick = () => { S.i--; mockQ(); };
  if ($("nx")) $("nx").onclick = () => { S.i++; mockQ(); };
  if ($("fin")) $("fin").onclick = mockEnd;
}
function mockEnd() {
  stopTimer();
  S.ans = S.items.map((q, i) => S.picked[i] === q.answer);
  S.items.forEach((q, i) => { if (S.picked[i] != null) { st.answers.set(q.id, S.ans[i]); api.saveAnswer(st.user.id, TR(), q.id, S.picked[i], S.ans[i]).catch(() => {}); } });
  const score = S.ans.filter(Boolean).length;
  api.saveMock(st.user.id, TR(), score, S.items.length).catch(() => {});
  const p = Math.round((score / S.items.length) * 100);
  if (st.best == null || p > st.best) st.best = p;
  result();
}

/* ---------------- result ---------------- */
function result() {
  S.screen = result;
  const n = S.items.length, c = S.ans.filter(Boolean).length, p = Math.round((c / n) * 100);
  const s = Math.min(Math.floor((Date.now() - S.start) / 1000), S.limit || 1e9);
  const by = {}; S.items.forEach((q, i) => { by[q.topic] = by[q.topic] || [0, 0]; by[q.topic][1]++; if (S.ans[i]) by[q.topic][0]++; });
  const R = 60, C = 2 * Math.PI * R, col = p >= 80 ? "var(--ok)" : p >= 60 ? "var(--amber)" : "var(--bad)";
  const isMock = S.mode === "mock", canMore = S.mode === "practice" && S.src.kind !== "ids" && n === BATCH;
  frame(`<div class="card score">
    <svg class="ring" viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--line)" stroke-width="12"/>
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p / 100)}" transform="rotate(-90 70 70)"/>
      <text x="70" y="79" text-anchor="middle" font-size="30" font-weight="700" fill="var(--ink)" font-family="Rubik, sans-serif">${p}%</text></svg>
    <h2>${p >= 80 ? t("r80") : p >= 60 ? t("r60") : t("r0")}</h2>
    <p class="muted">${c} ${t("of")} ${n} ${t("ofCorrect")} · ${Math.floor(s / 60)} ${t("min")} ${s % 60} ${t("sec")}</p>
  </div>
  <div class="section-title">${t("strengths")}</div>
  <div class="card bars">${Object.entries(by).map(([k, [a, b]]) => { const r = a / b, cc = r >= 0.8 ? "var(--ok)" : r >= 0.5 ? "var(--amber)" : "var(--bad)"; return `<div class="bar-row"><div class="lbl"><span>${esc(topicName(k, st.lang))}</span><span>${a}/${b}</span></div><div class="bar"><i style="width:${r * 100}%;background:${cc}"></i></div></div>`; }).join("")}</div>
  ${isMock ? `<div class="section-title">${t("review")}</div><div class="review protect">${S.items.map((q, i) => { const pk = S.picked[i], ok = pk === q.answer, c2 = q[st.lang]; return `<div class="rv"><span class="st ${ok ? "okc" : "badc"}">${i + 1}. ${ok ? t("correct") : t("wrong")}</span><span>${esc(c2.q)}</span>${ok ? "" : `<span class="muted">${t("yourAns")}: ${pk == null ? t("none") : esc(c2.o[pk])}</span>`}<span class="muted">${t("rightAns")}: <b>${esc(c2.o[q.answer])}</b></span><span class="muted">${esc(c2.e)}</span></div>`; }).join("")}</div>` : ""}
  <div class="actions">${canMore ? `<button class="primary" id="more">${t("cont2")}</button>` : `<button class="primary" id="ag">${t("again")}</button>`}<button class="ghost" id="hm">${t("home")}</button></div>`, { protect: isMock });
  if ($("more")) $("more").onclick = () => (S.src.kind === "seq" ? practice(S.src) : topicNext(S.src.topic, S.items.at(-1).id));
  if ($("ag")) $("ag").onclick = () => {
    if (isMock) return mock();
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

/* ---------------- stats ---------------- */
function stats() {
  S = { screen: stats, back: route };
  const tt = totals();
  frame(`<div class="qbar"><button class="back" id="bk" aria-label="${t("home")}">${bwd()}</button><h2 style="flex:1">${t("stats")}</h2></div>
  <div class="big-stat"><div class="tile"><span>${t("answered")}</span><span class="n">${tt.done}/${tt.n}</span></div><div class="tile"><span>${t("accuracy")}</span><span class="n">${tt.done ? Math.round((tt.right / tt.done) * 100) : 0}%</span></div></div>
  <div class="big-stat"><div class="tile"><span>${t("bestMock")}</span><span class="n">${st.best == null ? "—" : st.best + "%"}</span></div><div class="tile"><span>${t("mistakes")}</span><span class="n">${tt.wrong}</span></div></div>`);
  $("bk").onclick = route;
}

/* ---------------- account ---------------- */
function account() {
  S = { screen: account, back: route };
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
  $("bk").onclick = route;
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
