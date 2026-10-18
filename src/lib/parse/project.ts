import type { Project } from "../types";
import { claim, type Working } from "./util";

const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");

/**
 * "#school" or "#Newspaper" assigns a project. Matching ignores case and
 * spaces, and accepts a unique prefix ("#eng" → Engineering). An unknown tag
 * is left in the title and flagged rather than dropped.
 */
export function extractProject(w: Working, projects: Project[]) {
  const m = w.text.match(/(?:^|\s)#([\p{L}\p{N}_-]+)/u);
  if (!m || m.index === undefined) return;
  const tag = norm(m[1]);
  const exact = projects.find((p) => norm(p.name) === tag);
  const prefixed = projects.filter((p) => norm(p.name).startsWith(tag));
  const match = exact ?? (prefixed.length === 1 ? prefixed[0] : undefined);
  if (!match) {
    w.result.ambiguities.push({ kind: "unknown-project", text: m[1] });
    return;
  }
  w.result.projectId = match.id;
  const start = m.index + (m[0].startsWith("#") ? 0 : 1);
  claim(w, start, m.index + m[0].length, /(?:^|\s)(in|for)\s*$/i);
}
