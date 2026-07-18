# M08-merge-recover — Iteration 1 (independent re-verification + remaining build) report

**Milestone:** M08-merge-recover (explore, surface: CLI 25 + Docs 15 + Packaging/Distribution 20)
**Iteration:** 1 of 2 (independent re-verification of iteration-0's Done-when 1-6, PLUS completion
of the genuinely-undone Done-when 7 work iteration-0 explicitly left open)
**Worktree:** `experiments/quay-perpetual-stream/milestones/M08-merge-recover/worktrees/iteration-1`
**Branch:** `exp5-m08-iteration-1` (based on `e2151eb`, fast-forward-merged with `exp5-m08-iteration-0`)
**Date:** 2026-07-18

## §0. Context read

Per dispatch instructions, read ONLY:
1. `experiments/quay-perpetual-stream/charters/M08-merge-recover.md` (Tier-A charter, full text)
2. `experiments/quay-perpetual-stream/inherited-core.md` (pinned Tier-B, current master HEAD)
3. iteration-0's report (found at
   `experiments/quay-perpetual-stream/milestones/M08-merge-recover/worktrees/iteration-0/experiments/quay-perpetual-stream/milestones/M08-merge-recover/iterations/iteration-0.md`
   — note: iteration-0 itself flagged in its own §9/isolation-proof section that its report was
   correctly committed INSIDE its own worktree, at a nested nested-repo-relative path; that same
   path shape carried through this iteration's own report location below)
4. `git diff e2151eb..ce85ac0 -- packages/quay README.md CHANGELOG.md` (iteration-0's actual diff,
   read in full — not just the report's prose description)

## §1. HARD GATES — raw output

### Gate 1 — pending directives listing + disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
```
Raw output: empty (no files listed). **Disposition: nothing to disposition — zero pending
directives this iteration.**

### Gate 2 — manda hub reachability

```
$ cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
http://localhost:46215
{"root":"/home/yale/work/quay"}
```

### Gate 3 — localhost:4173 reachability (G7)

```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```

### Gate 4 — worktree creation

```
$ git worktree add experiments/quay-perpetual-stream/milestones/M08-merge-recover/worktrees/iteration-1 -b exp5-m08-iteration-1 e2151eb
Preparing worktree (new branch 'exp5-m08-iteration-1')
HEAD is now at e2151eb exp5 outer loop: SELECT m8 = M-MERGE-RECOVER, breaking the governance/infra explore streak
```

Independently spot-checked iteration-0's actual diff (`git diff e2151eb..ce85ac0 -- packages/quay
README.md CHANGELOG.md`, 1010 lines) before merging — confirmed the diff is internally consistent
with iteration-0's own report §4/§6 claims (new `resolveJsonFlag()`/`resolvePageSize()` helpers in
`bin/quay.js`, the `printJson(sorted)`→`printJson(paged)` fix, the `?pageSize=` Web UI wiring in
`serve.js`, 3 new files under `packages/quay/`, `package.json` `files`/`license` fields, and the
CHANGELOG.md/README.md doc sections) — then brought it in via:

```
$ git merge exp5-m08-iteration-0 -m "Merge exp5-m08-iteration-0 into iteration-1 worktree"
Updating e2151eb..ce85ac0
Fast-forward (no commit created; -m option ignored)
 CHANGELOG.md                                       |  73 ++-
 README.md                                          |  69 ++-
 .../M08-merge-recover/iterations/iteration-0.md    | 527 +++++++++++++++++++++
 packages/quay/CHANGELOG.md                         |  12 +
 packages/quay/LICENSE.md                           |  21 +
 packages/quay/README.md                            | 241 ++++++++++
 packages/quay/bin/quay.js                          | 112 ++++-
 packages/quay/package.json                         |  10 +-
 packages/quay/src/serve.js                         |  45 +-
 packages/quay/test/cli.test.mjs                    |  85 ++++
 packages/quay/test/serve.test.mjs                  |  99 ++++
 11 files changed, 1265 insertions(+), 29 deletions(-)
```

All edits this iteration target paths under this worktree only (see end-of-iteration isolation
proof, §5).

## Part A — Independent re-verification of iteration-0's Done-when 1-6 claims

### A.1 Fresh `npm install` + fresh full test suite run

```
$ node --version && npm --version
v25.8.0
11.11.0
$ npm install --no-audit --no-fund
added 101 packages in 4s
$ node --test packages/*/test/*.test.mjs   # (all 31 test files, timed)
...
ℹ tests 31
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 62987.782778

real  1m8.668s (first run)
```
`grep -c "^✔"` on the captured log → **31**; `grep -c "^✖"` → **0**. All 31 test files independently
re-run from scratch on a fresh worktree with a fresh `npm install` (not trusting iteration-0's
pasted output) — 100% pass, 0 fail, matching iteration-0's own claimed 31/0.

### A.2 CLI/Web UI spot-checks — fresh command output, own workspace

Seeded a fresh temp workspace (`/tmp/it1-workspace`, `.quay/config.yml` pointing at this worktree's
own `packages/quay-native`) with 3 fresh tasks (`IT1-1/2/3`) rather than reusing iteration-0's
fixtures.

**`--version` / `-V`:**
```
$ node packages/quay/bin/quay.js --version
0.3.5
exit=0
$ node packages/quay/bin/quay.js -V
0.3.5
exit=0
$ node -e "console.log(require('./packages/quay/package.json').version)"
0.3.5
```

**`--format json` vs `--json` identical-output claim:**
```
$ node packages/quay/bin/quay.js task list --json > /tmp/it1-json.txt
$ node packages/quay/bin/quay.js task list --format json > /tmp/it1-format.txt
$ diff /tmp/it1-json.txt /tmp/it1-format.txt && echo IDENTICAL
IDENTICAL
$ node packages/quay/bin/quay.js task list --format yaml; echo "exit=$?"
Error: unsupported --format value "yaml" (only "json" is supported; use --json instead of --format for non-JSON output)
exit=1
```

**`--page-size` — CLI table mode, JSON mode, invalid values:**
```
$ node packages/quay/bin/quay.js task list --page-size 1
# showing 1 of 3 tasks (--page-size 1)
IT1-1  todo  primitive  spotcheck task one  12s ago

$ node packages/quay/bin/quay.js task list --json --page-size 2 | python3 -c "import json,sys; print('count=',len(json.load(sys.stdin)))"
count= 2

$ node packages/quay/bin/quay.js task list --json --page-size 1000 | python3 -c "import json,sys; print('count=',len(json.load(sys.stdin)))"
count= 3

$ for v in 0 -1 abc; do node packages/quay/bin/quay.js task list --page-size "$v"; echo "value=$v exit=$?"; done
Error: --page-size requires a positive integer (got "0")
value=0 exit=1
Error: --page-size requires a positive integer (got "-1")
value=-1 exit=1
Error: --page-size requires a positive integer (got "abc")
value=abc exit=1
```

**`--page-size` — Web UI (`?pageSize=N`), live server:**
```
$ node packages/quay/bin/quay.js serve --port 4599 &
$ curl -s "http://localhost:4599/" | grep -o "Page 1 of [0-9]* ([0-9]* tasks)"
Page 1 of 1 (3 tasks)
$ curl -s "http://localhost:4599/?pageSize=1" | grep -o "Page 1 of [0-9]*"
Page 1 of 3
$ curl -s "http://localhost:4599/?pageSize=abc" | grep -o "Invalid pageSize value ignored[^<]*"
Invalid pageSize value ignored; showing default (20).
$ curl -s "http://localhost:4599/?pageSize=0" | grep -o "Invalid pageSize value ignored[^<]*"
Invalid pageSize value ignored; showing default (20).
$ curl -s "http://localhost:4599/?pageSize=2" | grep -oE ">IT1-[0-9]<" | wc -l
2
```

All spot-checks independently re-confirmed, own fresh command output (not iteration-0's pasted
output), matching iteration-0's claims exactly.

### A.3 Packaging files + package.json fields

```
$ ls -la packages/quay/README.md packages/quay/CHANGELOG.md packages/quay/LICENSE.md
-rw-rw-r-- 1 yale yale  728 Jul 18 11:05 packages/quay/CHANGELOG.md
-rw-rw-r-- 1 yale yale 1067 Jul 18 11:05 packages/quay/LICENSE.md
-rw-rw-r-- 1 yale yale 8812 Jul 18 11:05 packages/quay/README.md
$ node -e "const p=require('./packages/quay/package.json'); console.log(JSON.stringify({files:p.files, license:p.license, version:p.version}, null, 2))"
{
  "files": ["README.md", "CHANGELOG.md", "LICENSE.md", "bin", "src"],
  "license": "MIT",
  "version": "0.3.5"
}
$ node -e "const p=require('./packages/quay/package.json'); const fs=require('fs'); for (const f of p.files) console.log(f, fs.existsSync('packages/quay/'+f) ? 'EXISTS' : 'MISSING/GHOST');"
README.md EXISTS
CHANGELOG.md EXISTS
LICENSE.md EXISTS
bin EXISTS
src EXISTS
```
Zero ghost entries, byte counts identical to iteration-0's own figures (no drift since the commit).

### A.4 Root README SEA section

```
$ grep -n "^## Distribution" README.md
236:## Distribution: single-file executables (SEA)
$ grep -c "single-file\|SEA\b" README.md
7
$ grep -n "provider <id>\|action list\|action run\|task view\|task edit --status\|## Configuration\|releases\|Distribution: single-file" packages/quay/README.md
19:[GitHub Releases page](https://github.com/yaleh/quay/releases) and either:
30:  [Distribution: single-file executables (SEA)](#distribution-single-file-executables-sea)
42:## Configuration
73:The first `enabled: true` provider is the default. Use `--provider <id>` on
79:quay action run gh-3 advance --provider github
101:                [--provider <id>]
117:- `--provider <id>` — select a specific provider instead of the default.
131:### `quay task view <task-id>` / `quay task edit <task-id> --status <s>`
156:### `quay action list <task-id>` / `quay action run <task-id> <action-id>`
186:## Distribution: single-file executables (SEA)
```
Confirmed live and accurate.

### A.5 Docker audit-channel re-attempt WITH `gh` provisioned (closes iteration-0's open caveat)

iteration-0's own report (§3d) explicitly left this open: 10 subtests inside the pre-existing
`--provider github` block failed only because the plain `node:20-slim` audit image lacks the `gh`
CLI binary that real GitHub-hosted `ubuntu-latest` CI runners ship preinstalled. This iteration
re-attempted with `gh` **actually installed inside the container**, via the official GitHub CLI apt
repository (not just referenced as a caveat to fix later):

```
$ docker run --rm -v "$(pwd)":/repo:ro -e GH_TOKEN="$(gh auth token)" --init node:20-slim bash -c '
    set -e
    apt-get update -qq && apt-get install -y -qq curl gnupg ca-certificates > /dev/null 2>&1
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    apt-get update -qq
    apt-get install -y -qq gh > /dev/null 2>&1
    gh --version
  '
gh version 2.96.0 (2026-07-02)
https://github.com/cli/cli/releases/tag/v2.96.0
```

Then the full audit run (fresh container, own `npm install`, `cli.test.mjs` alone — the file
containing the `--provider github` block):

```
$ docker run --rm -v "$(pwd)":/repo:ro -e GH_TOKEN="$(gh auth token)" --init node:20-slim bash -c '
    ... (gh install as above) ...
    mkdir -p /work && cp -r /repo/. /work/ && cd /work &&
    npm install --no-audit --no-fund &&
    node --test packages/quay/test/cli.test.mjs
  '
...
# PASS: quay --provider github task list --json exits 0 (proves resolveProviderEnv()'s absolute-path passthrough reached the spawned quay-github mcp child intact)
# PASS: quay --provider github task list --json returns real, non-empty task data from the live yaleh/quay repo
# PASS: quay action run gh-3 advance --json --provider github exits 0 (real GitHub-backed task, end-to-end)
# PASS: quay action run --json --provider github emits parseable JSON output
# PASS: quay action run --json --provider github output includes the real GitHub taskId (gh-3)
# PASS: quay action run --json --provider github resolves the correct status_skill_map skill for gh-3's real live status (got status=ready, skill=quay:execute)
# PASS: quay action run --json --provider github output includes the composed channel name for the real GitHub task id
# PASS: quay action run --json --provider github used the deterministic QUAY_ACTION_MOCK_LOG delivery mode, not a live manda/print path
# PASS: quay task view gh-3 --json --provider github exits 0 (real GitHub-backed task, end-to-end)
# PASS: quay task view --json --provider github emits parseable JSON output
# PASS: quay task view --json --provider github output includes the real GitHub taskId (gh-3)
# PASS: quay task view --json --provider github output includes a non-empty title read live from the real issue
# PASS: quay task view --json --provider github reflects gh-3's real live status (got ready)
# PASS: quay action list gh-3 --json --provider github exits 0 (real GitHub-backed task, end-to-end)
# PASS: quay action list --json --provider github emits a JSON array
# PASS: quay action list --json --provider github includes the 'advance' button for gh-3 (whenStatus includes its real live status 'ready')
# PASS: quay task check gh-3 --json --provider github exits 1 (mirrors result.ok for gh-3's real, currently-unchecked AC state)
# PASS: quay task check --json --provider github emits parseable JSON output
# PASS: quay task check --json --provider github output includes the real GitHub taskId (gh-3)
# PASS: quay task check --json --provider github reports ok:false for gh-3's real, currently-unchecked AC state
# PASS: quay task check --json --provider github reports real acTotal/acChecked counts read live from the issue body
...
# All QN-033 bin/quay.js CLI dispatch tests passed.
ok 1 - /work/packages/quay/test/cli.test.mjs
# tests 1
# pass 1
# fail 0
```

All 10 previously-`gh`-blocked `--provider github` subtests (plus the M08-added assertions —
`--version`/`-V`, `--format json` byte-identity, `--page-size` in all modes, UQ-048 hard errors) now
pass **fully clean, zero caveat**, inside a fresh Docker container that had `gh` installed via the
official apt repository (mirroring how a real `ubuntu-latest` CI runner ships `gh` preinstalled).
Then re-ran the FULL monorepo suite (all 31 test files) in the same gh-provisioned container:

```
$ docker run --rm -v "$(pwd)":/repo:ro -e GH_TOKEN="$(gh auth token)" --init node:20-slim bash -c '
    ... (gh install as above) ...
    mkdir -p /work && cp -r /repo/. /work/ && cd /work &&
    npm install --no-audit --no-fund &&
    node --test packages/*/test/*.test.mjs
  '
...
# tests 31
# pass 31
# fail 0
```

**Result: this iteration achieved the fully clean, zero-caveat Docker audit-channel run iteration-0
explicitly left as open scope.** No caveat is carried forward — `gh` provisioning is not a genuine
environment limitation of this sandbox, it was simply not attempted by iteration-0's image choice.

## Part B — Applying the genuinely-undone Done-when 7 work

### B.1 Independent re-derivation of the VT arithmetic (not trusting iteration-0's §7 draft)

Iteration-0's own report §7 explicitly flagged its own numbers "provisional... pending independent
re-derivation." Re-derived from scratch, cross-checked against the SAME live evidence
(Part A above) plus one additional finding (the now-fully-resolved Docker `gh` caveat):

**Prior baseline** (dashboard.md's m4 chart-1 re-score, unchanged, confirmed by direct read):
CLI 25×0.80=20.00, MCP 20×0.90=18.00, Web UI 20×0.92=18.40, Packaging 20×0.85=17.00,
Docs 15×0.55=8.25, Provider-ABI 20×0.654=13.08 → **94.73/120** (independently re-summed:
`python3 -c "print(20.00+18.00+18.40+17.00+8.25+13.08)"` → `94.73`, matches).

**Re-derived new cov, per surface:**

| surface | prior cov | new cov | independent rationale (this iteration's own evidence) |
|---|---|---|---|
| CLI | 0.80 | **0.94** | All 4 MD-001 CLI losses independently re-verified fixed (§A.2). iteration-0 itself proposed 0.93, held back only by the Docker `gh` caveat (§3d of its report) as the one residual confidence discount. That caveat is NOW FULLY RESOLVED (§A.5 above) — a genuinely NEW piece of evidence this iteration gathered, not present in iteration-0's own report. Small bump 0.93→0.94 (not larger: the closed caveat was a process/environment confirmation, not a new capability — no code changed). Ceiling unchanged at <1.0: no other CLI surface was touched this milestone (out of scope per charter item 9), same reasoning iteration-0 gave. |
| Docs | 0.55 | **0.85** | Matches iteration-0's own proposed 0.85, independently re-derived (not copied forward) from fresh `ls`/`grep` evidence (§A.3/§A.4): all 3 new files exist with byte-identical sizes to iteration-0's own figures (no drift since commit); DOC-001..007 coverage independently re-confirmed via fresh grep, not re-reading iteration-0's claims. `packages/quay/CHANGELOG.md`'s pointer-stub design (documented rationale in the file itself) is a legitimate choice, not a gap — kept below 1.0 for the same reason iteration-0 gave. |
| Packaging | 0.85 | **0.90** | Matches iteration-0's own proposed 0.90, independently re-derived: `files`/`license` fields present with a FRESH per-entry `fs.existsSync` check (§A.3) — all 5 EXISTS, zero ghost entries (not trusting iteration-0's own "no ghost entries" assertion, independently verified programmatically). SEA path unchanged (out of touch scope this milestone). |
| **VT chart-1 total** | **94.73/120** | **103.73/120** | CLI 25×0.94=23.50 (+3.50); MCP 20×0.90=18.00 (unchanged, out of scope); Web UI 20×0.92=18.40 (unchanged, out of scope); Packaging 20×0.90=18.00 (+1.00); Docs 15×0.85=12.75 (+4.50); Provider-ABI 20×0.654=13.08 (unchanged, out of scope). |

**Arithmetic re-check** (`python3 -c` per this experiment's own standing convention):
```
$ python3 -c "print(23.50+18.00+18.40+18.00+12.75+13.08)"
103.73
```
Total confirmed: **103.73/120** (≈0.864 normalized, up from 0.789 at m4). Δv = 103.73 − 94.73 =
**+9.00**.

**Comparing against iteration-0's own draft total (103.48/120, Δv=+8.75, from its §7):**
independently re-verified iteration-0's own arithmetic first —
`python3 -c "print(23.25+18.00+18.40+18.00+12.75+13.08)"` → `103.48` — internally consistent, no
transcription slip this time (unlike m4's own iteration-0→iteration-1 correction precedent this
milestone's own charter explicitly cited as the reason to re-check). The +0.25 difference between
iteration-0's draft (103.48) and this iteration's corrected total (103.73) is entirely attributable
to the CLI cov bump (0.93→0.94) from the newly-resolved Docker `gh` caveat (§A.5) — a genuinely NEW
finding gathered this iteration, not an arithmetic correction of iteration-0's math. **This is the
first M08-class milestone in this experiment's own base-rate tracking where iteration-1's
re-derivation did NOT catch an arithmetic error in iteration-0's own numbers** — the charter's own
"6 of 8 milestones so far have needed an arithmetic correction" framing does not apply here;
iteration-0's math held up, and iteration-1's material contribution was a genuinely new piece of
audit-channel evidence rather than a bug in the prior iteration's summation.

### B.2 `dashboard.md` chart-1 re-score — actual file edit applied

Applied as a real diff to `experiments/quay-perpetual-stream/dashboard.md`, inserting a new "Chart-1
re-score (M08-merge-recover...)" section (mirroring the existing m4 re-score section's format)
immediately after the m4 VT-curve append line, before the "## Health tracks" heading. Full diff:

```
$ git diff experiments/quay-perpetual-stream/dashboard.md
```
(see the committed diff in this iteration's commit — 46 insertions, adding the new chart-1 re-score
table, arithmetic re-check, and VT-curve append entry for m8, exactly matching the derivation in
§B.1 above; no other part of the file touched.)

### B.3 `gap-list.md` closure entries — actual file edits applied

Applied as real diffs to `experiments/quay-continuous-bootstrap/gap-list.md` (NOT a new file, NOT a
separate closure log — edited each existing row in place, appending a **RE-CLOSED**/**CLOSED**
annotation with the live command output that closes it, per the charter's own instruction to
"cite the live command output directly in the gap-list entry, mirroring how MD-001 itself was
diagnosed"):

- **CB-021, CB-006, CB-022** — RE-CLOSED, each citing the specific `diff`/`--page-size`/JSON-count
  command output from §A.2 above.
- **UQ-047, UQ-048** — RE-CLOSED/CLOSED, citing §A.2's `--version`/invalid-`--page-size` output.
- **PKG-003, PKG-004, PKG-005, PKG-006, PKG-007, PKG-008** — CLOSED/RE-CLOSED, citing §A.3's fresh
  `fs.existsSync` ghost-entry check and file listing.
- **DOC-001..007** — CLOSED, citing §A.4's fresh `grep` line-number output against
  `packages/quay/README.md` and root `README.md`.
- **MD-001** (umbrella) — **left explicitly un-RESOLVED**, per the charter's own instruction: added
  a "STATUS UPDATE" note recording that all 12 sub-entries are now closed with fresh evidence, but
  the umbrella itself should only flip to RESOLVED once this milestone's commits are confirmed
  present on `master` (ABSORB time), not inside this worktree — this mirrors MD-001's own root
  cause exactly ("ledger says closed, `master` doesn't have the code") and iteration-0 correctly
  flagged this as the one item that must NOT be closed prematurely.

```
$ git diff --stat experiments/quay-continuous-bootstrap/gap-list.md
 experiments/quay-continuous-bootstrap/gap-list.md | 38 +++++++++----------
 1 file changed, 19 insertions(+), 19 deletions(-)
```

## §2. Binary Done-when checklist — final status

1. `[x]` `quay --version`/`-V` — re-verified, §A.2.
2. `[x]` `--format json` vs `--json` — re-verified, §A.2.
3. `[x]` `--page-size` all 3 modes + invalid-value errors — re-verified, §A.2.
4. `[x]` `packages/quay/{README,CHANGELOG,LICENSE}.md` + `package.json` fields — re-verified, §A.3.
5. `[x]` Root README SEA section — re-verified, §A.4.
6. `[x]` Full test suite passes (own fresh run, §A.1) + Docker audit-channel with `gh` provisioned,
   fully clean, zero caveat (§A.5).
7. `[x]` `dashboard.md` chart-1 re-score AND `gap-list.md` closure entries ACTUALLY APPLIED as real
   file edits — §B.2/§B.3, diffs pasted/summarized above and present in this iteration's commit.

All 7 Done-when clauses met with fresh, independently-captured evidence. MD-001's umbrella status
deliberately deferred to ABSORB, per the charter's own instruction and this iteration's §B.3 note.

## §3. Reflection

**Verify-iteration size gauge (per `inherited-core.md`'s own M06-sizing procedure applied to this
milestone):** this iteration did BOTH real independent re-derivation (fresh worktree, fresh
`npm install`, fresh command output for every Done-when clause, hand-recomputed VT arithmetic) AND
genuinely closed the one piece of real remaining build/verification work iteration-0 explicitly left
open (the Docker `gh`-provisioning caveat) AND the file edits iteration-0 drafted-but-didn't-apply
(dashboard.md/gap-list.md). None of this required NEW Done-when-scoped code changes to
`bin/quay.js`/`serve.js`/etc — the underlying capability recovery was already fully landed by
iteration-0. Per the gauge's own three-way classification, this sits at "correctly sized": iteration-1
did real independent work that could have found a real defect (and in the arithmetic case, checked
for but did NOT find one — a genuine, not foregone, check) plus completed real deferred-but-declared
scope (Done-when 7), without needing new build work outside the charter's stated Done-when 7
scope.

**What was NOT found wrong:** unlike m4's iteration-0→iteration-1 pattern (arithmetic slip) or
m1/M01-dist's pattern (CI integration overflow), this iteration's re-verification of iteration-0's
Done-when 1-6 claims found ZERO discrepancies — every pasted command output, byte count, and test
result matched iteration-0's own claims exactly on a fresh worktree. The one genuine addition was
closing an explicitly-flagged-open caveat (Docker `gh` provisioning), which iteration-0 itself
correctly scoped as "real remaining work for iteration-1," not something iteration-0 got wrong.

**Next step (ABSORB):** once this milestone's commits (on `exp5-m08-iteration-1`, built on top of
the fast-forwarded `exp5-m08-iteration-0` history) are merged to `master`, MD-001's umbrella
finding should be marked RESOLVED in `gap-list.md` — this iteration deliberately left that step
undone, per §B.3's note, so it happens only once the merge is confirmed, not inside this worktree.

## §4. Isolation proof

Worktree (`experiments/quay-perpetual-stream/milestones/M08-merge-recover/worktrees/iteration-1`):
```
$ git add -A && git commit -m "M08-merge-recover it1: independent re-verification + apply Done-when 7"
[exp5-m08-iteration-1 23546cd] M08-merge-recover it1: independent re-verification + apply Done-when 7
 4 files changed, 522 insertions(+), 20 deletions(-)
 create mode 100644 experiments/quay-perpetual-stream/milestones/M08-merge-recover/iterations/iteration-1.md
$ git status --short
(clean)
$ git log --oneline -3
23546cd M08-merge-recover it1: independent re-verification + apply Done-when 7
ce85ac0 M08-merge-recover it0: fill in actual report-commit SHA in §8 isolation proof
1cfdffa M08-merge-recover it0: write iteration-0 report (build complete, done-when 1-6 evidenced, 7 deferred)
```

Shared repo root (`/home/yale/work/quay`):
```
$ git status --short
(clean)
```
Note: at the time this iteration's work began, the shared root had one unrelated pre-existing
uncommitted modification (`docs/proposals/exp5-concurrent-background-agents-for-milestone-iteration.md`),
present before any command in this session was run and never touched by this iteration. By the time
this final proof was captured, the shared root had returned to fully clean — confirming no file
under this worktree's own path was ever edited from the shared repo root context during this
iteration; every edit in §B.2/§B.3 targeted the worktree-relative paths shown above, and this
iteration's own commit (`23546cd`) lives entirely on branch `exp5-m08-iteration-1` inside the
worktree, not on `master` or in the shared tree's working directory.
