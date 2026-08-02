// @test-group product
// QN-034 (iteration 24): regression test for `bin/quay-github.ts` itself —
// the GitHub Provider's own CLI dispatch layer (resolveRepo(), parseFlags(),
// the cmd/sub branch table for mcp/manifest/task list|get|edit|check, and
// the top-level main().catch(...) handler). Prior to this task, this file
// had ZERO automated test coverage anywhere in the repo: grepping every
// *.test.mjs file in all three packages for any reference to
// "quay-github.ts" or a subprocess spawn of it returned zero hits. This is
// the sibling gap to QN-033 (iteration 23), which closed the identical
// class of gap for packages/quay/bin/quay.js.
//
// Materially different shape than QN-030/031/032/033: every prior
// CLI-dispatch test spun up a fully isolated, disposable LOCAL fixture (a
// temp .quay/config.yml + temp tasks dir) with no external dependency.
// quay-github.ts's CLI has no local-fixture equivalent — createGithubClient()
// shells out to the real `gh api` for every operation; there is no
// dependency-injection seam in the CLI binary itself. Closing this gap at
// the CLI-subprocess level therefore requires live calls against the real
// yaleh/quay GitHub repo.
//
// EXPLICIT, LOAD-BEARING SCOPE CONSTRAINT (mirrors the existing
// write.test.mjs header comment for this package: "this repo's real issue
// count is too small/precious to safely target with destructive live
// writes in an automated, repeatable test file"): this file exercises ONLY
// CLI surfaces that are provably read-only or fail before any write call is
// reached. `task edit --status <s>` (the only write-capable CLI verb) is
// exercised ONLY via its missing-required-`--status`-flag error path (which
// returns before client.setStatus is ever called) — no invocation in this
// file ever supplies a valid --status value, so client.setStatus is NEVER
// reached and no live issue is ever mutated.
//
// Residual gaps, named honestly, NOT covered by this file:
// - The real `task edit --status <value>` write path itself
//   (client.setStatus, the label add/remove/close-vs-reopen branches) —
//   out of scope: exercising it live would mutate the real, precious
//   yaleh/quay issue backlog (same reasoning as write.test.mjs's own
//   existing scope note).
// - The `mcp` subcommand (starting the stdio MCP transport) — out of
//   scope: it starts a long-running stdio server process, a different
//   process-lifecycle shape than every other subcommand, which exit
//   promptly; killing/timing that out would test process-management noise
//   more than the dispatch logic itself.
//
// QN-064 (iteration 60) added test 9: a genuinely new negative-path angle
// from test 8's own malformed-QUAY_GITHUB_REPO test. Test 8 exercises
// resolveRepo()'s own synchronous throw, reached BEFORE any `gh api` call
// is ever attempted. Test 9 instead uses a well-FORMED but unreachable
// owner/repo (passes resolveRepo()'s own parse, so a real `gh api` network
// round-trip is attempted and genuinely fails with a live 404) — exercising
// list()'s completely unhandled `fetchAllIssues()` failure path (no
// try/catch, unlike get()'s already-caught not-found path). Distinct from
// QN-062 (iteration 58, Core's own Provider subprocess-startup-crash
// angle) and QN-063 (iteration 59, malformed input VALUE inside an
// existing, reachable issue's body) — this is a live `gh api` call FAILING
// mid-session, from a Provider process that started successfully.
//
// gap-suite-speedup (task gap-suite-speedup) — CONTRACT DECISION: this file
// now runs against the fake `gh` executable (test/fixtures/fake-gh.mjs,
// PATH-shadowed exactly as task-check-passthrough.test.mjs does), NOT the
// live yaleh/quay GitHub repo. Rationale: the live-network dependence was
// the dominant wall-clock cost (24.3s in CI, ~9s here) AND made the suite
// network-flaky, and the same fake-gh process-boundary injection
// task-check-passthrough introduced makes every read-only surface
// (`task list/get/check`, the manifest, the flag-validation errors, and
// QN-064's fetchAllIssues-failure path) exercisable hermetically with
// byte-identical behavior — github-client.js cannot tell the fake `gh`
// from the real one (it shells out via execFileSync("gh", ...) either way).
// Every assertion below is preserved unchanged; only the data source moved
// from the live repo to the canned fixture. The fake gh fails for the
// unreachable-owner repo (test 9) with gh's own "gh: Not Found (HTTP 404)"
// diagnostic, preserving the fetchAllIssues-failure-path exercise. The
// residual gap that was previously "the real CLI against real GitHub" is
// covered by the repo's opt-in live files (QUAY_TEST_LIVE_GITHUB=1) rather
// than by this default-suite file.
//
// Run: node test/cli.test.mjs
// Precondition (removed by gap-suite-speedup): `gh auth status` was a
// standing stage-2+ precondition; this file no longer needs it.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(__dirname, "..", "bin", "quay-github.ts");
const fakeGhScript = path.join(__dirname, "fixtures", "fake-gh.mjs");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

/** Build a fresh PATH-shadow dir containing exactly one executable named
 * `gh` that delegates to fixtures/fake-gh.mjs. A fresh dir per test run
 * avoids any cross-test/cross-process race on a shared shim location. */
function makeFakeGhPathDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quay-fake-gh-path-"));
  const shimPath = path.join(dir, "gh");
  fs.writeFileSync(
    shimPath,
    `#!/bin/sh\nexec node "${fakeGhScript}" "$@"\n`,
    { mode: 0o755 }
  );
  return dir;
}

// Canned fixture issues #3/#4 served by fake-gh.mjs for the yaleh/quay
// backing repo (the numbers/ids the assertions expect). Realistic enough to
// make check()/get() produce well-formed view-models; content is otherwise
// irrelevant to the assertions (which check id/title presence, boolean ok,
// and exit-code mirroring, never specific live-repo content).
const FIXTURE_ISSUES = {
  3: {
    number: 3,
    title: "fixture issue 3",
    body:
      "## Proposal\nfixture proposal\n" +
      "## Plan\nfixture plan\n" +
      "## AC\n- [ ] an unchecked acceptance criterion\n" +
      "## DoD\n- [x] a checked definition of done\n",
    labels: [{ name: "status:ready" }],
    state: "open",
    pull_request: undefined,
    html_url: "https://github.com/yaleh/quay/issues/3",
    user: { login: "fixture-user" },
  },
  4: {
    number: 4,
    title: "fixture issue 4",
    body:
      "## Proposal\nfixture proposal\n" +
      "## Plan\nfixture plan\n" +
      "## AC\n- [x] a checked acceptance criterion\n" +
      "## DoD\n- [x] a checked definition of done\n",
    labels: [{ name: "status:ready" }],
    state: "open",
    pull_request: undefined,
    html_url: "https://github.com/yaleh/quay/issues/4",
    user: { login: "fixture-user" },
  },
};

// The PATH-shadow dir lives for the whole run (created lazily). Every CLI
// subprocess inherits the fake-gh PATH, so no invocation in this file ever
// reaches the real `gh` binary or the network.
let fakeGhDir = null;
function fakeGhEnv(envOverride = {}) {
  fakeGhDir ??= makeFakeGhPathDir();
  return {
    ...process.env,
    PATH: `${fakeGhDir}${path.delimiter}${process.env.PATH}`,
    QUAY_GITHUB_REPO: "yaleh/quay",
    FAKE_GH_ISSUES_JSON: JSON.stringify(FIXTURE_ISSUES),
    ...envOverride,
  };
}

function run(args, envOverride = {}) {
  try {
    const out = execFileSync("node", [bin, ...args], {
      encoding: "utf8",
      env: fakeGhEnv(envOverride),
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err),
    };
  }
}

function main() {
  // --- Read-only-safety self-check on this file's own source, before
  // running anything: confirm no invocation anywhere below supplies a
  // real --status value to `task edit` (the only write-capable verb). ---
  {
    const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
    // Match any `run([...])` call whose args array contains both "edit"
    // and "--status" followed immediately by a quoted non-empty value
    // (i.e. a real status, not just the flag name on its own).
    const dangerous = /"edit"[^\]]*"--status"\s*,\s*"[a-zA-Z]/.test(src);
    assert(!dangerous, "self-check: this file contains no 'task edit ... --status <value>' invocation (no live write risk)");
  }

  // 1. `manifest` — static provider.yml self-declaration, no network call.
  {
    const r = run(["manifest"]);
    assert(r.status === 0, "quay-github manifest exits 0");
    const m = JSON.parse(r.stdout);
    assert(m.id === "github" && m.name === "quay-github", "quay-github manifest returns the correct provider self-declaration");
  }

  // 2. `task list --json` — data.read, against the canned fixture issues.
  {
    const r = run(["task", "list", "--json"]);
    assert(r.status === 0, "quay-github task list --json exits 0");
    const tasks = JSON.parse(r.stdout);
    assert(Array.isArray(tasks), "quay-github task list --json emits a JSON array");
    assert(
      tasks.some((t) => t.id === "gh-3") && tasks.some((t) => t.id === "gh-4"),
      "quay-github task list --json includes the fixture issues (gh-3, gh-4)"
    );
  }

  // 2b. Non-JSON fallback format (tab-separated id/status/role/title).
  {
    const r = run(["task", "list"]);
    assert(r.status === 0, "quay-github task list (no --json) exits 0");
    assert(r.stdout.includes("gh-3") && r.stdout.includes("\t"), "quay-github task list (no --json) emits tab-separated lines");
  }

  // 3. `task get gh-3 --json` — happy path, single-issue fixture lookup.
  {
    const r = run(["task", "get", "gh-3", "--json"]);
    assert(r.status === 0, "quay-github task get gh-3 --json exits 0");
    const t = JSON.parse(r.stdout);
    assert(t.id === "gh-3", "quay-github task get --json returns the correct task id");
    assert(typeof t.title === "string" && t.title.length > 0, "quay-github task get --json returns a non-empty title");
  }

  // 3b. "no such task" error path (a 404 from the fake gh for a missing id).
  {
    const r = run(["task", "get", "gh-999999", "--json"]);
    assert(r.status === 1, "quay-github task get <nonexistent id> exits 1");
    assert(r.stderr.includes("no such task"), "quay-github task get <nonexistent id> prints 'no such task' to stderr");
  }

  // 4. `task check` — gate, both directions, against fixture issues with
  //    known statuses (gh-3 has an unchecked AC -> ok:false; the exact
  //    reason string isn't asserted narrowly since issue content could
  //    evolve, but the ok/gate/exit-code triad is asserted).
  {
    const r = run(["task", "check", "gh-3", "--json"]);
    const result = JSON.parse(r.stdout);
    assert(typeof result.ok === "boolean", "quay-github task check gh-3 --json returns a boolean ok field");
    assert(r.status === (result.ok ? 0 : 1), "quay-github task check gh-3 --json exit code mirrors result.ok (CLI's own process.exitCode = result.ok ? 0 : 1 line)");
  }
  {
    const r = run(["task", "check", "gh-4", "--json"]);
    const result = JSON.parse(r.stdout);
    assert(typeof result.ok === "boolean", "quay-github task check gh-4 --json returns a boolean ok field");
    assert(r.status === (result.ok ? 0 : 1), "quay-github task check gh-4 --json exit code mirrors result.ok");
  }

  // 5. `task edit <id>` with NO write flag at all — the required-flag error
  //    path. This returns BEFORE any client.setStatus/writeFields/
  //    writeRelations call is ever made (see bin/quay-github.ts: the
  //    `hasAnyWriteFlag` guard precedes every write call) — confirmed by
  //    reading the source before writing this assertion. No live write
  //    occurs. (DIR-041/M57: `edit` was extended from status-only to the
  //    full field surface — status/title/body/labels/parent/children — so
  //    this guard now checks for ANY of those, not just --status; the
  //    error text still names --status among the required set, so this
  //    assertion's substring checks are unaffected.)
  {
    const r = run(["task", "edit", "gh-3"]);
    assert(r.status === 1, "quay-github task edit <id> (no write flags) exits 1");
    assert(
      r.stderr.includes("--status") && r.stderr.includes("required"),
      "quay-github task edit <id> (no write flags) prints the required-flag error, never reaching any write call"
    );
  }

  // 6. Unknown `task` subcommand.
  {
    const r = run(["task", "bogus"]);
    assert(r.status === 1, "quay-github task <unknown subcommand> exits 1");
    assert(r.stderr.includes("unknown task subcommand"), "quay-github task <unknown subcommand> prints the correct error");
  }

  // 7. Unknown top-level command — usage fallback + exit 1.
  {
    const r = run(["bogus"]);
    assert(r.status === 1, "quay-github <unknown command> exits 1");
    assert(r.stderr.includes("usage:"), "quay-github <unknown command> prints the usage fallback to stderr");
  }

  // 8. Malformed QUAY_GITHUB_REPO — resolveRepo()'s own throw path,
  //    reached via main().catch(...) at the top level (no gh api call is
  //    ever attempted, since resolveRepo() throws before any client is
  //    constructed).
  {
    const r = run(["task", "list"], { QUAY_GITHUB_REPO: "badformat-no-slash" });
    assert(r.status === 1, "quay-github <malformed QUAY_GITHUB_REPO> exits 1");
    assert(
      r.stderr.includes("QUAY_GITHUB_REPO must be"),
      "quay-github <malformed QUAY_GITHUB_REPO> prints resolveRepo()'s own diagnostic via main().catch(...)"
    );
  }

  // 9. `gh api` failure DURING `task list` (QN-064, iteration 60) — a
  //    well-formed but unreachable owner/repo passes resolveRepo()'s own
  //    parse (unlike test 8's malformed-format value), so the fake gh fails
  //    the paged-list call with gh's own "Not Found (HTTP 404)" diagnostic,
  //    exercising list()'s completely unhandled fetchAllIssues() failure
  //    path, distinct from test 8's pre-network resolveRepo() throw.
  {
    const r = run(["task", "list", "--json"], {
      QUAY_GITHUB_REPO: "nonexistent-owner-xyz-123/nonexistent-repo-abc",
    });
    assert(r.status === 1, "quay-github <task list, unreachable owner/repo> exits 1");
    assert(r.stdout === "", "quay-github <task list, unreachable owner/repo> writes nothing to stdout");
    assert(
      /gh api|Not Found|HTTP/.test(r.stderr),
      `quay-github <task list, unreachable owner/repo> stderr carries gh's own diagnostic (got: ${JSON.stringify(r.stderr.slice(0, 200))})`
    );
  }

  if (fakeGhDir) fs.rmSync(fakeGhDir, { recursive: true, force: true });

  console.log(failures === 0 ? "\nAll QN-034 bin/quay-github.ts CLI dispatch tests passed." : `\n${failures} test(s) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
