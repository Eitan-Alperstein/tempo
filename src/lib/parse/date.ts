import * as chrono from "chrono-node";
import { hm, localDate } from "../time";
import { claim, type Working } from "./util";

// Short words that are dates only sometimes ("Wear sun hat", "May's essay").
const RISKY = /^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat|jan|feb|mar|apr|may|jun|june|jul|july|aug|sep|sept|oct|nov|dec|march|august)$/i;
const DATE_PREPOSITION = /(?:^|\s)(on|by|due|this|next|until|before)\s*$/i;

// Phrases chrono doesn't know but people type.
const CASUAL: { re: RegExp; date: (now: Date) => Date }[] = [
  { re: /\b(?:eod|end of (?:the )?day)\b/i, date: (n) => n },
];

/**
 * Dates and times. A time range ("4–5pm") becomes a scheduled block. A single
 * explicit time becomes a due time, flagged as ambiguous so the preview can
 * offer to schedule it instead. Vague times ("tonight", "morning") keep only
 * the date.
 */
export function extractDate(w: Working, now: Date) {
  for (const c of CASUAL) {
    const m = w.text.match(c.re);
    if (m && m.index !== undefined) {
      w.result.dueDate = localDate(c.date(now));
      claim(w, m.index, m.index + m[0].length);
      return;
    }
  }

  const results = chrono.parse(w.text, now, { forwardDate: true });
  for (const r of results) {
    const before = w.text.slice(0, r.index);
    if (RISKY.test(r.text.trim()) && !DATE_PREPOSITION.test(before)) {
      w.result.ambiguities.push({ kind: "maybe-date", text: r.text.trim() });
      continue;
    }

    const start = r.start.date();
    const hasTime = r.start.isCertain("hour");
    if (r.end && hasTime) {
      w.result.schedDate = localDate(start);
      w.result.schedStartTime = hm(start);
      w.result.schedEndTime = hm(r.end.date());
    } else {
      w.result.dueDate = localDate(start);
      if (hasTime) {
        w.result.dueTime = hm(start);
        w.result.ambiguities.push({ kind: "time-role", text: r.text.trim() });
      }
    }
    claim(w, r.index, r.index + r.text.length);
    return;
  }
}
