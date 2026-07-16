# DIR-018

- **status:** pending
- **created_by:** human (Yale), asserted directly in this live conversation
- **created_at:** 2026-07-16
- **title:** Follow common OSS practice — create/update user-facing project documentation, establish a stable build/release mechanism, and actually cut a GitHub release

## Finding

This conversation independently inspected the live repository state
(not carried over from any prior iteration's claim):

- **No root-level `README.md`.** `docs/proposal/` contains seven
  internal design/methodology documents (`quay-proposal.md`,
  `quay-native-design.md`, `quay-bootstrap-experiment.md`, etc.), all
  written for this experiment's own audience (BAIME/V-function/σ
  terminology), not for a newcomer trying to install or use `quay`,
  `quay-native`, or `quay-github`. There is no "what is this, how do I
  install it, how do I run it" entry point anywhere in the repo.
- **No `LICENSE` file, no `CHANGELOG`.**
- **All three packages remain `"private": true`** at `"version": "0.0.1"`
  (`packages/quay/package.json`, `packages/quay-native/package.json`,
  `packages/quay-github/package.json`); the workspace root
  (`package.json`) is `"version": "0.0.0"`. 71 iterations of production
  work have not moved any package version once.
- **No CI configuration exists** (`.github/workflows/` does not exist;
  `find . -iname "*.yml"` outside `node_modules` returns only
  `.quay/config.yml` and `.manda/config.yml`, both experiment-runtime
  config, not CI). There is no automated build/test gate on push, despite
  `git remote -v` confirming `origin` is a real, live GitHub remote
  (`https://github.com/yaleh/quay.git`) that the experiment has been
  pushing commits to continuously (local `master` was found only 1 commit
  ahead of `origin/master` at the time of this check).
- **Zero git tags, zero GitHub Releases.** `git tag` returns nothing;
  `gh release list` returns nothing. Despite 71 iterations of real,
  independently-audited, test-covered work landing on a real public(-ish)
  remote, nothing has ever been packaged as a versioned, installable
  release.

This is a genuine gap against ordinary OSS practice, and is distinct
from — not a replacement for — this experiment's own existing
`completeness`/`reusability`/`validation` V-meta factors, which measure
the *quay-native methodology's* self-hosting properties, not the
*repository's* external presentability. Nothing in `docs/proposal/
quay-bootstrap-experiment.md`'s guardrails (G1-G6) or convergence
criteria currently requires README/LICENSE/CI/release hygiene at any
point in the experiment's lifecycle — this has simply never been in
scope for any iteration so far, and the live repo state reflects that.

## Requested action

1. **Create a root-level `README.md`** written for an actual external
   reader (not this experiment's internal audience): what `quay` is, the
   three-package structure (`quay` Core, `quay-native` Provider,
   `quay-github` Provider), install/run instructions verified against the
   actual current CLI entry points (`packages/*/bin/*.js`), and a pointer
   into `docs/` for anyone who wants the deeper design/methodology
   material. Do not fabricate usage examples — derive them from the
   actual, current CLI help output / existing test invocations, live-run
   and pasted in, not remembered or invented.
2. **Add a `LICENSE` file** (ask the human directly, in-conversation, which
   license to use if not already decided elsewhere in `docs/` — do not
   default to a specific license unilaterally without checking first).
3. **Establish a stable build/release mechanism**: at minimum, a CI
   workflow (`.github/workflows/`) that runs the existing test suite
   (`node --test packages/*/test/*.test.mjs`, the same command this
   experiment's own iterations already use to self-verify) on push/PR —
   live-verify it actually runs green on GitHub Actions, not just that
   the YAML parses locally. Bump package versions off `0.0.0`/`0.0.1`
   using ordinary semver discipline (a real decision — e.g. `0.1.0` for
   first tagged release — recorded with its own rationale, not asserted
   without one).
4. **Actually cut a real GitHub release**: create a git tag, push it, and
   use `gh release create` (or the GitHub UI) to publish a real release
   against `https://github.com/yaleh/quay`, with release notes that
   accurately describe what this snapshot of the repo actually is (an
   in-progress BAIME methodology-bootstrapping experiment, self-hosting
   at σ=0.8986, not a finished product) — do not overstate maturity in
   the release notes to make the release look more complete than the
   experiment's own provenance record shows it to be.
5. Record, in whichever iteration(s) apply this directive, whether any
   V_instance/V_meta factor plausibly moves as a result (this is
   genuinely ambiguous and should be checked directly against the exact
   defining language in `docs/proposal/quay-bootstrap-experiment.md`
   §5.1/§5.2, the same discipline every other iteration applies to itself
   — do not assume either "obviously yes" or "obviously no" without that
   check, and do not force a credit claim if the exact language doesn't
   support one).

## Resolution

<!-- Filled in by whichever iteration applies this directive. -->

## Progress note (added 2026-07-16, iteration 72)

Read in full this iteration. **Deferred, not applied** — iteration 72's
assigned scope was narrowly "apply DIR-016"; DIR-018 is a substantially
larger, multi-part undertaking (root README, a LICENSE choice that
explicitly requires asking the human directly per its own action 2, a live
CI workflow verified green on GitHub Actions, a semver bump with recorded
rationale, and an actual `gh release create` against the live
`yaleh/quay` remote) that should not be rushed into the same iteration as
DIR-016 without risking an incomplete or non-live-verified partial
CI/release state — action 3/4 of this directive explicitly require live
verification, not assertion. Still `status: pending`. Whoever picks this
up next should read it in full and likely split it across more than one
iteration rather than force it into a single pass. No V-factor movement is
implied by this deferral.

## Progress note (added 2026-07-16, iteration 74)

**Actions 1 and 2 applied this iteration; actions 3 and 4 explicitly
deferred to a future, separate iteration.** Still `status: pending` —
this directive is only partially applied, not fully resolved, so it is
deliberately **not** moved to `archive/` yet.

**Action 1 (root README.md) — done.** A root-level `/README.md` was
created for an external reader: what `quay` is, the three-package
structure (`quay` Core / `quay-native` Provider / `quay-github`
Provider), install instructions (`npm install` at the workspace root;
each package's binary invoked directly via `node packages/*/bin/*.js`),
and a `.quay/config.yml` example copied verbatim from this repo's own
live config. Every CLI usage example was derived from an actual, live
command run this iteration against this repository's real, current
state — not recalled or invented — including:

```
$ node packages/quay/bin/quay.js task list --json
quay-native mcp: serving tasks from /home/yale/work/quay/tasks
[ { "id": "QN-001", "title": "Wire task_write into quay-native CLI/MCP
with full frontmatter patch semantics", "status": "done", ... } ]

$ node packages/quay/bin/quay.js task check QN-001
quay-native mcp: serving tasks from /home/yale/work/quay/tasks
QN-001: PASS — terminal

$ node packages/quay-native/bin/quay-native.js task list
QN-001	done	primitive	Wire task_write into quay-native CLI/MCP with full
frontmatter patch semantics
...

$ node packages/quay-native/bin/quay-native.js manifest
{ "id": "native", "name": "quay-native", "capabilities": {"data.read":
true, "manifest": true, "data.write": true, "gate": true, "skill": true},
... }

$ node packages/quay-github/bin/quay-github.js task list
gh-10	done	compound	[QN-037] Epic: live quay:execute Skill-driven
compound-recursion end-to-end proof
...
```

(Note, discovered live and reflected accurately in the README rather than
assumed: `quay` Core's own subcommand is `task view`, but `quay-native`'s
own raw CLI subcommand for the same operation is `task get` —
`quay-native task view` does not exist and was confirmed, live, to error
with `unknown task subcommand: view`. The README documents each binary's
actual subcommand name correctly, not a guessed unified name.) The README
also points readers at `docs/proposal/` for the deeper design/methodology
material, explicitly labeling that directory as internal experiment
documentation, not primary user docs, and states plainly that reading it
is not required to install or use `quay`.

**Action 2 (LICENSE) — done.** A root-level `/LICENSE` was added, using
the standard, unmodified MIT License text, with copyright holder "Yale
Huang" and year 2026. Source for the copyright holder name: `git log -1
--format='%an <%ae>'` against this repository's own history returned
`Yale Huang <calvino.huang@gmail.com>` consistently across all recent
commits; year 2026 taken from the current date (context supplied to this
iteration; also consistent with every commit's own date in `git log`).
The license choice itself (MIT) was supplied directly by the human in the
top-level orchestrating conversation, per this iteration's own task
framing — not re-asked here.

**Actions 3 and 4 (CI workflow + real GitHub release) — explicitly NOT
attempted this iteration**, per this iteration's own assigned scope.
These remain for a separate, later iteration: a `.github/workflows/` CI
job running `node --test packages/*/test/*.test.mjs` on push/PR,
live-verified green on GitHub Actions; a semver bump off `0.0.0`/`0.0.1`
with recorded rationale; and an actual `git tag` + `gh release create`
against the live `https://github.com/yaleh/quay` remote (human-approved
in the top-level orchestrating conversation, per this iteration's own
task framing — the approval is recorded here for the next iteration's
benefit, but the live tag/release act itself is deliberately left to that
later iteration, once CI is genuinely green first).

**Action 5 (V-factor check) — performed, no credit claimed.** See the
owning iteration report (`experiment/iterations/iteration-74.md` §8) for
the full reasoning against the exact §5.1/§5.2 defining language. In
summary: no V_instance factor applies (README/LICENSE are neither
skeleton runtime behavior, ABI schema, gate logic, nor Skill content).
`completeness` (the closest V_meta candidate) was seriously
investigated and declined — §5.2 defines `completeness` as "Methodology
(Skills + gates + decomposition rule) fully documented and
self-contained," i.e. quay-native's own Skills/gate/decomposition rule,
not the repository's external user-facing presentability; a README aimed
at an external installer is one level removed from that object, the same
distinction iterations 70-73 drew for their own edits to
`ITERATION-PROMPTS.md`/`provenance.md`. No V-factor movement is claimed
or recorded as a result of this iteration's work.

Still `status: pending` — whoever picks this up next should read this
note in full and proceed directly to actions 3-4 (CI first, then the
real release), without needing to re-litigate actions 1-2 or the license
choice.

## Progress note (added 2026-07-16, iteration 75)

**Action 3 (CI workflow + semver bump) — done, genuinely live-verified
green.**

Created `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      issues: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: node --test packages/*/test/*.test.mjs
        env:
          GH_TOKEN: ${{ github.token }}
```

Getting this genuinely green took three real runs, two of which
uncovered genuine production bugs (not merely CI-config friction):

- **Run 1 (`29468078154`, cancelled after 13m4s)**: hung indefinitely.
  Initial hypothesis (unauthenticated `gh` blocking on interactive auth)
  was disproven by local reproduction (unauthenticated `gh api` actually
  fails fast, ~70ms). Fix: added `GH_TOKEN: ${{ github.token }}` to the
  test step and a `timeout-minutes: 10` job cap as a safety net.
- **Run 2 (`29468690142`, auto-cancelled at the 10-minute cap)**: still
  hung even with `GH_TOKEN` set. Root-caused via `gh run view ... --log`
  (only obtainable once the run completed/was cancelled): the repo is
  **private** (`gh api repos/yaleh/quay --jq '.private'` → `true`), so
  the default `GITHUB_TOKEN` lacked `issues:read`, causing `gh api
  repos/yaleh/quay/issues...` calls to 403. This 403 propagated into
  `packages/quay-github/test/mcp-server.test.mjs`'s `task_list` call as
  `isError:true` with no `structuredContent`, and the test's own
  `listResult.structuredContent.tasks` access threw
  `TypeError: Cannot read properties of undefined (reading 'tasks')`
  mid-`main()`, **skipping `client.close()` entirely** and leaving the
  child `quay-github mcp` subprocess as an orphan — confirmed via
  "Terminate orphan process" lines in the cancelled run's own cleanup
  log. This orphan process (not `gh` auth itself) is what actually hung
  `node --test`. Fixed two ways: (a) added `permissions: {contents: read,
  issues: read}` to the CI job; (b) hardened
  `packages/quay-github/test/mcp-server.test.mjs` with `try/finally`
  around both its `client` and `brokenClient` blocks so `client.close()`
  always runs regardless of what throws mid-test — a genuine robustness
  fix to the test suite itself, not merely a CI-config workaround.
  Verified locally by reproducing the exact hang (unauthenticated `gh`)
  and confirming the test now exits cleanly in ~0.9s instead of hanging.
- **Run 3 (`29469214568`) — SUCCESS.** `status=completed
  conclusion=success`, 55s. Verified via `gh run view 29469214568
  --repo yaleh/quay --log`: `# tests 27 / # pass 27 / # fail 0 / #
  cancelled 0 / # skipped 0 / # todo 0`, no orphan-process warnings. This
  is genuine, live-verified green CI at commit `10c847b`. Confirmed
  again via `gh run list --repo yaleh/quay` at write-up time: `completed
  success` for `29469214568`.

**Semver**: bumped from `0.0.0` (workspace root) / `0.0.1` (all three
packages) to **`0.1.0`** uniformly across `package.json`,
`packages/quay/package.json`, `packages/quay-native/package.json`, and
`packages/quay-github/package.json`. Rationale: this is the first
tagged, versioned release; the packages are functional and now covered
by a CI-verified automated test suite, but the experiment itself is far
from converged (V_instance/V_meta well under the 0.80 threshold) — a
pre-1.0 minor version (`0.1.0`, not `1.0.0`) honestly signals "usable,
not yet stable/complete," per ordinary semver discipline for early-stage
projects. `package-lock.json` was regenerated by `npm install` and
included. An incidental, pre-existing file-mode inconsistency
(`packages/quay-github/bin/quay-github.js` was `100644`, non-executable,
despite being a shebang'd CLI entry point dating to iteration 17) was
also fixed to `100755` in the same commit, noted honestly as an
unrelated but low-risk drive-by fix.

**Action 4 (real GitHub release) — done, live-verified.** With CI
genuinely green, re-verified σ_strict/V_instance/V_meta against
`experiment/provenance.md`'s current tail before cutting the release
(unchanged: σ_strict = 62/69 = 0.8986, V_instance = 0.5743, V_meta =
0.0973). Created annotated tag `v0.1.0` at commit `10c847b` and pushed
it. Published a real release via `gh release create`:

- **URL**: `https://github.com/yaleh/quay/releases/tag/v0.1.0`
- **Title**: "v0.1.0 -- first tagged pre-1.0 release"
- Release notes accurately describe the repository as the live artifact
  of an **in-progress BAIME methodology-bootstrapping experiment**, not
  a finished/converged product, explicitly citing σ_strict = 0.8986,
  V_instance = 0.5743, V_meta = 0.0973, and stating both V's are well
  below the 0.80 convergence threshold.
- Verified via `gh release view v0.1.0 --repo yaleh/quay`:
  `draft: false`, `prerelease: false`, `published: 2026-07-16T03:34:20Z`.

The human's prior explicit approval for this action (given earlier in
the top-level orchestrating conversation) was relied upon; it was not
re-asked in this iteration.

**Action 5 (V-factor check) — performed fresh, no credit claimed.**
Read both named precedents in `experiment/provenance.md` in full: the
iteration-29 `completeness` reversal (crediting an edit to
`ITERATION-PROMPTS.md`, an out-of-scope document one level removed from
§5.2's actual object) and the iteration-61 `completeness` reversal
(self-certified gap-naming, plus the reinforced rule that documentation
content without same-iteration runtime exercise does not satisfy
`completeness`'s bar). Checked all eight factors against their exact
§5.1/§5.2 defining language:

- `skeleton`, `abi_symmetry`, `gate_correctness`, `skill_convergence`
  (V_instance): none apply. CI-workflow/semver/release work touches
  none of the v0 runtime loop, no CLI/MCP schema-equivalence claim, no
  gate logic, and exercises no new Skill branch — this is ordinary
  release/infra work, not a Skill-driven feature task.
- `completeness` (V_meta): explicitly considered and declined. §5.2
  defines it as "Methodology (Skills + gates + decomposition rule) fully
  documented and self-contained" — i.e. quay-native's own Skills/gate/
  decomposition-rule content. A CI workflow, version numbers, and
  release notes are further removed from that object than either
  reverted precedent (iteration 29's iteration-guidance doc, iteration
  61's actual SKILL.md Method edit) — no plausible claim exists here.
- `effectiveness`: no scope-matched comparator exists for a CI/release
  task shape; this work was not built "via quay-native" as a marginal
  feature increment.
- `reusability`: no second-Provider transfer content was touched.
- `validation`: σ_strict is unchanged (62/69 = 0.8986) since this work
  was not performed via the native gated Skill lifecycle as a
  quay-native feature task; no new self-host proof was generated.

**Conclusion: no V_instance or V_meta factor moves as a result of this
iteration's work.** V_instance remains 0.5743, V_meta remains 0.0973.

All five actions of this directive are now complete and live-verified.
See `experiment/iterations/iteration-75.md` for the full iteration
report and verbatim command transcripts.

## Resolution

- **resolved_by:** iteration 75
- **outcome:** applied in full

All 5 requested actions completed and live-verified across iterations
72, 74, and 75:

1. **README.md** (iteration 74) — root-level, accurate install/usage
   entry point, correctly documenting each binary's real subcommand
   names as live-verified, not guessed.
2. **LICENSE** (iteration 74) — standard unmodified MIT text, copyright
   holder/year sourced from real `git log` output.
3. **CI workflow + semver bump** (iteration 75) — `.github/workflows/
   ci.yml` created and live-verified green on GitHub Actions (run
   `29469214568`, 27/27 tests passing, no orphan processes) after
   diagnosing and fixing two genuine production bugs surfaced by the
   first two (hung) runs: a missing `GH_TOKEN`, then a missing
   `issues:read` permission on this private repo compounded by a
   test-suite robustness gap (`mcp-server.test.mjs` lacked try/finally
   around its MCP client, so an unanticipated `gh api` error left an
   orphaned child process that hung `node --test` indefinitely). All
   four package.json files (root + 3 packages) bumped `0.0.0`/`0.0.1` →
   `0.1.0` with a recorded semver rationale.
4. **Real GitHub release** (iteration 75) — tag `v0.1.0` at commit
   `10c847b`, pushed; release published at
   `https://github.com/yaleh/quay/releases/tag/v0.1.0`, verified via
   `gh release view`; release notes accurately describe the repo as an
   in-progress, unconverged BAIME experiment (σ_strict = 0.8986,
   V_instance = 0.5743, V_meta = 0.0973, both well under the 0.80
   threshold), not a finished product. Human's prior approval for this
   action (given earlier in the top-level orchestrating conversation)
   was relied upon, not re-asked.
5. **V-factor check** (performed fresh each time it was touched,
   iterations 74 and 75) — no V_instance or V_meta factor moves as a
   result of any of this directive's work, per rigorous analysis against
   the exact §5.1/§5.2 defining language and this project's own
   `completeness`-reversal precedents (iterations 29, 61). V_instance
   remains 0.5743, V_meta remains 0.0973 throughout.

No V-factor movement is claimed for this directive's resolution as a
whole.
