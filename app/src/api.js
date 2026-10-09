import { createClient } from "@supabase/supabase-js";

const URL = window.__env.VITE_SUPABASE_URL;
const KEY = window.__env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } });

function must({ data, error }) { if (error) throw error; return data; }

export const auth = {
  session: async () => (await supabase.auth.getSession()).data.session,
  signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
  signUp: (email, password) => supabase.auth.signUp({ email, password }),
  // the link in the email opens the web app, where the student picks a new password
  reset: (email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: window.__env.VITE_APP_URL || "https://garramohammad38-collab.github.io/rishui-site/app/" }),
  setPassword: (password) => supabase.auth.updateUser({ password }),
  signOut: () => supabase.auth.signOut(),
  onChange: (fn) => supabase.auth.onAuthStateChange(fn),
};

export async function getProfile(uid) {
  return must(await supabase.from("profiles").select("*").eq("id", uid).single());
}
export async function updateProfile(lang, examDate, track = null) {
  must(await supabase.rpc("update_my_profile", { p_lang: lang ?? null, p_exam_date: examDate ?? null, p_track: track }));
}
export async function tracks() {
  return must(await supabase.from("tracks").select("*").eq("active", true).order("sort"));
}
export async function topics(track) {
  return must(await supabase.from("topics").select("id,he,en,sort").eq("track", track).order("sort"));
}
export async function entitlements(uid) {
  return must(await supabase.from("entitlements").select("track,plan,until").eq("user_id", uid));
}
export async function registerDevice(id, label) {
  return must(await supabase.rpc("register_device", { p_device_id: id, p_label: label }));
}
// "free mode": everything open, no subscription needed (switch in the admin panel)
export async function freeMode() {
  try {
    const { data, error } = await supabase.from("app_settings").select("free_mode").eq("id", 1).maybeSingle();
    return !error && !!data?.free_mode;
  } catch { return false; }
}
export async function counts(track) {
  return must(await supabase.rpc("question_counts", { p_track: track }));
}
// a page of questions; topic optional; ids optional (mistakes, saved, mock)
export async function questions({ track, topic = null, afterId = 0, limit = 20, ids = null }) {
  return must(await supabase.rpc("get_questions", { p_track: track, p_topic: topic, p_after_id: afterId, p_limit: limit, p_ids: ids }));
}
export async function questionsByIds(track, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 25) out.push(...(await questions({ track, ids: ids.slice(i, i + 25), limit: 25 })));
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => order.get(a.id) - order.get(b.id));
}
export async function unansweredIds(track, n = 20) {
  return must(await supabase.rpc("unanswered_ids", { p_track: track, p_n: n }));
}
export async function mockIds(track, n = 50) {
  return must(await supabase.rpc("mock_ids", { p_track: track, p_n: n }));
}
export async function myAnswers(uid, track) {
  // up to 5000 rows: id + correct only
  return must(await supabase.from("answers").select("question_id, correct").eq("user_id", uid).eq("track", track).limit(5000));
}
export async function saveAnswer(uid, track, qid, picked, correct) {
  must(await supabase.from("answers").upsert({ user_id: uid, track, question_id: qid, picked, correct, answered_at: new Date().toISOString() }));
}
export async function myBookmarks(uid, track) {
  return must(await supabase.from("bookmarks").select("question_id").eq("user_id", uid).eq("track", track).limit(5000)).map((r) => r.question_id);
}
export async function setBookmark(uid, track, qid, on) {
  if (on) must(await supabase.from("bookmarks").upsert({ user_id: uid, track, question_id: qid }));
  else must(await supabase.from("bookmarks").delete().eq("user_id", uid).eq("question_id", qid));
}
export async function report(uid, qid, note = null) {
  must(await supabase.from("reports").insert({ user_id: uid, question_id: qid, note }));
}
export async function saveMock(uid, track, score, total) {
  must(await supabase.from("mock_results").insert({ user_id: uid, track, score, total }));
}
export async function bestMock(uid, track) {
  const rows = must(await supabase.from("mock_results").select("score,total").eq("user_id", uid).eq("track", track).limit(500));
  return rows.length ? Math.max(...rows.map((r) => Math.round((r.score / r.total) * 100))) : null;
}
export async function sendMessage(uid, email, track, body) {
  must(await supabase.from("messages").insert({ user_id: uid || null, email, track: track || null, body }));
}
export async function redeem(code) {
  return must(await supabase.rpc("redeem_code", { p_code: code }));
}
export async function deleteAccount() {
  must(await supabase.rpc("delete_my_account"));
}

/* ---------- exams, activity, history ---------- */
export async function examIds(track, n, topics = null, pool = "all") {
  return must(await supabase.rpc("exam_ids", { p_track: track, p_n: n, p_topics: topics?.length ? topics : null, p_pool: pool }));
}
export async function createExam(row) {
  return must(await supabase.from("exams").insert(row).select("*").single());
}
export async function updateExam(id, patch) {
  must(await supabase.from("exams").update(patch).eq("id", id));
}
export async function deleteExam(id) {
  must(await supabase.from("exams").delete().eq("id", id));
}
export async function myExams(uid, track) {
  return must(await supabase.from("exams").select("*").eq("user_id", uid).eq("track", track).order("created_at", { ascending: false }).limit(500));
}
export async function activity(uid, track, days = 14) {
  const from = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  try { return must(await supabase.from("activity").select("day,n,correct").eq("user_id", uid).eq("track", track).gte("day", from).order("day")); }
  catch { return []; }
}
export async function answerHistory(uid, track) {
  try { return must(await supabase.from("answers").select("question_id,picked,correct,first_correct,attempts,answered_at").eq("user_id", uid).eq("track", track).order("answered_at", { ascending: false }).limit(5000)); }
  catch { return must(await supabase.from("answers").select("question_id,picked,correct,answered_at").eq("user_id", uid).eq("track", track).order("answered_at", { ascending: false }).limit(5000)); }
}
export async function resetProgress(track) {
  must(await supabase.rpc("reset_my_progress", { p_track: track }));
}
export async function topicStats(track) {
  return must(await supabase.rpc("my_topic_stats", { p_track: track }));
}
export async function searchQuestions(track, q) {
  return must(await supabase.rpc("search_questions", { p_track: track, p_q: q }));
}

/* ---------- daily mission + spaced repetition ---------- */
export async function setTz(tz) {
  try { await supabase.rpc("set_my_tz", { p_tz: tz }); } catch { /* older database */ }
}
export async function dailyMission(track, n = 10) {
  return must(await supabase.rpc("get_daily_mission", { p_track: track, p_n: n }));
}
// index is 0-based here (1-based in SQL); returns true/false, checked on the server
export async function missionAnswer(track, index, pick) {
  return must(await supabase.rpc("mission_answer", { p_track: track, p_index: index + 1, p_pick: pick }));
}
export async function completeMission(track) {
  return must(await supabase.rpc("complete_daily_mission", { p_track: track }));
}
export async function missionDays(uid, track, days = 60) {
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  try { return must(await supabase.from("daily_missions").select("day,status,correct,ids").eq("user_id", uid).eq("track", track).gte("day", from).order("day")); }
  catch { return []; }
}
export async function dueReviews(uid, track, limit = 20) {
  return must(await supabase.from("review_items").select("question_id,box,due").eq("user_id", uid).eq("track", track).lte("due", new Date().toLocaleDateString("en-CA")).order("due").limit(limit));
}

/* ---------- study plan ---------- */
export async function getPlan(uid, track) {
  // throws when the database has no plan table yet (the app then hides the feature)
  return must(await supabase.from("study_plans").select("*").eq("user_id", uid).eq("track", track).maybeSingle());
}
export async function savePlan(track, exam, minutes, days, weak) {
  return must(await supabase.rpc("save_study_plan", { p_track: track, p_exam: exam, p_minutes: minutes, p_days: days, p_weak: weak }));
}
