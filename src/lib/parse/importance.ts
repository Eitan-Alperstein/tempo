import { claim, type Working } from "./util";

// Only explicit markers count: words like "important" inside a title stay put.
const RULES: { re: RegExp; importance: number }[] = [
  { re: /\b(?:top|highest|urgent)\s+priority\b/i, importance: 5 },
  { re: /\bhigh\s+priority\b/i, importance: 4 },
  { re: /\b(?:medium|normal)\s+priority\b/i, importance: 3 },
  { re: /\blow\s+priority\b/i, importance: 2 },
  { re: /\blowest\s+priority\b/i, importance: 1 },
  { re: /(?:^|\s)p([1-5])(?=\s|[,.]|$)/i, importance: 0 }, // p1 = 5 … p5 = 1
  { re: /(?:^|\s)(!{1,3})(?=\s|$)/, importance: 0 }, // ! = 4, !!! = 5
];

export function extractImportance(w: Working) {
  for (const r of RULES) {
    const m = w.text.match(r.re);
    if (!m || m.index === undefined) continue;
    let importance = r.importance;
    if (m[1]?.startsWith("!")) importance = m[1].length >= 3 ? 5 : 4;
    else if (m[1] && /^[1-5]$/.test(m[1])) importance = 6 - parseInt(m[1], 10);
    w.result.importance = importance;
    claim(w, m.index, m.index + m[0].length, /(?:^|\s)(with|as)\s*$/i);
    return;
  }
}
