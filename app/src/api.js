import { createClient } from "@supabase/supabase-js";

const URL = window.__env.VITE_SUPABASE_URL;
const KEY = window.__env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } });

function must({ data, error }) { if (error) throw error; return data; }

export const auth = {
  session: async () => (await supabase.auth.getSession()).data.session,
  signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
  signUp: (email, password) => supabase.auth.signUp({ email, password }),
  reset: (email) => supabase.auth.resetPasswordForEmail(email),
  signOut: () => supabase.auth.signOut(),
  onChange: (fn) => supabase.auth.onAuthStateChange(fn),
};

export async function getProfile(uid) {
  return must(await supabase.from("profiles").select("*").eq("id", uid).single());
}
export async function updateProfile(lang, examDate) {
  must(await supabase.rpc("update_my_profile", { p_lang: lang ?? null, p_exam_date: examDate ?? null }));
}
export async function registerDevice(id, label) {
  return must(await supabase.rpc("register_device", { p_device_id: id, p_label: label }));
}
export async function counts() {
  return must(await supabase.rpc("question_counts"));
}
// a page of questions; topic optional; ids optional (mistakes, saved, mock)
export async function questions({ topic = null, afterId = 0, limit = 20, ids = null } = {}) {
  return must(await supabase.rpc("get_questions", { p_topic: topic, p_after_id: afterId, p_limit: limit, p_ids: ids }));
}
export async function questionsByIds(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 25) out.push(...(await questions({ ids: ids.slice(i, i + 25), limit: 25 })));
  const order = new Map(ids.map((id, i) => [id, i]));
  return out.sort((a, b) => order.get(a.id) - order.get(b.id));
}
export async function mockIds(n = 50) {
  return must(await supabase.rpc("mock_ids", { p_n: n }));
}
export async function myAnswers(uid) {
  // up to 5000 rows: id + correct only
  return must(await supabase.from("answers").select("question_id, correct").eq("user_id", uid).limit(5000));
}
export async function saveAnswer(uid, qid, picked, correct) {
  must(await supabase.from("answers").upsert({ user_id: uid, question_id: qid, picked, correct, answered_at: new Date().toISOString() }));
}
export async function myBookmarks(uid) {
  return must(await supabase.from("bookmarks").select("question_id").eq("user_id", uid).limit(5000)).map((r) => r.question_id);
}
export async function setBookmark(uid, qid, on) {
  if (on) must(await supabase.from("bookmarks").upsert({ user_id: uid, question_id: qid }));
  else must(await supabase.from("bookmarks").delete().eq("user_id", uid).eq("question_id", qid));
}
export async function report(uid, qid, note = null) {
  must(await supabase.from("reports").insert({ user_id: uid, question_id: qid, note }));
}
export async function saveMock(uid, score, total) {
  must(await supabase.from("mock_results").insert({ user_id: uid, score, total }));
}
export async function bestMock(uid) {
  const rows = must(await supabase.from("mock_results").select("score,total").eq("user_id", uid).limit(500));
  return rows.length ? Math.max(...rows.map((r) => Math.round((r.score / r.total) * 100))) : null;
}
export async function redeem(code) {
  return must(await supabase.rpc("redeem_code", { p_code: code }));
}
export async function deleteAccount() {
  must(await supabase.rpc("delete_my_account"));
}
