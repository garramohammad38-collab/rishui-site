// Dosage-calculation trainer: new numbers every time, 4 options, worked solution.
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const r1 = (x) => Math.round(x * 10) / 10;
const fmt = (x) => (Number.isInteger(x) ? String(x) : String(r1(x)));

function options(right, wrongs, unit) {
  const set = new Set([fmt(right)]);
  for (const w of wrongs) { const v = fmt(w); if (w > 0 && !set.has(v)) set.add(v); if (set.size === 4) break; }
  let k = 2; while (set.size < 4) { const v = fmt(r1(right * (k % 2 ? 1 + k / 10 : 1 - k / 20))); if (+v > 0) set.add(v); k++; }
  const list = [...set].sort(() => Math.random() - 0.5);
  return { o: list.map((v) => `${v} ${unit}`), answer: list.indexOf(fmt(right)) };
}

const GEN = [
  // oral liquid
  () => {
    const H = pick([125, 250]), V = 5, D = H * pick([0.5, 1.5, 2, 3]);
    const x = (D / H) * V;
    return {
      he: `מרשם: ${D} מ״ג דרך הפה. זמין: סירופ ${H} מ״ג ב-${V} מ״ל. כמה מ״ל תיתן?`,
      en: `Order: ${D} mg PO. Available: syrup ${H} mg per ${V} mL. How many mL?`,
      unit: { he: "מ״ל", en: "mL" }, right: x, wrong: [D / H, (H / D) * V, x * 2, x / 2],
      sol: `(${D} ÷ ${H}) × ${V} = ${fmt(x)}`,
    };
  },
  // tablets
  () => {
    const H = pick([5, 10, 25, 50, 100, 250, 500]), n = pick([0.5, 1.5, 2, 3]), D = H * n;
    return {
      he: `מרשם: ${D} מ״ג. כל טבליה מכילה ${H} מ״ג. כמה טבליות תיתן?`,
      en: `Order: ${D} mg. Each tablet is ${H} mg. How many tablets?`,
      unit: { he: "טבליות", en: "tablets" }, right: n, wrong: [n * 2, n / 2, n + 1, H / D],
      sol: `${D} ÷ ${H} = ${fmt(n)}`,
    };
  },
  // injection from a vial
  () => {
    const per = pick([2, 4, 5, 10, 20, 40]), D = per * pick([0.5, 1.5, 2, 2.5]);
    const x = D / per;
    return {
      he: `מרשם: ${D} מ״ג בזריקה. בבקבוקון ${per} מ״ג למ״ל. כמה מ״ל תשאב?`,
      en: `Order: ${D} mg by injection. The vial has ${per} mg/mL. How many mL?`,
      unit: { he: "מ״ל", en: "mL" }, right: x, wrong: [per / D, x * 2, D * per, x + 1],
      sol: `${D} ÷ ${per} = ${fmt(x)}`,
    };
  },
  // drip rate
  () => {
    const V = pick([250, 500, 1000]), h = pick([2, 4, 5, 6, 8]), f = pick([10, 15, 20, 60]);
    const x = Math.round((V * f) / (h * 60));
    return {
      he: `יש להעביר ${V} מ״ל במשך ${h} שעות, בערכה עם מקדם טפטוף ${f} טיפות למ״ל. מה קצב הטפטוף (עגל למספר שלם)?`,
      en: `Infuse ${V} mL over ${h} hours with a ${f} gtt/mL set. Drip rate (round to a whole number)?`,
      unit: { he: "טיפות לדקה", en: "gtt/min" }, right: x, wrong: [Math.round(V / h), Math.round((V * f) / h), Math.round(V / (h * 60)), x * 2],
      sol: `(${V} × ${f}) ÷ (${h} × 60) = ${r1((V * f) / (h * 60))} ≈ ${x}`,
    };
  },
  // pump rate
  () => {
    const h = pick([2, 4, 5, 8, 10, 12]), V = h * pick([25, 50, 75, 100, 125]);
    const x = V / h;
    return {
      he: `יש להעביר ${V} מ״ל בעירוי במשאבה במשך ${h} שעות. מה הקצב במ״ל לשעה?`,
      en: `Infuse ${V} mL by pump over ${h} hours. Rate in mL/h?`,
      unit: { he: "מ״ל לשעה", en: "mL/h" }, right: x, wrong: [x * 2, V / (h * 60), x / 2, x + 25],
      sol: `${V} ÷ ${h} = ${fmt(x)}`,
    };
  },
  // weight-based dose
  () => {
    const kg = pick([8, 10, 12, 15, 20, 25, 30]), mgkg = pick([5, 10, 15, 20]), D = kg * mgkg;
    return {
      he: `ילד במשקל ${kg} ק״ג. המינון ${mgkg} מ״ג לק״ג. כמה מ״ג לתת?`,
      en: `A child weighs ${kg} kg. The dose is ${mgkg} mg/kg. How many mg?`,
      unit: { he: "מ״ג", en: "mg" }, right: D, wrong: [D * 2, D / 2, kg + mgkg, Math.round(D * 2.2)],
      sol: `${mgkg} × ${kg} = ${fmt(D)}`,
    };
  },
  // weight in pounds
  () => {
    const kg = pick([50, 60, 70, 80, 90]), lb = Math.round(kg * 2.2), mgkg = pick([1, 2, 5]), D = kg * mgkg;
    return {
      he: `מטופל שוקל ${lb} פאונד. המינון ${mgkg} מ״ג לק״ג. כמה מ״ג לתת? (1 ק״ג = 2.2 פאונד)`,
      en: `A patient weighs ${lb} lb. The dose is ${mgkg} mg/kg. How many mg? (1 kg = 2.2 lb)`,
      unit: { he: "מ״ג", en: "mg" }, right: D, wrong: [lb * mgkg, Math.round(D / 2.2), D * 2, D + 10],
      sol: `${lb} ÷ 2.2 = ${kg} kg → ${kg} × ${mgkg} = ${D}`,
    };
  },
];

export function calcQuestion(lang) {
  const g = pick(GEN)();
  const { o, answer } = options(g.right, g.wrong, g.unit[lang]);
  return { q: g[lang], o, answer, sol: g.sol };
}
