// search-index.ts — the ONE definition of the heading-stripping text
// normalisation every search surface shares.
//
// gap-stripheadings-quadruple-duplication-cli-task-list-client-filter: the
// "strip structural heading lines before matching a search needle" logic had
// been re-written independently in FOUR places — Core's cli/flags.ts,
// mcp-handlers.ts, serve-render.ts, and the native store's private
// `stripHeadingsForSearch`. The copies had ALREADY drifted once: QX-041
// (SH-003) added the inFence carve-out to serve.ts but not to the others, and
// QX-044 had to chase the same fix into mcp-server.ts's inline copy (SH-005).
// That is the defect class this module closes: one definition, every caller
// imports it, so a fix can no longer reach one surface and miss another.
//
// Why the definition lives in Core and not in the native store's copy (which
// the task suggested as the canonical one): `quay-native` DEPENDS ON `quay`
// (packages/quay-native/package.json), so Core importing the store's copy would
// be a package cycle and would break Core's provider-agnosticism. The native
// store already reaches Core leaf modules by relative path (`../quay/src/abi.ts`,
// `task-parsing.ts`, `store-commit.ts` — the product layer next to this file),
// so this is the direction the dependency graph already runs. The SEMANTICS are
// byte-for-byte the store's copy (and serve-render's), i.e. the fence-aware
// version QX-041 fixed.
//
// Semantics: heading lines (`/^#+\s/`) OUTSIDE fenced code blocks are removed
// before a task body is used as a search index, so template section names
// (`## Proposal`, `## Plan`, `## AC`, `## DoD`) do not produce false positives
// when a user searches for those words. `# comment` lines INSIDE a ``` fence
// are code content and stay searchable. Surviving lines are joined with a
// single space so a needle can still span where a heading was removed.
export function stripHeadings(text: string | undefined | null): string {
  let inFence = false;
  return (text || "").split("\n").filter((line) => {
    if (/^```/.test(line)) { inFence = !inFence; return true; }
    if (inFence) return true; // preserve code content (including # comment lines)
    return !/^#+\s/.test(line); // strip structural headings outside fences
  }).join(" ");
}
