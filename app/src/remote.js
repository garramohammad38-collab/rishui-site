// Remote look & feel: everything the admin panel can change without an app update.
// The config is plain data (no code): texts, colours, hidden sections, banners, track pictures/colours,
// contact links, a maintenance screen and an "update available" note. It is read from the
// public app_ui table, kept in localStorage so the app opens with the last look even offline.
const KEY = "rs-ui";

// sections the admin can hide (the same list is shown in the admin panel)
export const SECTIONS = {
  mission: "#missionw",
  progress: ".app .hero",
  stats4: ".stats4",
  pastex: "#pst",
  summaries: "#smr",
  actions: ".acts4",
  newexam: "#nx2",
  smart: "#smr2",
  mistakes: "#mis",
  bookmarks: "#bm",
  journey: "#journeyw",
  league: "#leaguew, #lgt2",
  goal: ".card:has(> #goalw)",
  heroChar: ".h-char",
  heroDeco: ".h-deco",
  lang: ".top .lang",
  instagram: "#ig, #lg-ig",
  whatsapp: "#wa, #lg-wa, #wac",
  navExams: '[data-nav="exams"]',
  navQs: '[data-nav="qs"]',
  navStats: '[data-nav="stats"]',
};
// colour variables the admin can set (light and dark separately)
export const COLORS = ["accent", "accent-soft", "on-accent", "bg", "surface", "ink", "muted", "line", "amber", "ok", "bad", "g1", "g2"];

export let UI = {};
let DEF = null; // the built-in texts, so removing an override brings the original back

export function cached() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

const okColor = (c) => typeof c === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i.test(c.trim());
const okUrl = (u) => typeof u === "string" && /^https:\/\//i.test(u.trim());
const cssEsc = (s) => String(s).replace(/[<>]/g, "");

// apply a config: texts into T, styles into a <style> kept last in <head>
export function apply(cfg, T) {
  UI = cfg && typeof cfg === "object" ? cfg : {};
  if (T) {
    if (!DEF) DEF = { he: { ...T.he }, en: { ...T.en } };
    for (const lang of ["he", "en"]) {
      if (!T[lang]) continue;
      Object.assign(T[lang], DEF[lang]);
      const o = UI.texts?.[lang] || {};
      for (const [k, v] of Object.entries(o)) if (k in DEF[lang] && typeof v === "string" && v.trim()) T[lang][k] = v;
    }
  }
  let css = "";
  const vars = (o) => Object.entries(o || {}).filter(([k, v]) => COLORS.includes(k) && okColor(v)).map(([k, v]) => `--${k}:${v.trim()} !important;`).join("");
  const L = vars(UI.colors?.light), D = vars(UI.colors?.dark);
  if (L) css += `:root{${L}}\n`;
  if (D) css += `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${D}}}\n:root[data-theme="dark"]{${D}}\n`;
  const hide = (UI.hide || []).map((k) => SECTIONS[k]).filter(Boolean);
  if (hide.length) css += `${hide.join(",")}{display:none !important}\n`;
  if (typeof UI.css === "string" && UI.css.trim()) css += cssEsc(UI.css) + "\n";
  css += `.rui-ban{display:flex;flex-direction:column;gap:8px;border-radius:18px;padding:14px 16px;border:1px solid var(--line);background:var(--surface);text-align:start;width:100%;font:inherit;color:inherit}
.rui-ban.c{background:var(--rb);color:#fff;border-color:transparent}.rui-ban.c .muted{color:rgba(255,255,255,.88)}
.rui-ban img{width:100%;max-height:220px;object-fit:cover;border-radius:12px}.rui-ban b{font-size:16px}.rui-ban .rui-btn{align-self:flex-start;margin-top:2px}
.rui-wrap{display:flex;flex-direction:column;gap:12px}`;
  let el = document.getElementById("rui-style");
  if (!el) { el = document.createElement("style"); el.id = "rui-style"; }
  el.textContent = css;
  document.head.appendChild(el); // always last, so it wins over the track theme
}

// read the newest config; true when it changed
export async function refresh(supabase, T) {
  try {
    const { data, error } = await supabase.from("app_ui").select("config").eq("id", 1).maybeSingle();
    if (error || !data) return false;
    const s = JSON.stringify(data.config || {});
    if (s === JSON.stringify(UI)) return false;
    try { localStorage.setItem(KEY, s); } catch {}
    apply(data.config || {}, T);
    return true;
  } catch { return false; }
}

// keep the style element last after other code adds styles
export function keepLast() {
  const el = document.getElementById("rui-style");
  if (el && el !== document.head.lastElementChild) document.head.appendChild(el);
}

/* ---- per-track picture and colours ---- */
export function trackImage(id) {
  const u = UI.tracks?.[id]?.image;
  return okUrl(u) ? u : "";
}
export function trackGrad(id) {
  const x = UI.tracks?.[id];
  return x && okColor(x.g1) && okColor(x.g2) ? [x.g1, x.g2] : null;
}
export function trackTheme(id) {
  const x = UI.tracks?.[id];
  if (!x || !okColor(x.accent)) return null;
  const soft = okColor(x.soft) ? x.soft : `color-mix(in srgb,${x.accent} 15%,#fff)`;
  const bg = okColor(x.bg) ? x.bg : `color-mix(in srgb,${x.accent} 5%,#fff)`;
  return { l: [x.accent, soft, bg], d: [x.accent, `color-mix(in srgb,${x.accent} 30%,#000)`, "#0E1418"] };
}

/* ---- contact links ---- */
export const instagram = (fallback) => (okUrl(UI.contact?.instagram) ? UI.contact.instagram.trim() : fallback);
export const email = (fallback) => (typeof UI.contact?.email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(UI.contact.email.trim()) ? UI.contact.email.trim() : fallback);

/* ---- banners ---- */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function banners(place, track, lang) {
  const now = Date.now();
  const list = (UI.banners || []).filter((b) => b && b.active !== false
    && (b.place || "home") === place
    && (!b.tracks?.length || b.tracks.includes(track) || (track === "optometry_prac" && b.tracks.includes("optometry")))
    && (!b.from || Date.parse(b.from) <= now) && (!b.until || Date.parse(b.until) + 864e5 > now));
  if (!list.length) return "";
  return `<div class="rui-wrap">${list.map((b) => {
    const x = b[lang] || b.he || {};
    if (!x.title && !x.body && !okUrl(b.image)) return "";
    const col = okColor(b.color) ? b.color : "";
    const go = okUrl(b.url) ? ` data-rui-url="${esc(b.url.trim())}"` : b.action ? ` data-rui-act="${esc(b.action)}"` : "";
    const tag = go && !x.btn ? "button" : "div";
    return `<${tag} class="rui-ban${col ? " c" : ""}"${col ? ` style="--rb:${esc(col)}"` : ""}${tag === "button" ? go : ""}>
      ${okUrl(b.image) ? `<img src="${esc(b.image.trim())}" alt="">` : ""}
      ${x.title ? `<b>${esc(x.title)}</b>` : ""}${x.body ? `<p class="muted">${esc(x.body).replace(/\n/g, "<br>")}</p>` : ""}
      ${go && x.btn ? `<button class="primary slim rui-btn"${go}>${esc(x.btn)}</button>` : ""}</${tag}>`;
  }).join("")}</div>`;
}

/* ---- maintenance screen and update note ---- */
export function maintenance(lang) {
  const m = UI.maint;
  if (!m || !m.on) return null;
  return (m[lang] || m.he || "").trim() || "…";
}
export function updateNote(build, lang) {
  const u = UI.update;
  if (!u || !u.min_build || !build || Number(build) >= Number(u.min_build)) return null;
  return (u[lang] || u.he || "").trim() || null;
}
