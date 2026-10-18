import type { ParsedTask } from "./index";

export interface Working {
  text: string;
  result: ParsedTask;
}

/** Remove [start, end) from the working text, plus a dangling connector word just before it. */
export function claim(w: Working, start: number, end: number, connectors = /(?:^|\s)(by|on|at|due|until|before|for|in)\s*$/i) {
  let s = start;
  const before = w.text.slice(0, start);
  const m = before.match(connectors);
  if (m) s = start - m[0].length + (m[0].startsWith(" ") ? 1 : 0);
  w.text = `${w.text.slice(0, s)} ${w.text.slice(end)}`;
}
