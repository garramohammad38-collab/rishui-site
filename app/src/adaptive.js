// Adaptive exam engine (Rasch / 1-parameter IRT). Pure functions, no DOM.
// theta = student's ability, b = question difficulty (higher = harder), P(correct) = sigmoid(theta - b)
export const ADAPT = { MIN: 85, MAX: 145, PASS: 0.6, PRIOR: 0.6, K: 6, Z: 1.96 };
const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));

// difficulty from real answers: share of students who got it right, smoothed toward the prior
export function difficulty(c, n) {
  const p = (Number(c) + ADAPT.PRIOR * ADAPT.K) / (Number(n) + ADAPT.K);
  return -logit(Math.min(0.97, Math.max(0.03, p)));
}

// MAP estimate of ability with a N(0, 1.5^2) prior so a few answers never send it to infinity
export function estimate(resp) {
  const s2 = 2.25;
  let th = 0;
  for (let it = 0; it < 30; it++) {
    let g = -th / s2, h = 1 / s2;
    for (const r of resp) { const p = sig(th - r.b); g += (r.ok ? 1 : 0) - p; h += p * (1 - p); }
    const step = g / h; th += Math.max(-1, Math.min(1, step));
    if (Math.abs(step) < 1e-6) break;
  }
  let info = 1 / s2;
  for (const r of resp) { const p = sig(th - r.b); info += p * (1 - p); }
  return { theta: th, se: 1 / Math.sqrt(info) };
}

// expected share of the whole question bank this ability would answer correctly (0..1)
export const expected = (theta, bs) => bs.length ? bs.reduce((a, b) => a + sig(theta - b), 0) / bs.length : 0.5;

// ability at which the expected bank score equals the passing score
export function passTheta(bs, pass = ADAPT.PASS) {
  let lo = -8, hi = 8;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (expected(m, bs) < pass) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// never before MIN questions; stop once clearly above/below the pass line; hard stop at MAX
export function verdict(n, theta, se, tPass) {
  const hi = theta - ADAPT.Z * se > tPass, lo = theta + ADAPT.Z * se < tPass;
  const done = n >= ADAPT.MAX || (n >= ADAPT.MIN && (hi || lo));
  return { done, level: hi ? "ready" : lo ? "notyet" : "close" };
}

// next question: closest to current ability, steered toward the topic with the fewest answers so far
export function pickNext(pool, seen, theta, topicN, rnd = Math.random) {
  const cand = pool.filter((q) => !seen.has(q.id)).sort((a, b) => Math.abs(a.b - theta) - Math.abs(b.b - theta)).slice(0, 12);
  if (!cand.length) return null;
  const least = Math.min(...cand.map((q) => topicN[q.topic] || 0));
  const fair = cand.filter((q) => (topicN[q.topic] || 0) === least).slice(0, 4);
  return fair[Math.floor(rnd() * fair.length)];
}
