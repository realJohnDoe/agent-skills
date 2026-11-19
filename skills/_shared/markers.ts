// How every skill reads the workshop's shared conventions on issues and comments: the
// digest issue, the pause label, marker comments, and an issue body's open question.
// The `conventions` skill says what to set; this file and the dispatcher's decide.ts
// say how it is read.

export const PAUSE_LABEL = "workshop-paused";
// An issue that needs the maintainer to decide something says so in its body.
export const DECISION = "Decision needed";

export const isDigest = (title: string) => /^(Workshop|Farm) digest/.test(title);

// Comments written before the farm → workshop rename still carry `farm-` markers.
export const marked = (c: { body: string }, m: string) =>
  c.body.includes(m) || c.body.includes(m.replace("workshop", "farm"));

// The first paragraph of a body's `## <heading>` section, on one line and cut
// to 200 characters; `heading` itself when the section is empty. Undefined when
// there is no section or `settled` matches it.
export const sectionParagraph = (
  body: string | null | undefined,
  heading: string,
  settled?: RegExp,
): string | undefined => {
  const m = (body ?? "").match(new RegExp(`^##\\s+${heading}\\s*$([^]*?)(?=^##\\s|(?![^]))`, "im"));
  if (!m || settled?.test(m[1])) return;
  const first = m[1].trim().split(/\n\s*\n/)[0].replace(/\s+/g, " ");
  return first.length > 200 ? `${first.slice(0, 199)}…` : first || heading;
};

/**
 * The open question in an issue body's `## Decision needed` section: its first
 * paragraph, or undefined when there is no section or it has a `Decided:` line.
 */
export const openQuestion = (body: string | null | undefined) =>
  sectionParagraph(body, DECISION, /^\s*(\*\*)?Decided:/im);

// A PR description that says a check was not run.
export const NOT_RUN = /\b(did not|didn't|not) (run|re-?run|re-?measured?|verified|tested)\b|\bunverified\b/i;

/** The sentence in `body` that says a check was not run, cut to 200 characters; undefined when none. */
export const notRunSentence = (body: string | null | undefined): string | undefined => {
  const s = (body ?? "").split(/(?<=[.!?])\s+|\n+/).find((x) => NOT_RUN.test(x));
  if (!s) return;
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > 200 ? `${t.slice(0, 199)}…` : t;
};
