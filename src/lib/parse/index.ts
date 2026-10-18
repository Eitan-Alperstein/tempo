/**
 * Natural-language quick add. Fully local and deterministic.
 *
 * The input goes through a pipeline of extractors. Each one claims a span of
 * text, records a field, and removes the span; whatever nobody claims stays in
 * the title, so text is never silently thrown away. Extractors run in a fixed
 * order: durations first (so "45 minutes" isn't read as "45 minutes from now"),
 * then importance, project and finally dates.
 */
import type { Project } from "../types";
import { extractDate } from "./date";
import { extractDuration } from "./duration";
import { extractImportance } from "./importance";
import { extractProject } from "./project";
import type { Working } from "./util";

export interface ParseContext {
  now: Date;
  projects: Project[];
}

export type Ambiguity =
  /** A bare time like "at 3pm": due then, or a time block starting then? */
  | { kind: "time-role"; text: string }
  /** A word that might be a date or might belong in the title, like "May". */
  | { kind: "maybe-date"; text: string }
  /** "#name" with no matching project. */
  | { kind: "unknown-project"; text: string };

export interface ParsedTask {
  title: string;
  estimateMin?: number;
  dueDate?: string;
  dueTime?: string;
  /** Local start/end times on `schedDate` for a time block. */
  schedDate?: string;
  schedStartTime?: string;
  schedEndTime?: string;
  importance?: number;
  projectId?: string;
  ambiguities: Ambiguity[];
}

function tidyTitle(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+([,;.!?])/g, "$1")
    .replace(/([,;])(\s*[,;])+/g, "$1")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .trim();
}

export function parseTaskInput(input: string, ctx: ParseContext): ParsedTask {
  const w: Working = { text: ` ${input} `, result: { title: "", ambiguities: [] } };
  extractDuration(w);
  extractImportance(w);
  extractProject(w, ctx.projects);
  extractDate(w, ctx.now);
  const title = tidyTitle(w.text);
  // If everything was parsed away ("tomorrow"), keep the user's words as the title.
  w.result.title = title || input.trim();
  return w.result;
}
