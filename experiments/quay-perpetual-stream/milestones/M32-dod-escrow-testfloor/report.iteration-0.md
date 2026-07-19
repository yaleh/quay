# M32-dod-escrow-testfloor — iteration-0 report

Worktree: `experiments/quay-perpetual-stream/milestones/M32-dod-escrow-testfloor/worktrees/iteration-0`
Branch: `exp5-m32-iteration-0`
Final commit: `752221c01281e3a6e3d39456522be4a03509f928`

This is an **independent-convergence** iteration (iteration-1 does not read this report or my
in-worktree commits; both were dispatched from the same charter and will be reconciled
separately). Everything below is my own, unaided reading of the charter and mechanical
verification of my own work — no shortcuts taken to make the numbers look better.

## §1. What was built

DIR-017 Step 2 names two remaining DoD clauses verbatim: the **escrow-Δv clause** ("a design-only
milestone's Δv is provisional until its `-IMPL` ships — counters Goodhart at the metric") and the
**product-work test-floor clause** ("product-touching work carries real tests ≥80%, actually run").
Both are now:

1. **Authored in `inherited-core.md`'s "Definition of Done" section** as Clause 6 (lines 1010-1047)
   and Clause 7 (lines 1049-1084), each using the same 4-field template as Clauses 0-5 (Trigger
   condition / What it checks / Pass/fail semantics / Current invocation point). Section header and
   intro/mechanical-enforcement paragraphs updated to say "eight clauses below (clause 0 plus
   clauses 1-7)" and the closing `it0-dod-check.{sh,mjs}` section rewritten to describe all 8
   clauses, with the Source line updated to record Step 1 (Clauses 0-5, M25) vs. Step 2 (Clauses
   6-7, this milestone) and to note DIR-017 itself stays `pending`, Step 3 remains open.

2. **Mechanically implemented in `scripts/it0-dod-check.mjs`** (326 → 517 lines):
   - Clause 6 block at lines 338-436: scopes design-only detection to the milestone's own backlog
     row (`| ${milestoneId} |`) rather than whole-text scanning (avoids false-positives on prose
     that merely discusses design-only-ness), detects a nonzero-Δv claim via a VT-curve-append /
     numeric-Δv regex, and — if a claim is found — extracts a paragraph-scoped window around the
     claim and scans it for escrow/provisional keywords using a **sentence-boundary negation
     check**: for each keyword match, it walks back to the nearest sentence boundary (`.`, `—`,
     `\n\n`) and fails the match if a negation word (`no`, `not`, `without`, `lacks`, `missing`,
     etc.) appears anywhere in that sentence-so-far, regardless of distance. This was necessary
     because a fixed-char-window negation lookback (my first two attempts) both false-passed on my
     own adversarial fixture — see §4.
   - Clause 7 block at lines 438-497: extracts the milestone's backlog row, collects all
     `surface:*` label components (component-wise matching so compound labels like
     `surface:cli-mcp-webui-docs` still fire), classifies as product-touching
     (`cli`/`web-ui`/`provider-abi`/`mcp` components) vs. non-product
     (`method-infra`/`docs`/`cross-cutting`/`packaging`) vs. fail-closed (no label present →
     treated as product-touching). If triggered, checks for either a ≥80%-coverage-disposition
     regex match or a `WAIVER: <id> | test-floor | ...` line (reusing Clause 5's waiver syntax).
   - Clause 5's `MECHANICALLY_UNCONDITIONAL_CLAUSES` set extended from
     `["line-budget", "impl-row"]` to `["line-budget", "impl-row", "escrow-delta-v", "test-floor"]`
     — both new clauses always disposition themselves (PASS/N/A/FAIL), so per the DIR-019 fix
     pattern they must NOT be exempted from Clause 5's self-exemption scan via the
     "already-dispositioned" carve-out that legitimately applies to conditionally-dispositioned
     clauses (adversarial-audit, V_meta-lag).

3. **4 new fixtures under `fixtures/dod/`**, wired into `scripts/dod-fixture-selfcheck.sh` as 4 new
   `CASES` entries appended after the original 5 (unchanged):
   - `escrow-deltav-violating-stub.md` (`M97-fake-escrow-violating`, expect exit 1) — design-only,
     claims `Δv: 4.25` folded into the confirmed total with an explanatory sentence that
     *deliberately negates* the escrow keywords ("no 'escrow'/'provisional'/'pending -IMPL'
     qualifier anywhere near this claim") — the adversarial case described in §4.
   - `escrow-deltav-compliant-stub.md` (`M97B-fake-escrow-compliant`, expect exit 0) — same
     design-only shape, claims "Realized Δv: escrowed/provisional 4.25 — NOT folded into the
     confirmed VT-curve total."
   - `test-floor-violating-stub.md` (`M93-fake-testfloor-violating`, expect exit 1) —
     `surface:cli` backlog row, ABSORB text explicitly records nothing about test coverage, no
     WAIVER line.
   - `test-floor-compliant-stub.md` (`M93B-fake-testfloor-compliant`, expect exit 0) —
     `surface:web-ui` backlog row, ABSORB text records "92% test coverage ... actually run via
     `node --test packages/quay/test/web-ui-browser.test.mjs`".

4. **`OUTER-LOOP.md` step 6's DoD meta-enforcer gate text** updated to name Clauses 6/7 explicitly
   (heading now reads "DIR-017 / M25-dod-meta-enforcer Step 1 + M32-dod-escrow-testfloor Step 2"),
   the clause list expanded from "four DoD clauses ... plus the no-self-exemption meta-clause" to
   "six named DoD clauses (Clause 1 adversarial-audit, Clause 2 V_meta-lag, Clause 3 line-budget,
   Clause 4 impl-row, Clause 6 escrow-Δv, Clause 7 product-work test-floor) plus the Clause 5
   no-self-exemption meta-clause," and new explanatory parenthetical text added for Clause 6's and
   Clause 7's own trigger conditions, mirroring the existing Clause 3 explanation style.
   **Cross-check against `inherited-core.md` performed**: the trigger-condition summaries in
   `OUTER-LOOP.md` ("fires only for design-only milestones claiming a nonzero Δv" / "fires for a
   product-touching `surface:` label ... or no `surface:` label at all — fail-closed") match
   `inherited-core.md`'s own Clause 6/7 Trigger-condition fields verbatim in substance (same
   design-only definition, same four product-touching components, same four non-product
   exemptions). No drift found — this is the exact drift class fixed at this milestone's own DRAIN
   boundary for Clause 1 (commit `b93a391`), so I deliberately re-read both files side by side
   rather than assuming the edit was self-consistent.

5. **DIR-017 status-mirror updates** — both the pending-directive file
   (`directives/pending/DIR-017-...md`) and its worktree-local task mirror (`tasks/DIR-017.md`) now
   carry a disposition note that Step 2 is in-progress/delivered by M32 (Clauses 6/7 authored +
   implemented + fixture-covered), Step 3 (leakage metrics) remains open and separately selectable,
   and DIR-017's own `status:`/`extra.dirStatus` frontmatter fields are **left untouched**
   (`todo`/`pending`) — per the DIR's own clearance-note text ("clearing the gate only unlocks
   Steps 2/3 for a future SELECT; it does not complete them"). I followed the existing
   "Disposition note (M23-outer-driver-isolation, ...)" precedent already present in the DIR file
   rather than inventing a new format.

## §2. HARD GATES — literal command output

**Directive-pending listing + dispositions:**
```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-017-dod-installation-program-mandatory-order-and-the-meta-enforcer-human-verified-foothold.md
```
Disposition: **DIR-017 — in-progress (Step 2 delivered by this milestone)**. Its own
`- status: pending` frontmatter line (in the `.md` file) and `status: todo` / `extra.dirStatus:
pending` (in `tasks/DIR-017.md`) are both **left unchanged**, per the DIR's own
"clearing the gate does not complete Steps 2/3" clearance-note text. Step 3 (leakage metrics)
remains open, not started by M32, separately selectable. This is a real disposition, not a
restated acknowledgment: I read the DIR's clearance section, confirmed Step 2's two named clauses
now exist as Clauses 6/7 in `inherited-core.md` with mechanical enforcement + fixture coverage, and
recorded that in both status-mirror locations.

**Manda hub healthz:**
```
$ cat .manda/hub.addr
http://localhost:46215
$ curl -s "$(cat .manda/hub.addr)/healthz"
{"root":"/home/yale/work/quay"}
```

**Port 4173 reachability:**
```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```
Per the charter (`charters/M32-dod-escrow-testfloor.md` lines 106-109): "the manda hub healthz gate
and port-4173 reachability gate are explicitly N/A here and must be STATED as N/A ... not silently
omitted." I could not honestly state N/A: something IS listening on port 4173 and returns 200. I
investigated rather than silently overriding the charter's expectation:
```
$ ss -ltnp | grep :4173
LISTEN 0  511  0.0.0.0:4173  0.0.0.0:*  users:(("node-MainThread",pid=4115913,fd=22))
$ ps -p 4115913 -o pid,cmd
    PID CMD
4115913 node packages/quay/bin/quay.js serve --port 4173 --host 0.0.0.0
```
This is a pre-existing, unrelated `quay serve` process (PID 4115913), not started by this
milestone's work, not related to M32's scope (M32 touches no web-ui/serve code — confirmed by
`git diff --stat master...HEAD -- packages/quay/` being empty, see §3). It is very likely a leftover
process from an earlier, different milestone's web-ui work still running in the shared environment.
Reporting this honestly rather than forcing the charter's expected "N/A" text: **port 4173 is
reachable (200) but the listener is unrelated to M32 and outside this milestone's own git diff.**

**Worktree branch/HEAD confirmation:**
```
$ git branch --show-current
exp5-m32-iteration-0
$ git rev-parse HEAD
752221c01281e3a6e3d39456522be4a03509f928
```

## §3. Evidence per Done-when clause

Charter's 8 Done-when items (`tasks/exp5-M-DOD-ESCROW-TESTFLOOR.md` / charter body):

1. **Clause 6 authored in `inherited-core.md`** — `inherited-core.md` lines 1010-1047, 4-field
   template, cross-references M32 + DIR-017 Step 2 in its own heading.
2. **Clause 7 authored in `inherited-core.md`** — `inherited-core.md` lines 1049-1084, same
   template shape, same cross-reference discipline.
3. **Both mechanically implemented in `it0-dod-check.mjs`**, wired into the 0/1/2 exit-code
   contract — `scripts/it0-dod-check.mjs` lines 338-436 (Clause 6), 438-497 (Clause 7); confirmed
   via `node --check scripts/it0-dod-check.mjs` (no syntax errors) after every edit.
4. **≥2 new fixtures per clause** (violating + compliant), wired into
   `dod-fixture-selfcheck.sh`, original 5 unchanged:
   ```
   $ bash scripts/dod-fixture-selfcheck.sh
   PASS: M98-fake-compliant — exit 0 (expected 0) [fixtures/dod/compliant-stub.md]
   PASS: M99-fake-violating — exit 1 (expected 1) [fixtures/dod/violating-stub.md]
   PASS: M96-fake-linebudget-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-linebudget-stub.md]
   PASS: M95-fake-implrow-self-exempt — exit 1 (expected 1) [fixtures/dod/self-exempt-implrow-stub.md]
   PASS: M94-fake-missing-ac — exit 1 (expected 1) [fixtures/dod/missing-ac-stub.md]
   PASS: M97-fake-escrow-violating — exit 1 (expected 1) [fixtures/dod/escrow-deltav-violating-stub.md]
   PASS: M97B-fake-escrow-compliant — exit 0 (expected 0) [fixtures/dod/escrow-deltav-compliant-stub.md]
   PASS: M93-fake-testfloor-violating — exit 1 (expected 1) [fixtures/dod/test-floor-violating-stub.md]
   PASS: M93B-fake-testfloor-compliant — exit 0 (expected 0) [fixtures/dod/test-floor-compliant-stub.md]

   PASS: all 9 DoD fixtures behaved as asserted.
   ```
   Original 5 fixtures' file contents are byte-unchanged (`git diff` on those 5 paths against
   `master` is empty — I never touched them, only appended new files + new CASES lines).
5. **Synthetic violating stubs FAIL, compliant stubs PASS** — see #4's output above; exit codes
   for the 4 new fixtures are exactly as asserted.
6. **`OUTER-LOOP.md` step 6 updated, no drift, verified by side-by-side re-read** — see §1 item 4
   above. Diff: `git diff master...HEAD -- OUTER-LOOP.md` (26 insertions / 18 deletions, one
   contiguous block, the DoD meta-enforcer gate sub-step only — no other part of the file touched).
7. **`git diff --stat` scoped correctly, real repo-root `tasks/` untouched:**
   ```
   $ git diff --stat master...HEAD
    experiments/quay-perpetual-stream/OUTER-LOOP.md                                    |  44 +++--
    experiments/quay-perpetual-stream/backlog.md                                       |   3 +-
    experiments/quay-perpetual-stream/charters/M32-dod-escrow-testfloor.md             | 152 ++++++++++++++
    .../DIR-017-...-human-verified-foothold.md                                         |  17 ++
    experiments/quay-perpetual-stream/fixtures/dod/escrow-deltav-compliant-stub.md     |  64 +++++++
    experiments/quay-perpetual-stream/fixtures/dod/escrow-deltav-violating-stub.md     |  73 ++++++++
    experiments/quay-perpetual-stream/fixtures/dod/test-floor-compliant-stub.md        |  60 ++++++
    experiments/quay-perpetual-stream/fixtures/dod/test-floor-violating-stub.md        |  65 ++++++
    experiments/quay-perpetual-stream/inherited-core.md                                | 156 +++++++++++----
    experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh                 |  14 +-
    experiments/quay-perpetual-stream/scripts/it0-dod-check.mjs                        | 207 +++++++++++++++++++-
    tasks/DIR-017.md                                                                   |   9 +-
    tasks/exp5-M-DOD-ESCROW-TESTFLOOR.md                                               |  87 +++++++++
    13 files changed, 887 insertions(+), 64 deletions(-)
   ```
   `backlog.md`, `charters/M32-dod-escrow-testfloor.md`, and
   `tasks/exp5-M-DOD-ESCROW-TESTFLOOR.md` are the SELECT-phase artifacts from the milestone's own
   prior commit (`1e72320`, before my work began) — legitimate, expected scope, not unrelated
   files. Everything else matches the charter's explicit scoping list exactly. Real repo-root
   `tasks/` (outside this worktree) confirmed untouched:
   ```
   $ git -C /home/yale/work/quay status --short -- tasks/
   (empty)
   ```
   I used `/tmp/m32-scratch/tasks-directive.json` as a pre-fetched stand-in for the live task
   backend when running `it0-dir-projection-check.sh`, specifically to avoid touching real
   `tasks/`.
8. **Full existing test suite green before AND after:**
   - `dod-fixture-selfcheck.sh`: 9/9 PASS, exit 0 (shown above; also confirmed clean on the
     pre-M32 baseline at commit `1e72320` before my edits — 5/5 PASS, exit 0).
   - `it0-dir-projection-check.sh`:
     ```
     $ bash scripts/it0-dir-projection-check.sh . /tmp/m32-scratch/tasks-directive.json
     PASS: 19 DIR file(s) checked against 0 label:directive task(s) (prefix='none') — no divergence
     (no orphan tasks/files, no status disagreement).
     ```
     (The "0 matched, prefix='none'" outcome is a pre-existing script quirk when `.` is passed as
     the experiment-dir arg instead of the full `experiments/quay-perpetual-stream` path — not
     something I introduced; exit code is 0/PASS either way and is unaffected by my changes since I
     did not touch this script.)
   - `packages/quay` test suite (`node --test packages/quay/test/*.test.mjs`, 18 files, 34 tests):
     32 pass, 2 fail in the full-batch run (`provider-abi-conformance.test.mjs`,
     `serve-github.test.mjs`); a 3rd file (`cli-edit-parity-conformance.test.mjs`) also
     intermittently fails in the full batch but **passes cleanly when run in isolation**
     (`✔ packages/quay/test/cli-edit-parity-conformance.test.mjs`, 1/1 pass, 62s). All three are
     live-GitHub-API-dependent conformance tests (rate-limit/network-timing sensitive when run
     concurrently with 17 other test files) — this is the pre-existing baseline established before
     my work, not a regression: `git diff --stat master...HEAD -- packages/quay/` is **empty** — I
     never touch any file under `packages/quay/` in this branch's history.

## §4. Disagreement / discovery from adversarial fixture construction

The charter explicitly asked me to try constructing genuinely violating synthetic fixtures rather
than fixtures shaped to trivially pass, since this milestone modifies the enforcer that gates my
own ABSORB. Doing this surfaced a real regex-design hazard I want to flag rather than bury:

**Negation poisoning.** My first `escrow-deltav-violating-stub.md` draft included explanatory
fixture-prose stating *why* it was meant to fail (e.g. "Deliberately: no 'escrow'/'provisional'/
'pending -IMPL' qualifier anywhere near this claim"). That sentence contains the exact escrow
keywords the Clause 6 check searches for, and a naive substring/window-based keyword search
**false-passed** the fixture (wrongly treating the negated mention as an affirmative escrow claim).
A fixed-char-distance negation lookback (my first two fix attempts) also failed, because the
keywords were spread across a longer negated clause than the lookback window covered. The fix that
actually worked was a **sentence-boundary negation scan**: for each keyword match, walk back to the
nearest sentence boundary and check for ANY negation word in that whole sentence-so-far, with no
fixed distance cap. I consider this a genuine, non-obvious design finding worth flagging to
whichever process reconciles iteration-0 and iteration-1: **any future DoD clause that does
keyword-adjacency checking on free-form prose is vulnerable to this same class of false-positive**,
and reviewers should specifically try writing fixture prose that discusses the ABSENCE of a
required marker before trusting a new clause's PASS/FAIL boundary. I did not find an equivalent
hazard in Clause 7 (its check is a much coarser coverage-percentage-or-waiver-line scan without a
comparable free-form-negation surface), but I would not be surprised if one exists that I didn't
find in the time available — I explicitly did not exhaustively fuzz Clause 7's regex the way I did
Clause 6's.

I found no disagreement with the clause *design* itself (the escrow/de-escrow split cleanly maps
onto Clause 4's existing design-only/impl-row machinery, and the surface-label fail-closed default
for Clause 7 seems like the right conservative choice) — only this one implementation-level
regex-robustness finding, which I addressed rather than merely noting.

## §5. Isolation proof

```
$ git status --short
(clean)
$ git diff --stat
(clean — all work committed)
$ git branch --show-current
exp5-m32-iteration-0
$ git rev-parse HEAD
752221c01281e3a6e3d39456522be4a03509f928
```

All work is committed across 3 iteration-0 commits on top of the milestone's own SELECT commit:
- `a978459` — Clause 6 + Clause 7 authored in `inherited-core.md`, implemented in
  `it0-dod-check.mjs`, 4 new fixtures added, `dod-fixture-selfcheck.sh` wired.
- `6290599` — `OUTER-LOOP.md` step 6 gate text updated to name Clauses 6/7.
- `752221c` — DIR-017 status-mirror updates (pending file + `tasks/DIR-017.md`), `status:`
  frontmatter left untouched.

No writes occurred outside this worktree at any point; the real repo-root `tasks/` directory was
confirmed untouched (`git -C /home/yale/work/quay status --short -- tasks/` empty) both during and
after test runs, using `/tmp/m32-scratch/` scratch files for any input the DIR-projection check
needed instead of touching the live task backend.
