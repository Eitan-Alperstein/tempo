import { claim, type Working } from "./util";

const H = "(?:h|hr|hrs|hour|hours)";
const M = "(?:m|min|mins|minute|minutes)";

// Ordered from most to least specific; the first match wins.
const PATTERNS: { re: RegExp; minutes: (m: RegExpMatchArray) => number }[] = [
  // 1h30, 1h 30m, 1 hour 30 minutes, 1 hr and 15 min
  {
    re: new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${H}\\s*(?:and\\s+)?(\\d{1,2})\\s*(?:${M})?\\b`, "i"),
    minutes: (m) => Math.round(parseFloat(m[1]) * 60) + parseInt(m[2], 10),
  },
  // 1.5 hours, 2h
  { re: new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*${H}\\b`, "i"), minutes: (m) => Math.round(parseFloat(m[1]) * 60) },
  // 45 minutes, 45m, 90 mins
  { re: new RegExp(`\\b(\\d{1,3})\\s*${M}\\b`, "i"), minutes: (m) => parseInt(m[1], 10) },
  // an hour and a half
  { re: /\b(?:an?|one)\s+hour\s+and\s+a\s+half\b/i, minutes: () => 90 },
  // half an hour, half hour
  { re: /\bhalf\s+(?:an\s+)?hour\b/i, minutes: () => 30 },
  // an hour, one hour
  { re: /\b(?:an?|one)\s+hour\b/i, minutes: () => 60 },
  // quarter of an hour
  { re: /\b(?:a\s+)?quarter\s+(?:of\s+an\s+)?hour\b/i, minutes: () => 15 },
];

export function extractDuration(w: Working) {
  for (const p of PATTERNS) {
    const m = w.text.match(p.re);
    if (!m || m.index === undefined) continue;
    const minutes = p.minutes(m);
    if (minutes <= 0 || minutes > 24 * 60) continue;
    // "in 45 minutes" means a time, not an effort; leave it for the date parser.
    if (/\bin\s*$/i.test(w.text.slice(0, m.index))) continue;
    w.result.estimateMin = minutes;
    claim(w, m.index, m.index + m[0].length, /(?:^|\s)(for|takes?|about|~)\s*$/i);
    return;
  }
}
