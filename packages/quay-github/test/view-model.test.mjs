// @test-group product
// Unit tests for issueToViewModel's normalization rules (DESIGN.md §3), added
// in iteration 5 to close 3 bugs found by iteration-4's independent audit:
//   1. parent/children were unconditionally null/empty (no mapping at all).
//   2. list() had no pagination/scale safety net.
//   3. multiple status:* labels on one issue silently used last-write-wins.
// This file exercises (1) and (3) directly against issueToViewModel /
// buildParentIndex-driven behavior via the exported functions. (2) is a
// structural change to createGithubClient's fetch loop and is exercised via
// direct code inspection + the DEFAULT_MAX_ISSUES/QUAY_GITHUB_MAX_ISSUES
// override documented in github-client.js (no live large-repo fixture is
// available to test the throw path without network access; see
// iteration-5.md for the honest scope note on this).
//
// Run: node test/view-model.test.mjs
import { issueToViewModel } from "../src/github-client.ts";

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function mkIssue(overrides) {
  return {
    number: 1,
    title: "test issue",
    body: "",
    state: "open",
    labels: [],
    html_url: "https://github.com/x/y/issues/1",
    user: { login: "someone" },
    ...overrides,
  };
}

// --- Bug #3: multiple status:* labels -- defined precedence, not last-write-wins ---

{
  // todo + ready (declared in "wrong" order to prove it's not last-write-wins)
  const vm = issueToViewModel(
    mkIssue({ labels: [{ name: "status:ready" }, { name: "status:todo" }] })
  );
  assert(vm.status === "ready", "precedence: ready beats todo regardless of label order (ready, todo)");
}

{
  const vm = issueToViewModel(
    mkIssue({ labels: [{ name: "status:todo" }, { name: "status:ready" }] })
  );
  assert(vm.status === "ready", "precedence: ready beats todo regardless of label order (todo, ready)");
}

{
  const vm = issueToViewModel(
    mkIssue({ labels: [{ name: "status:ready" }, { name: "status:needs-human" }] })
  );
  assert(vm.status === "needs-human", "precedence: needs-human beats ready");
}

{
  // closed still wins over everything, even with multiple conflicting labels
  const vm = issueToViewModel(
    mkIssue({ state: "closed", labels: [{ name: "status:ready" }, { name: "status:todo" }] })
  );
  assert(vm.status === "done", "closed-wins rule still holds with multiple status labels present");
}

{
  // single label, unaffected by the new precedence logic
  const vm = issueToViewModel(mkIssue({ labels: [{ name: "status:ready" }] }));
  assert(vm.status === "ready", "single status label still maps directly (no regression)");
}

{
  // no status label at all -> default todo (no regression)
  const vm = issueToViewModel(mkIssue({ labels: [{ name: "lane:execution" }] }));
  assert(vm.status === "todo", "no status label defaults to todo (no regression)");
}

// --- iteration 63 (QN-067): unrecognized status:* label value fallback ---
// The precedence comment above STATUS_PRECEDENCE documents that an
// unrecognized label value (not present in STATUS_PRECEDENCE at all) is
// "treated as lowest precedence, in the order encountered, below all
// recognized ones" -- but until this test, no case ever combined a
// recognized label with an unrecognized one, so this fallback branch of the
// sort comparator was never actually exercised.

{
  const vm = issueToViewModel(
    mkIssue({ labels: [{ name: "status:ready" }, { name: "status:some-typo-value" }] })
  );
  assert(vm.status === "ready", "unrecognized status label ranks below a recognized one (recognized first, unrecognized second)");
}

{
  const vm = issueToViewModel(
    mkIssue({ labels: [{ name: "status:some-typo-value" }, { name: "status:ready" }] })
  );
  assert(vm.status === "ready", "unrecognized status label ranks below a recognized one (unrecognized first, recognized second -- not last-write-wins)");
}

{
  // two unrecognized values, neither in STATUS_PRECEDENCE at all. The
  // precedence sort still ranks them equal (stable-sort "first encountered"),
  // but the parse-boundary guard (gap-abi-status-lifecycle-vocab-scattered-
  // no-named-type) then REJECTS the illegal value: it fails closed to `todo`
  // rather than surfacing an unreadable status label as a legal-looking
  // Task.status (hard rule 3b — an unreadable value must not look valid).
  const vm = issueToViewModel(
    mkIssue({ labels: [{ name: "status:alpha-unrecognized" }, { name: "status:beta-unrecognized" }] })
  );
  assert(vm.status === "todo", "two unrecognized status labels: fail-closed to todo (illegal value never surfaces as a legal-looking status)");
}

// --- Bug #1: parent/children via task-list checkbox convention ---

{
  const epic = mkIssue({
    number: 20,
    body: "Epic body\n- [ ] #21\n- [x] #22\n- [ ] #21\nmore text",
  });
  const vm = issueToViewModel(epic);
  assert(JSON.stringify(vm.children) === JSON.stringify(["gh-21", "gh-22"]), "children parsed from checkbox refs, de-duplicated, order preserved");
  assert(vm.role === "compound", "role derives to compound when children present (design §2 convention, extended to github Provider)");
}

{
  const leaf = mkIssue({ number: 21, body: "no checkboxes here" });
  const vm = issueToViewModel(leaf);
  assert(JSON.stringify(vm.children) === "[]", "no checkbox refs -> empty children");
  assert(vm.role === "primitive", "role derives to primitive when no children (no regression)");
}

{
  // parent resolution via a precomputed parentIndex (as list() builds it)
  const parentIndex = new Map([["gh-21", ["gh-20"]]]);
  const child = mkIssue({ number: 21, body: "" });
  const vm = issueToViewModel(child, parentIndex);
  assert(vm.parent === "gh-20", "parent populated from caller-supplied parentIndex (built by list() via buildParentIndex)");
}

{
  // single-issue get() path: no parentIndex available -> parent stays null (documented limitation)
  const child = mkIssue({ number: 21, body: "" });
  const vm = issueToViewModel(child, null);
  assert(vm.parent === null, "parent is null when no parentIndex supplied (documented single-issue get() limitation)");
}

{
  // ambiguous case: two "parents" reference the same child -> first wins, surfaced in extra
  const parentIndex = new Map([["gh-21", ["gh-20", "gh-30"]]]);
  const child = mkIssue({ number: 21, body: "" });
  const vm = issueToViewModel(child, parentIndex);
  assert(vm.parent === "gh-20", "ambiguous multi-parent: first-found wins (documented rule)");
  assert(JSON.stringify(vm.extra.multipleParents) === JSON.stringify(["gh-20", "gh-30"]), "ambiguity surfaced via extra.multipleParents rather than silently dropped");
}

// --- Iteration 59 (QN-063): null/undefined body -- a genuinely distinct,
// previously-uncovered shape from the "" (empty-string) body every fixture
// above uses. GitHub's real `gh api` response sets `body: null` (not "") for
// an issue created with no description at all -- this is the actual,
// realistic malformed-input shape, not merely a stand-in for "empty".
// issueToViewModel() defends against this via `issue.body ?? ""` (line 140);
// this was previously completely unexercised (confirmed this iteration via
// `grep -n "body: null\|body: undefined" packages/quay-github/test/*.mjs`
// returning zero hits before this block was added).

{
  const noBody = mkIssue({ number: 40, body: null });
  const vm = issueToViewModel(noBody);
  assert(vm.body === "", "null issue.body normalizes to empty string, not null/crash");
  assert(JSON.stringify(vm.children) === "[]", "null issue.body yields empty children (no crash in extractChildRefs)");
  assert(vm.role === "primitive", "null-body issue derives role: primitive (no children)");
}

{
  const noBody = mkIssue({ number: 41, body: undefined });
  const vm = issueToViewModel(noBody);
  assert(vm.body === "", "undefined issue.body normalizes to empty string, not undefined/crash");
  assert(JSON.stringify(vm.children) === "[]", "undefined issue.body yields empty children (no crash in extractChildRefs)");
}

console.log(failures === 0 ? "All quay-github view-model tests passed" : `${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
