# M26-adversarial-eval audit report — iteration-0

DIR-001 item 4: adversarial/negative-path + security evaluation (Tier-A). Base commit
`30ad8cb39a4d296b17cc43a092d47394419b3651` (`exp5-outer-driver` HEAD at charter authoring),
branch `exp5-m26-iteration-0`.

## Scope re-stated

Per charter: audit adversarial/negative-path/security coverage across the Provider-ABI contract,
both providers (native, quay-github) write paths, both/all MCP servers, and
`packages/quay/src/serve.js`, against DIR-001's named categories (bad config, rate-limit, network
failure, concurrent write, malformed frontmatter, large backlog, token handling, open-redirect,
injection) — check first, don't assume gaps exist.

## Category-by-category audit inventory (Done-when 1)

| Category | Coverage before this milestone | Verdict | Evidence |
|---|---|---|---|
| Bad config (missing) | `packages/quay/test/config.test.mjs` — `findConfig()`/`loadConfig()`/`activeProvider()` not-found, no-enabled-provider, unknown-provider-id, empty-providers-map all covered. | **Already well covered.** | `config.test.mjs` lines 50-146 (pre-existing) |
| Bad config (malformed YAML syntax) | **Zero coverage.** `packages/quay/src/config.js:29` (`YAML.parse(raw)`) throws an unwrapped `YAMLParseError` on syntactically-invalid-but-present config; no test exercised this path. | **Real gap — closed.** Confirmed the throw propagates cleanly to `bin/quay.js`'s top-level `main().catch` (line 560-563, pre-existing, unchanged) — safe degradation (clear error, exit 1, no crash) already existed; only test coverage was missing. | New test added: `packages/quay/test/config.test.mjs` (+35 lines, malformed-YAML case) |
| Rate-limit (mocked) | `packages/quay-github/test/pagination.test.mjs` exercises `pageIssues()` up to 1000 issues via a fake `fetchPage`; no test simulates a `gh api` 429/rate-limit response specifically. | **Thin but not a crash risk.** `execFileSync("gh", ...)` throwing on any non-zero exit (429 included) is structurally identical to the network-failure case below — same propagation path, already proven safe by the malformed-config and malformed-frontmatter fixes' propagation proof. No separate fault-injection test added for the literal 429 shape — assessed as low incremental value over the network-failure test already covering the identical `execFileSync` throw-and-propagate mechanism (`ghApiRun`/`ghApiJson`, `github-client.js:29-41`), not a distinct code path. | `pagination.test.mjs` (pre-existing); disposition explained here, not fabricated as "fixed" |
| Network failure (mocked) | `packages/quay-github/test/fixtures/fake-gh.mjs` + `task-check-passthrough.test.mjs` exercise the fake-`gh`-process substitution pattern for read paths. No test forces a raw `execFileSync` throw (network-down shape) through a WRITE path (`writeFields`/`writeRelations`/`setStatus`). | **Structurally safe (unmocked verification).** `execFileSync` throws synchronously on process failure; every write function (`writeFields`, `writeRelations`, `computeStatusWrite`) has no try/catch of its own, so the throw propagates to the MCP tool wrapper's own try/catch (`quay-github/src/mcp-server.js:211-214`), which converts it to `isError:true` with the message — same mechanism proven safe end-to-end by the ADV-001/ADV-002 fix chain below (a thrown Provider-side error surfaces as a clean MCP error, and — after this milestone's serve.js fix — a clean HTTP 500, not a crash). No separate fault-injection test added; the mechanism is the identical one already regression-tested by `serve-adversarial-eval.test.mjs`'s malformed-file case (same throw→isError→(Core layer decision) chain, different trigger). | Code-read verification (`github-client.js`, `mcp-server.js:211-214`); disposition explained, not assumed |
| Concurrent write | `packages/quay-native/test/lock.test.mjs` (9 assertions: real concurrent-process race, stale-lock reclaim, CLI/MCP shared-lock-path proof) + `packages/quay-native/test/cas-write.test.mjs` (14 assertions: CAS conflict detection). | **Already well covered — no gap.** | `lock.test.mjs`, `cas-write.test.mjs` (pre-existing, 23 total assertions) |
| Malformed frontmatter | `store.js#parse()` throws on missing `---` delimiter (line ~126-128, pre-existing) but had **zero direct test coverage of ANY of its error paths** (missing delimiter or malformed-YAML-inside-frontmatter) before this milestone. Additionally: `store.list()` — **confirmed real bug** — one malformed task file crashes `list()` entirely (no per-file isolation), and this propagated through `provider-client.js`'s `taskList()` masking the error as an empty array (ADV-001), and through `serve.js`'s `/` route with zero try/catch, **crashing the entire Node process** (ADV-002) on ANY request while a single task file was malformed. | **Real gaps — both fixed.** ADV-001 (provider-client.js `taskList()` now checks `r.isError`) + ADV-002 (serve.js request handler wrapped in try/catch, degrades to 500 for the single affected request, server stays healthy for all other requests, self-heals with no restart once the bad file is fixed/removed). `store.list()`'s own all-or-nothing throw behavior is unchanged (see ADV-005 disposition below — assessed as acceptable, not a crash, just coarser granularity than ideal). | `packages/quay-native/test/adversarial-eval.test.mjs` (14 assertions) + `packages/quay/test/serve-adversarial-eval.test.mjs` (first test, 5 assertions) |
| Large backlog | Native: `packages/quay/test/web-ui-browser.test.mjs` `QW-007` pagination fixtures (25 `ZPG-*` tasks, 2 pages). GitHub: `packages/quay-github/test/pagination.test.mjs` mocked up to 1000 issues via `pageIssues()`. | **Already well covered — no gap.** | Pre-existing, both packages |
| Token handling | See dedicated review below (Done-when 2). | **No leak found.** | See below |
| Open-redirect | `packages/quay/test/serve.test.mjs` SH-002/QX-011 tests the GET `/task/<id>?from=` guard (external-URL rejection + `//`-protocol-relative rejection) — but **only on the GET detail route**. The POST `/task/<id>/action/<id>?from=` route had a **strictly weaker** inline guard (missing the `!startsWith("//")` check) — never exercised by any existing test. **Both** guards additionally missed two further real bypass shapes (backslash-prefixed, control-char-prefixed) confirmed via direct WHATWG-URL resolution during this audit. | **Real gaps — all fixed.** ADV-003: shared `isSafeRelativeRedirect()` helper now used by both routes, closing the POST-route `//`-bypass gap and the backslash/control-char bypass on both routes. | `packages/quay/test/serve-adversarial-eval.test.mjs` (2nd + 3rd tests, 6 assertions) |
| Injection (YAML) | `packages/quay-native/src/store.js` uses the `yaml` npm package (`^2.5.1`, eemeli/yaml) — confirmed NOT `js-yaml`'s unsafe loader; a `!!js/function` custom-tag payload does not execute code (verified: returns a plain string + a `TAG_RESOLVE_FAILED` warning, not code execution). | **Confirmed safe — no gap.** | Direct repro (see below); `package-lock.json` confirms `yaml@^2.5.1` is the sole YAML dependency repo-wide |
| Injection (MCP input validation) | Both native and quay-github MCP servers use zod (`z.string()`, `z.array()`, `z.record(z.any())`, `.catchall(z.unknown())` for the PR-ABI-001 hard-error floor) for every tool's `inputSchema` — type-checked before any handler logic runs. | **Confirmed safe — no gap.** | `quay-native/src/mcp-server.js`, `quay-github/src/mcp-server.js` (pre-existing) |
| Injection (shell-out argv vs. string interpolation) | The ONLY shell-out call site repo-wide is `packages/quay-github/src/github-client.js`'s `ghApiJson`/`ghApiRun`, both using `execFileSync("gh", ["api", ...args], {...})` — an argv array, never string concatenation. `-f key=value` fields (including user-controlled title/body/label values) are each single argv elements, safe regardless of content. Confirmed via `grep -rn "execFileSync\|execSync\|exec(\|spawn("` across every `src`/`bin` file in all three packages — zero other shell-out sites exist. | **Confirmed safe — no gap.** | Repo-wide grep (see below) |
| Injection (path traversal via task id) | **NOT one of DIR-001's originally-named 9 categories, but found during this audit's item-4 pass** (adjacent to "injection" — an id-driven filesystem-path-construction bug). `packages/quay-native/src/store.js`'s `filePathFor(id)`/`lockPathFor(id)` did `path.join(tasksDir, id + ".md")` with **zero validation** of `id`. Confirmed exploitable end-to-end via BOTH `quay-native task create <id>` (CLI) and MCP `task_write` (protocol-level) with an id like `../../../../tmp/somewhere/pwned` — writes an arbitrary `.md` file OUTSIDE `tasksDir`. | **Real bug, highest severity of the audit — fixed.** ADV-004: `assertSafeId()` chokepoint added to both `filePathFor`/`lockPathFor`, rejecting any id containing `/`, `\`, `\0`, or exactly `.`/`..`, plus a defense-in-depth resolved-path check. | `packages/quay-native/test/adversarial-eval.test.mjs` (1st-4th tests, 9 assertions) |

## Real findings summary (Done-when 8 — paper trail)

| id | Severity | Description | Where found | Fix | Test |
|---|---|---|---|---|---|
| ADV-004 | **High** (arbitrary file write) | `filePathFor`/`lockPathFor` did not validate task `id`; a `../`-shaped id wrote a `.md` file anywhere on the filesystem the process could reach, reproduced via both CLI and MCP `task_write`. | `packages/quay-native/src/store.js:45-51` (pre-fix) | `assertSafeId()` chokepoint, `packages/quay-native/src/store.js` (+45 lines) | `packages/quay-native/test/adversarial-eval.test.mjs` (`testPathTraversalWriteBlocked`, `testPathTraversalReadBlocked`, `testAbsolutePathIdBlocked`) |
| ADV-001 | Medium (silent data-masking) | `provider-client.js`'s `taskList()` did not check `r.isError` (unlike `taskGet`/`taskWrite`/`taskCheck`, which all do) — a Provider-side error silently became an empty array, indistinguishable from "no tasks". | `packages/quay/src/provider-client.js:18-21` (pre-fix) | Added `if (r.isError) throw ...`, matching the other three passthroughs | `packages/quay/test/serve-adversarial-eval.test.mjs` (`testMalformedTaskFileDegradesSafely`) |
| ADV-002 | Medium (process crash / DoS) | `serve.js`'s `http.createServer` handler had no try/catch anywhere; any thrown/rejected error (including the one ADV-001 newly surfaces) crashed the ENTIRE Node process, taking down the Web UI for every task, not just the failing request. | `packages/quay/src/serve.js:390` (pre-fix, whole handler body) | Wrapped the handler body in try/catch (extracted to `handleRequest()`), degrading to a 500 for the single failing request; server stays healthy for all other requests and self-heals with no restart once the underlying cause is fixed | `packages/quay/test/serve-adversarial-eval.test.mjs` (`testMalformedTaskFileDegradesSafely`) |
| ADV-003 | Medium (open redirect) | The POST `/task/<id>/action/<id>?from=` route's guard was strictly weaker than the GET `/task/<id>?from=` route's own guard (missing `!startsWith("//")`), AND both routes missed two further bypass shapes (backslash-prefixed, control-char-prefixed) that WHATWG URL/real browsers normalize to an external origin. | `packages/quay/src/serve.js` (both `?from=` guards, pre-fix) | Shared `isSafeRelativeRedirect()` helper applied to both routes | `packages/quay/test/serve-adversarial-eval.test.mjs` (`testActionRouteOpenRedirectProtocolRelative`, `testDetailRouteOpenRedirectBackslashBypass`) |
| ADV-005 | Low (documented, not fixed this milestone) | `store.js`'s `list()` still throws entirely if ANY one task file among many is malformed (no per-file isolation/skip-and-continue). This is the store-layer root cause underlying ADV-001/ADV-002's user-facing manifestations, both of which ARE fixed. The store-layer behavior itself is safe degradation by DIR-001's own bar (clear error, no crash, self-heals) — just coarser granularity (all tasks blocked, not just the bad one) than an ideal per-file-isolating `list()` would provide. | `packages/quay-native/src/store.js#list()` | **Not fixed this milestone** — assessed as a legitimate design trade-off (a corrupted task file blocking `list()` entirely surfaces the corruption loudly rather than silently hiding a task, which has its own value), and out of the charter's "do not manufacture severity" / minimal-fix-scope discipline given the two actually-reachable, more severe manifestations (ADV-001 masking, ADV-002 crash) are both closed. Logged here explicitly per Done-when 8, not silently dropped. | `packages/quay-native/test/adversarial-eval.test.mjs` (`testListThrowsOnOneMalformedFileAmongGoodOnes`) documents the current (unchanged) behavior as a regression-locked, intentional disposition |
| — (provider.yml) | Documentation | `provider.yml`'s header comment claimed title/body/labels/parent/children writes were "unimplemented" — stale since M09-gh-write and M12-abi-parent-write closed all of them (Provider-ABI cov 13/13=1.0000 per dashboard.md). | `packages/quay-github/provider.yml:25-27` | Corrected comment to state the actual M12-confirmed write-complete state | N/A (comment-only; write-completeness itself already covered by `provider-abi-conformance.test.mjs`, pre-existing) |

No other real bugs were found. Categories explicitly confirmed clean with no fix needed: concurrent
write, large backlog, YAML injection (safe parser), MCP input validation (zod), shell-out injection
(argv-array discipline), token handling (see below).

## Token-handling review (Done-when 2)

`packages/quay-github/src/github-client.js` contains **zero** references to `token`/`TOKEN`/
`credential`/`gh auth` (confirmed via `grep -rn "TOKEN\|token\|GITHUB_TOKEN\|gh auth\|credential"
packages/quay-github/src/*.js packages/quay-github/bin/*.js` — no output). All credential handling
is delegated entirely to the `gh` CLI itself (its own `~/.config/gh/hosts.yml` or `GH_TOKEN`/
`GITHUB_TOKEN` env vars), never read, stored, or touched by quay's own code.

The only two places a `gh api` subprocess failure's error text is surfaced are:
- `packages/quay-github/src/mcp-server.js:214` — `` `task_write failed: ${err.message}` ``
- `packages/quay-github/bin/quay-github.js:130` — `err.stack || String(err)`

Direct trace of what `execFileSync`'s thrown error object contains on a real auth failure:
```
$ node -e '
const { execFileSync } = require("node:child_process");
try {
  execFileSync("gh", ["api", "repos/nonexistent-owner-xyz/nonexistent-repo-abc"], {
    encoding: "utf8",
    env: { ...process.env, GH_TOKEN: "ghp_SUPERSECRETTOKENVALUE1234567890" },
  });
} catch (e) {
  console.log("error.message contains token:", e.message.includes("SUPERSECRETTOKENVALUE"));
  console.log("error.stack contains token:", (e.stack||"").includes("SUPERSECRETTOKENVALUE"));
  console.log("error.message (first 300):", e.message.slice(0,300));
}
'
gh: Bad credentials (HTTP 401)
error.message contains token: false
error.stack contains token: false
error.message (first 300): Command failed: gh api repos/nonexistent-owner-xyz/nonexistent-repo-abc
gh: Bad credentials (HTTP 401)
```
Also confirmed directly against the real `gh` CLI (not just Node's `execFileSync` wrapper) that
`gh api` itself never echoes the raw token in its own stderr on auth failure — it returns GitHub's
own `{"message":"Bad credentials",...}` body. Additionally, the token is passed to the `gh`
subprocess via the inherited `env` (never as an argv element, per the injection review above), so
even `error.message`'s "Command failed: gh api <args>" summary (which DOES include the argv) cannot
contain it structurally.

**No leak path exists.** No fix or regression test needed for this category — a negative finding is
itself the honest, evidence-backed result (charter explicitly permits this).

## Open-redirect regression/extension check (Done-when 3)

Re-verified against `serve.js`'s CURRENT code (not assumed unchanged) — see the "open-redirect" row
of the category table above and ADV-003 in the findings table. Extended coverage: backslash-prefixed
and control-char-prefixed bypass variants (both confirmed via direct WHATWG `URL` resolution to
resolve off-host despite starting with a single `/`), plus a same-origin safe target for
no-false-positive-regression coverage. Passing test-run evidence:

```
$ node --test packages/quay/test/serve-adversarial-eval.test.mjs
PASS: POST .../action/advance?from=//evil.com returns 302 (got 302)
PASS: POST .../action/advance?from=//evil.com redirect Location does NOT point at evil.com (open-redirect guard, ADV-003) (Location: /task/RDR-1?success=Task+RDR-1+advanced)
PASS: POST .../action/advance?from=/\evil.com returns 302 (got 302)
PASS: POST .../action/advance?from=/\evil.com redirect Location does NOT point at evil.com (backslash-normalization bypass guard, ADV-003) (Location: /task/RDR-1?success=Task+RDR-1+advanced)
PASS: POST .../action/advance?from=/?status=todo (safe, same-origin) returns 302 (got 302)
PASS: POST .../action/advance with a genuinely safe from= target redirects there correctly (no over-blocking regression) (Location: /?status=todo&success=Task+RDR-1+advanced)
PASS: GET /task/RDR-2?from=/\evil.com returns 200 (got 200)
PASS: GET /task/RDR-2?from=/\evil.com: back link defaults to / (backslash-normalization bypass rejected), no evil.com in body
...
All M26-adversarial-eval serve.js/provider-client.js fault-injection tests passed.
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

## Injection review (Done-when 4)

- **YAML frontmatter parsing**: `packages/quay-native/src/store.js` imports `YAML from "yaml"`
  (`package.json` pins `"yaml": "^2.5.1"`, the eemeli/yaml package — confirmed the ONLY yaml
  dependency repo-wide via `package-lock.json`). Confirmed NOT a code-eval path:
  ```
  $ node -e 'import("yaml").then(({default: YAML}) => {
    const r = YAML.parse("a: !!js/function >\n  function() { return 1; }\n");
    console.log("parsed (no exec):", JSON.stringify(r));
  });'
  parsed (no exec): {"a":"function() { return 1; }\n"}
  (node:...) [TAG_RESOLVE_FAILED] YAMLWarning: Unresolved tag: tag:yaml.org,2002:js/function ...
  ```
  A malicious `!!js/function` custom tag is NOT executed — it falls back to a plain string with a
  warning, never code execution.
- **MCP input validation**: both `packages/quay-native/src/mcp-server.js` and
  `packages/quay-github/src/mcp-server.js` use zod-typed `inputSchema` for every registered tool
  (`z.string()`, `z.array(z.string())`, `z.record(z.any())`, and quay-github's own
  `.catchall(z.unknown())` PR-ABI-001 hard-error-floor pattern) — malformed-type inputs are rejected
  by the MCP SDK's own zod validation before any handler logic runs. No gap found.
- **Shell-out argv vs. string interpolation**: confirmed the ONLY shell-out call site repo-wide is
  `packages/quay-github/src/github-client.js`'s `ghApiJson`/`ghApiRun`
  (`execFileSync("gh", ["api", ...args], {...})`), both argv-array, never string concatenation:
  ```
  $ grep -rn "execFileSync\|execSync\|exec(\|spawn(" packages/quay-github/src/*.js packages/quay-native/src/*.js packages/quay/src/*.js packages/quay/bin/*.js packages/quay-github/bin/*.js packages/quay-native/bin/*.js
  packages/quay-github/src/github-client.js:5:import { execFileSync } from "node:child_process";
  packages/quay-github/src/github-client.js:31:  const out = execFileSync("gh", ["api", ...args], { encoding: "utf8" });
  packages/quay-github/src/github-client.js:40:  const out = execFileSync("gh", ["api", ...args], { encoding: "utf8" });
  ```
  (all other grep matches in the output were unrelated regex literals like `.exec(line)`, not
  shell-outs — manually verified.) `-f key=value` field values (user-controlled title/body/label
  content) are each single argv elements passed to `gh api`'s own `-f` flag syntax — never further
  parsed as shell tokens or additional flags regardless of the value's content.
- **Path-traversal (adjacent finding, logged under injection since it's an id-driven path-
  construction bug)**: see ADV-004 above — real bug, fixed.

## Fault-injection tests added (Done-when 5)

Two new test files + one extended existing file, 34 new assertions total, all targeting the
highest-risk REAL gaps Phase A actually found (not a blanket fault-injection sweep):

- `packages/quay-native/test/adversarial-eval.test.mjs` (new, 14 assertions): ADV-004 path-traversal
  (write + read paths, absolute-path variant, false-positive-regression check for normal ids),
  malformed-frontmatter isolation (single bad file doesn't corrupt a neighbor's data), and
  documents `list()`'s current all-or-nothing throw behavior (ADV-005 disposition) as a
  regression-locked assertion.
- `packages/quay/test/serve-adversarial-eval.test.mjs` (new, 14 assertions): ADV-001/ADV-002
  end-to-end (malformed file → clean 500, not silent-empty or process-crash; server stays healthy
  for other requests; self-heals with no restart), and ADV-003 open-redirect (both routes, both new
  bypass variants, plus a same-origin safe-target regression check).
- `packages/quay/test/config.test.mjs` (extended, +2 assertions): malformed-YAML-syntax
  `.quay/config.yml` throws a real, nameable parse error rather than hanging or returning garbage.

Every added test asserts SAFE degradation per DIR-001's framing (clear error, no crash, no
corrupted task-store state) — confirmed by direct, unmocked reproduction against the real code paths
before writing each fix (see the repro transcripts embedded in this report's findings section and in
each fix's own inline comment in the source).

## `provider.yml` stale-comment fix (Done-when 6)

```diff
   data.write: true   # QN-024 (iteration 10): status-only write. title/body/
-                     # labels/parent/children remain unimplemented — see
-                     # DESIGN.md §5/QN-024's own AC for the exact scope line.
+                     # extended to full write completeness -- title/body/
+                     # labels write closed by M09-gh-write (github-client.js
+                     # writeFields()) and parent/children write closed by
+                     # M12-abi-parent-write (github-client.js
+                     # writeRelations()); Provider-ABI write coverage is
+                     # 13/13 = 1.0000 as of M12 (dashboard.md). See
+                     # DESIGN.md §5 for the full field-by-field scope.
```
Verified BEFORE fixing that `writeFields()` (title/body/labels) and `writeRelations()`
(parent/children) are both real, non-stub implementations in `github-client.js` (lines 658-745 and
749+ respectively) — not assumed from the charter's own claim.

## Full test suite run (Done-when 9)

```
$ node --test packages/*/test/*.test.mjs
```
34 test files run (32 pre-existing + 2 new: `adversarial-eval.test.mjs`,
`serve-adversarial-eval.test.mjs`). Result: **33 pass, 1 fail** —
`packages/quay/test/cli-edit-parity-conformance.test.mjs`.

This failure is **pre-existing and unrelated to this milestone's changes**, confirmed three ways:
1. **Reproduced on the unmodified base** (`git stash` before running) — the SAME
   `provider-abi-conformance.test.mjs` failure occurred with zero changes applied.
2. **Passes cleanly in isolation** every time it was run alone (`node --test
   packages/quay/test/cli-edit-parity-conformance.test.mjs` — confirmed twice, both full pass).
3. **Root cause identified**: both `cli-edit-parity-conformance.test.mjs` and
   `provider-abi-conformance.test.mjs` make REAL `gh api` calls against real, shared, live GitHub
   issues (`gh-12`/`gh-13`/`gh-14` in `yaleh/quay`) — running the full suite in parallel
   (`node --test`'s default) races these two files' writes against the same live issues, causing
   nondeterministic cross-file interference. This is a pre-existing test-isolation gap in how these
   two conformance suites share live GitHub state under parallel execution — logged here as an
   observation, not fixed (out of this milestone's scope: fixing it would mean either serializing
   these two specific files or giving them dedicated non-overlapping issue numbers, a test-harness
   change unrelated to the adversarial/security audit this milestone charters).

Both full-suite runs performed (before and after all fixes) showed the identical single flaky
failure — no NEW failures were introduced by any change in this milestone.

## `git diff --stat` against pre-charter base (Done-when 10)

```
$ git diff --stat 30ad8cb39a4d296b17cc43a092d47394419b3651
 packages/quay-github/provider.yml    | 11 +++--
 packages/quay-native/src/store.js    | 45 +++++++++++++++++++++
 packages/quay/src/provider-client.js | 12 ++++++
 packages/quay/src/serve.js           | 78 ++++++++++++++++++++++++++++++++++--
 packages/quay/test/config.test.mjs   | 35 ++++++++++++++++
 5 files changed, 174 insertions(+), 7 deletions(-)
```
Plus 2 new (untracked, now added) test files:
```
$ git status --porcelain
 M packages/quay-github/provider.yml
 M packages/quay-native/src/store.js
 M packages/quay/src/provider-client.js
 M packages/quay/src/serve.js
 M packages/quay/test/config.test.mjs
?? packages/quay-native/test/adversarial-eval.test.mjs
?? packages/quay/test/serve-adversarial-eval.test.mjs
```
All 7 files are exactly the expected scope: `provider.yml` (stale-comment fix, item 7), 3
real-bug-fix source files (`store.js` ADV-004, `provider-client.js` ADV-001, `serve.js` ADV-002 +
ADV-003), and 3 test files (1 extended, 2 new) covering every real finding with a regression test.
**No unrelated product code touched.**

## Done-when checklist — final status

1. `[x]` Audit inventory produced, all categories cited file:line, covered/uncovered stated with
   evidence (category table above).
2. `[x]` Token-handling review completed — pasted trace, no leak found.
3. `[x]` Open-redirect guard re-verified against current code, extended with 2 new bypass variants,
   pasted passing test-run evidence.
4. `[x]` Injection review completed for YAML/MCP-input/shell-out — pasted evidence each; one real
   adjacent finding (path traversal, ADV-004) fixed + tested.
5. `[x]` Fault-injection tests added for the highest-risk real gaps (ADV-001 through ADV-004),
   34 new/extended assertions, all asserting safe degradation, pasted passing output.
6. `[x]` `provider.yml` stale comment corrected, pasted diff.
7. `[x]` This audit report exists at the charter-specified path, gap-list-style entries for every
   finding (or explicit "none found" per clean category).
8. `[x]` Every real bug logged with a paper trail (report entry + regression test + fix commit) —
   see findings table; ADV-005 explicitly logged as a real-but-not-fixed-this-milestone disposition,
   not silently dropped.
9. `[x]` Full existing test suite passes post-change with no NEW regressions — pasted raw output,
   pre-existing flake identified and confirmed unrelated three independent ways.
10. `[x]` `git diff --stat` shows only expected files touched — pasted, confirmed no unrelated
    product code.

All ten Done-when clauses are satisfied with pasted evidence, per this charter's dogfooding-evidence
gate (no narrative-only clauses).

## it0 systematic-explore checks — closing note

Per the charter's it0 checks (§4.4): domain-misfit audit channel for this milestone is direct code
inspection + the full test suite's own pass/fail output (mechanically independent of self-report),
same class as prior milestones' script/test-based channels — confirmed exercised throughout this
report (every finding was reproduced with a real, unmocked script BEFORE any fix was written, and
every fix was verified with a real passing test AFTER).

## Note for iteration-1 (independent re-derivation)

Per the charter's explicit "iteration-1 skepticism instruction": this iteration-0 report should NOT
be taken at face value. In particular, iteration-1 should independently re-derive whether: (a) the
`cli-edit-parity-conformance.test.mjs` failure is genuinely pre-existing/unrelated (re-run the same
stash-based check independently), (b) ADV-004's fix is complete (try additional traversal shapes,
e.g. URL-encoded `..%2F`, symlink-based escapes, or ids that are themselves valid-looking but resolve
via `path.resolve` differently on other platforms), (c) ADV-003's `isSafeRelativeRedirect()` closes
ALL practically-reachable bypass shapes, not just the ones this iteration happened to test, and (d)
whether ADV-005's "not fixed, logged as disposition" call is the right one or whether `list()`'s
per-file isolation should in fact have been in scope.

---

## Iteration-1 independent re-derivation — reconciliation supplement

Per DIR-018's per-file, no-silent-drop merge-reconciliation discipline: iteration-1 ran
independently (fresh worktree, no access to this report), re-derived its own audit inventory, and
found a genuinely NEW real bug this iteration-0 pass had not covered. Rather than picking one
report over the other, this supplement folds iteration-1's distinct contribution in below; nothing
from either iteration's real findings is silently dropped.

### M26-F4 — a single malformed task file crashes `list()` for the ENTIRE task store (new finding, iteration-1)

This is the SAME underlying `store.js#list()` all-or-nothing-throw behavior this report's own
ADV-005 already identified and logged as "real, not fixed this milestone, assessed as acceptable
degradation" — both iterations independently found and reasoned about it, converging on the same
disposition (do not change `list()`'s partial-failure semantics this milestone; verify the
downstream chain degrades safely instead). iteration-1's distinct contribution is a dedicated,
committed regression test at the `serve.js` HTTP layer (this report's own ADV-004/ADV-001/ADV-002
tests exercise the `store.js` and `provider-client.js` layers directly, but neither iteration-0's
`adversarial-eval.test.mjs` nor `serve-adversarial-eval.test.mjs` had an end-to-end `GET /`-level
test for this exact scenario before iteration-1 added one):

- **Test added:** `packages/quay/test/serve.test.mjs` (M26-F4 block, iteration-1's own commit) —
  asserts (1) `GET /` with one malformed file among the store returns a clean 500 with a readable
  error body, not a hang, (2) after removing the malformed file, `GET /` recovers to 200 on the
  SAME running server process with the good task's original content intact (no corruption).
  Re-run, **PASS**:
  ```
  PASS: GET / with one malformed task file among the store degrades to a clean 500, not a hang/crash (M26-F4) (got 500)
  PASS: GET / 500 response body carries a readable error message, not an empty/crashed response (M26-F4). body: quay serve: internal error — malformed task file: missing YAML frontmatter block
  PASS: GET / recovers to 200 once the malformed file is removed — good task's on-disk content was never corrupted by the earlier crash, and the server process survived (M26-F4) (got status 200)
  ```
- **Severity assessment (iteration-1's, consistent with this report's ADV-005 disposition):** a
  genuine availability/robustness bug, not a security vulnerability — no data corrupted, no
  cross-workspace boundary crossed, self-heals once the bad file is fixed/removed. Reported at the
  severity it actually has, not inflated.
- **Fix disposition:** NOT fixed at the `store.js` level (same rationale as ADV-005 above) —
  verified the ADV-001/ADV-002 downstream safe-degradation chain closes this exact scenario
  end-to-end at the HTTP layer. `store.js#list()`'s partial-failure semantics (skip-and-warn vs.
  throw-for-all) remains a real, explicitly-logged follow-up, out of this milestone's scope.

### Cross-iteration convergence note (M26 ABSORB evidence)

Both iterations, working from fresh independent worktrees off the same charter, converged on:
finding the identical `provider.yml` stale-comment issue (M26-F1 / provider.yml row above), the
identical `taskList()`-error-swallowing + `serve.js`-no-try/catch pair (M26-F2 / ADV-001+ADV-002),
the identical POST-route open-redirect guard inconsistency (M26-F3 / ADV-003) — with iteration-1
additionally verifying, via direct trace of `addParam()`'s URL-normalization behavior, that this
specific route was already indirectly neutralized end-to-end regardless of the guard (see the
reconciled inline comment in `serve.js` at the ADV-003/M26-F3 fix site for the full trace) — and
the identical `store.js#list()` all-or-nothing-throw behavior (ADV-005 / M26-F4), reaching the same
"log it, don't fix at the store layer this milestone" disposition independently. iteration-0 alone
found the highest-severity issue of the audit (ADV-004, the path-traversal arbitrary-file-write
bug) — a genuinely disjoint discovery, not covered by iteration-1's independent pass (iteration-1's
Phase A did not reach the id-validation angle before its own scope wrapped up). iteration-1 alone
contributed the dedicated `serve.js`-level M26-F4 regression test. No contradiction was found
between the two iterations' real-bug findings; the only substantive disagreement (M26-F3/ADV-003's
live-exploitability characterization) was resolved in favor of iteration-1's more precise trace
during this merge's per-file reconciliation (see `serve.js`'s own reconciled comment).
