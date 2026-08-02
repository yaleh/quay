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
// M09-gh-write (PR-ABI-002 fix, github-client.js#get()): get() now ALSO
// issues a paged list call (`gh api repos/<owner>/<repo>/issues -X GET -f
// state=all -f per_page=<n> -f page=<n>`, the same call list() already
// made) to build a parentIndex, since get() no longer leaves `parent`
// unconditionally null. This fixture's task_check-only scope never exercises
// `parent` (checkGate() only reads status/body), so the list call is
// answered with an EMPTY page (a well-formed, immediately-terminating single
// page) rather than real fixture data -- get()'s returned view-model's
// `parent` will be null (no other issue's body references it), which is
// irrelevant to every assertion this file makes (all of which check
// status/gate/childrenStatus, never `parent`).
const args = process.argv.slice(2);
if (args[0] === "api" && args.length === 2 && /^repos\/[^/]+\/[^/]+\/issues\/\d+$/.test(args[1])) {
  if (process.env.FAKE_GH_ISSUES_JSON) {
    const m = /\/issues\/(\d+)$/.exec(args[1]);
    const issues = JSON.parse(process.env.FAKE_GH_ISSUES_JSON);
    const issue = issues[m[1]];
    if (issue === undefined) {
      // Mimic gh's own single-issue-miss: github-client.js#get() catches the
      // exec failure and returns null ("no such task"), exactly as it does
      // for a live 404.
      process.stderr.write(`gh: Not Found (HTTP 404)\n`);
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(issue));
    process.exit(0);
  }
  process.stdout.write(process.env.FAKE_GH_ISSUE_JSON || "{}");
  process.exit(0);
}
if (args[0] === "api" && args[1] && args[1].endsWith("/issues")) {
  // Paged list call (used by list()'s fetchAllIssues AND by PR-ABI-002's
  // get()-side parentIndex build).
  const listUrl = args[1];
  if (listUrl === "repos/yaleh/quay-fixture/issues") {
    // task-check-passthrough's get()-side parentIndex build. Always answer
    // with an empty page -- terminates pagination immediately (pageIssues'
    // own "batch.length < perPage" break condition) and that fixture's
    // assertions never depend on `parent`.
    process.stdout.write("[]");
    process.exit(0);
  }
  if (listUrl === "repos/nonexistent-owner-xyz-123/nonexistent-repo-abc/issues") {
    // QN-064's unreachable-owner/repo failure path: mimic gh's live 404 so
    // the failure is a well-formed single page that fetchAllIssues() chokes
    // on, matching the assertion that gh's own diagnostic appears on stderr.
    process.stderr.write(`gh: Not Found (HTTP 404)\n`);
    process.exit(1);
  }
  if (process.env.FAKE_GH_ISSUES_JSON) {
    // cli.test.mjs / mcp-server.test.mjs (gap-suite-speedup hermetic
    // conversion): serve the full fixture issue set as the page content so
    // task_list / task_get / task_check all resolve against the same canned
    // data, with zero live network. One page suffices (pageIssues breaks
    // when batch.length < per_page).
    const issues = JSON.parse(process.env.FAKE_GH_ISSUES_JSON);
    process.stdout.write(JSON.stringify(Object.values(issues)));
    process.exit(0);
  }
}
process.stderr.write(`fake-gh: unsupported invocation (this fixture only supports a single-issue GET, or a paged list): ${JSON.stringify(args)}\n`);
process.exit(1);
