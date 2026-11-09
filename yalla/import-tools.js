// Import helpers for the admin panel: read rows from CSV / Excel (.xlsx) / JSON, and find duplicate questions.
// Pure functions (no DOM), so they can be tested outside the browser.
(function (root) {
  const LETTERS = { "א": 0, "ב": 1, "ג": 2, "ד": 3, a: 0, b: 1, c: 2, d: 3, "1": 0, "2": 1, "3": 2, "4": 3 };
  const YES = /^(1|true|yes|y|כן|نعم)$/i;

  // same question = same Hebrew text after removing spaces, punctuation and niqqud
  function normQ(s) {
    return String(s || "").toLowerCase().normalize("NFKD").replace(/[֑-ׇ]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
  }
  function parseTerms(s) {
    return String(s || "").split(/[;\n]/).map((x) => x.split("=").map((y) => y.trim())).filter((p) => p.length === 2 && p[0] && p[1]);
  }
  function answerIndex(v) {
    const k = String(v ?? "").trim().toLowerCase();
    return k in LETTERS ? LETTERS[k] : -1;
  }

  // rows = array of arrays (first row = header). Two layouts are accepted:
  // 1) the CSV layout: track, topic, answer, q_he, o1_he..o4_he, e_he, q_en, o1_en..o4_en, e_en, source, terms, is_free
  // 2) the Hebrew Excel template: נושא, השאלה, תשובה א..ד, התשובה הנכונה, הסבר, מקור, מונחים, שאלה חינמית?
  // ctx = { curTrack, tracks: [{id, he}], topicsBy: {track: {topicId: hebrewName}} }
  function rowsFromTable(table, ctx) {
    const [head, ...data] = table.filter((r) => r && r.some((x) => String(x ?? "").trim()));
    if (!head) return { rows: [], layout: null };
    const ix = Object.fromEntries(head.map((h, i) => [String(h ?? "").trim(), i]));
    const g = (r, k) => String(r[ix[k]] ?? "").trim();
    if ("q_he" in ix) {
      return {
        layout: "csv",
        rows: data.map((r, n) => ({
          line: n + 2,
          track: g(r, "track") || ctx.curTrack, topic: g(r, "topic"), answer: answerIndex(g(r, "answer")),
          he: { q: g(r, "q_he"), o: [1, 2, 3, 4].map((i) => g(r, "o" + i + "_he")), e: g(r, "e_he") },
          en: { q: g(r, "q_en"), o: [1, 2, 3, 4].map((i) => g(r, "o" + i + "_en")), e: g(r, "e_en") },
          terms: parseTerms(g(r, "terms")), source: g(r, "source"), is_free: YES.test(g(r, "is_free")),
        })),
      };
    }
    if ("השאלה" in ix) {
      const col = (r, name) => { const k = Object.keys(ix).find((h) => h.startsWith(name)); return k ? String(r[ix[k]] ?? "").trim() : ""; };
      return {
        layout: "template",
        rows: data.map((r, n) => {
          const { track, topic } = topicFromLabel(col(r, "נושא"), ctx);
          const he = { q: col(r, "השאלה"), o: ["תשובה א", "תשובה ב", "תשובה ג", "תשובה ד"].map((c) => col(r, c)), e: col(r, "הסבר") };
          // the template is Hebrew only: the English fields get the Hebrew text (flagged, so nothing is invented)
          return { line: n + 2, track, topic, answer: answerIndex(col(r, "התשובה הנכונה")), he, en: { q: he.q, o: [...he.o], e: he.e }, heOnly: true,
                   terms: parseTerms(col(r, "מונחים")), source: col(r, "מקור"), is_free: YES.test(col(r, "שאלה חינמית")) };
        }),
      };
    }
    return { rows: [], layout: null };
  }
  // "סיעוד · חישובי תרופות" -> { track: "nursing", topic: "calc" }; a bare topic id or name also works
  function topicFromLabel(label, ctx) {
    const parts = String(label || "").split("·").map((x) => x.trim()).filter(Boolean);
    let track = ctx.curTrack, name = parts.at(-1) || "";
    if (parts.length > 1) { const t = (ctx.tracks || []).find((x) => x.he === parts[0] || x.id === parts[0]); if (t) track = t.id; }
    const topics = (ctx.topicsBy || {})[track] || {};
    const id = name in topics ? name : Object.keys(topics).find((k) => topics[k] === name);
    return { track, topic: id || name };
  }

  // returns { inFile: Map(index -> first index), inDb: Map(index -> existing id) }
  function findDuplicates(rows, existing) {
    const seen = new Map(), inFile = new Map(), inDb = new Map();
    const db = new Map((existing || []).map((x) => [normQ(x.q), x.id]));
    rows.forEach((r, i) => {
      const k = normQ(r.he?.q);
      if (!k) return;
      if (seen.has(k)) inFile.set(i, seen.get(k)); else seen.set(k, i);
      if (db.has(k)) inDb.set(i, db.get(k));
    });
    return { inFile, inDb };
  }

  root.ImportTools = { normQ, parseTerms, answerIndex, rowsFromTable, topicFromLabel, findDuplicates };
  if (typeof module !== "undefined") module.exports = root.ImportTools;
})(typeof window !== "undefined" ? window : globalThis);
