#!/usr/bin/env node
// Fake `gh` CLI, for test isolation only — used exclusively by
// task-check-passthrough.test.mjs (QN-071) to drive quay-github's real MCP
// server/github-client.js/checkGate() through a real stdio subprocess
// WITHOUT any live network call or write against the real, read-only-fixture
// `yaleh/quay` issues #3/#4 (standing constraint, this project's own
// discipline — see write.test.mjs/cli.test.mjs/mcp-server.test.mjs header
// comments: "the real yaleh/quay issue backlog is too small/precious to
// target with destructive live writes... or, here, to safely coerce into an
// artificial needs-human/unrecognized-status shape").
//
// Understands exactly one invocation shape: a single-issue GET,
// `gh api repos/<owner>/<repo>/issues/<n>` — the only `gh api` call
// github-client.js's own get()/check() path makes (see its `ghApiJson([
// repos/${owner}/${repo}/issues/${number}])` call site). Returns the raw
// issue JSON supplied via the FAKE_GH_ISSUE_JSON environment variable
// (test-supplied per invocation), so each test case can construct exactly
// the on-the-wire issue shape it needs (arbitrary label/body content),
// mirroring the disclosed hand-edit-frontmatter technique QN-068/QN-069
// already used on the native-Provider side, applied here at the `gh api`
// process boundary instead of a task file's frontmatter (github-client.js
// has no on-disk file to hand-edit — issues live on GitHub's own servers).
//
// QN-072 (iteration 86): optionally supports a MULTI-issue fixture via
// FAKE_GH_ISSUES_JSON — a JSON object mapping issue number (string) ->
// issue JSON — needed to test a compound (epic) task's childrenStatus
// rollup, which calls get() once per child issue number, each expecting
// its own distinct labels/body. When FAKE_GH_ISSUES_JSON is set, it takes
// precedence and the requested issue number is looked up in that map (a
// missing key is a genuine test-authoring bug, not a "missing child" case
// — that case is exercised at the github-client.js level, not this
// fixture's, so it fails loudly rather than silently). When unset, falls
// back to the original single-issue FAKE_GH_ISSUE_JSON behavior unchanged
// (existing QN-071 callers are unaffected).
//
// Any other invocation (paging list calls, writes, etc.) is deliberately
// unsupported and exits non-zero with a clear message, so a test that
// accidentally exercises an unexpected code path fails loudly rather than
// silently returning nonsense data.
const args = process.argv.slice(2);
if (args[0] === "api" && args.length === 2 && /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(args[1])) {
  if (process.env.FAKE_GH_ISSUES_JSON) {
    const m = /\/issues\/(\d+)$/.exec(args[1]);
    const issues = JSON.parse(process.env.FAKE_GH_ISSUES_JSON);
    const issue = issues[m[1]];
    if (issue === undefined) {
      process.stderr.write(`fake-gh: FAKE_GH_ISSUES_JSON has no entry for issue number ${m[1]} (requested: ${args[1]})\n`);
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(issue));
    process.exit(0);
  }
  process.stdout.write(process.env.FAKE_GH_ISSUE_JSON || "{}");
  process.exit(0);
}
process.stderr.write(`fake-gh: unsupported invocation (this fixture only supports a single-issue GET): ${JSON.stringify(args)}\n`);
process.exit(1);
