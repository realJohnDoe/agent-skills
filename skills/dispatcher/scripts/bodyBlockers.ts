// Issues named as blockers in an issue body: the documented fallback to native
// dependencies (the repo's own issue-tracker docs), either a `Blocked by: #n, #m`
// line or a `## Blocked by` section of references. A reference is `#n` (in `repo`,
// the repo the body is in), `owner/repo#n` or a full `https://github.com/owner/repo/issues/n` URL.
export type Blocker = { repo: string; number: number };

const REF = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)|([\w.-]+\/[\w.-]+)?#(\d+)/g;

export const bodyBlockers = (body: string | null | undefined, repo: string): Blocker[] => {
  const text = body ?? "";
  const found = [
    ...text.matchAll(/^[ \t>*_-]*blocked by\b[*_]*:.*$/gim),
    ...text.matchAll(/^#{1,6}[ \t]+blocked by\b.*\n((?:(?!#{1,6}[ \t]).*\n?)*)/gim),
  ].flatMap((m) =>
    [...(m[1] ?? m[0]).matchAll(REF)].map((r) => ({
      repo: r[1] ?? r[3] ?? repo,
      number: +(r[2] ?? r[4]),
    })),
  );
  return [...new Map(found.map((b) => [`${b.repo.toLowerCase()}#${b.number}`, b])).values()];
};
