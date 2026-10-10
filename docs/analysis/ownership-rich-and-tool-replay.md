# GOAL-030..033 benchmark, next version — rich evidence dossiers and repository/tool replay

Tracking task: `gap-ownership-replay-rich-evidence-and-tool-replay-benchmark`. Baseline kept unchanged:
`ownership-two-stage-ab-results.json` (1–2 KB static bundle; no further samples were added to it).

A = `claude-fjdac` + `v4.1flash-anthropic` (gateway → DeepSeek V4.1 Flash). B = `claude` + `opus` (native login;
gateway env dropped so `opus` really is Opus). Per cell, A and B received **byte-identical prompts** (asserted in
every results file: `harness_self_test.prompts_identical_across_groups_per_cell = true`). `.quay/profiles.yml`
was not touched; no credentials are recorded (artifacts scanned: 0 hits).

**Read this first — a correction to the previous report.** The lexical granularity/scope rows in
`ownership-two-stage-ab.md` were an artifact of a matcher that normalises by the shorter string (see
*Erratum* there and §4 below). All "sufficient granularity" conclusions in this document therefore come from a
**blinded semantic judge** that passed 16/16 gold-built controls, not from that matcher.

n is small throughout (4 cases × 1 rep for the bundles; 2 cases × 1 rep for tool replay). Nothing here is a
statistical claim; differences are described, not established.

---

## 1. Rich evidence dossiers (mode A)

Each case has `rich_a.json` (T0 commit) and `rich_b.json` (T1 commit = A's sections + drill-down material + the
investigation findings). Every section records provenance. Sizes are UTF-8 bytes of the dossier text; the prompt
adds instructions and schema.

| case | stage A (T0) | stage B (T1) | cutoff commit A / B | notable contents (raw, not summarised) |
|---|---|---|---|---|
| GOAL-030 | 8 sections, 30.5 KB | 14 sections, 47.4 KB | `c8461f5f` / `28c72f43` | package SCC; plugin→kernel edge pairs; all `patchStatusField` callers; full bodies of `applyPromotions` / `applyRevaluations`; `LIFECYCLE_EDGES` table (whose header says wiring writers to it "is a FOLLOW-UP task"); goal-branch SPEC; rehearsal goal body; prior task body |
| GOAL-031 | 7 sections, 19.5 KB | 13 sections, 41.1 KB | `a8abf1a6` / same | recorded ArchGuard literal-dispersion run (incl. that the default-sources run returned **0 smells** — silently empty); all 13 `needs-human` comparisons; 4 hit sites with context; canonical status vocabulary; `goal-driver.ts` status-field reads |
| GOAL-032 | 7 sections, 39.4 KB | 15 sections, 60.8 KB | `30c619f1` / `273ef15b` | duplicate groups ranked 1–20 of 86 (the target is **rank 15**, among noise); both parser bodies *without* doc comments in A, with them in B; call sites; both callers; kernel directory listing; methodology doc; two prior goal bodies |
| GOAL-033 | 7 sections, 49.8 KB | 17 sections, 70.5 KB | `a6ef1a3f` / `1025ab95` | package SCC (derived, then cross-checked against the real ArchGuard CLI: same size-6 cycle, same members); 6×6 member relation matrix; root→cli edge pairs (exactly 2); `HOSTED_SERVICE_NAMES` occurs only on its import line (the dead import is derivable); whole `cli/driver-vocab.ts`; consumer list |

Provenance per section: `git_file` (commit, path, line ranges), `git_grep` (exact command, hit count), `git_ls`,
`archguard_derived` (analysed tree, **whether the scanned code is identical to the stage commit**, derivation),
`recorded_tool_output` (tool, params, file sha256), `authored_findings` (T1 only, flagged as not a code excerpt).
Code is byte-identical between T0 and T1 for 030/031/033; for 032 only three unrelated files differ (recorded).

Scale caveat: the bundles are 23–78 KB prompts, i.e. the bundle is still a *selection*; I chose the sections.

## 2. Leakage / integrity tests

`plugin/test/ownership-rich-dossier.test.mjs` — 33 tests with the two-stage file, all green.

Design point: several of the v1 "outcome identifiers" (`patchStatusField`, `isTaskStatus`, `cli/driver-vocab.ts`,
`LIFECYCLE_EDGES`) **exist at the cutoff** and are legitimate evidence, so a blunt zero-hit rule would forbid real
facts. The guard is provenance-based instead:

- every `git_file`/`git_cat` section is **replayed** from `git show <cutoff-commit>:<path>` and compared line by
  line; `git_grep` rows are checked against the file at that commit; tool-output files are hash-checked;
- the cutoff commit must not postdate the stage cutoff (recorded and re-derived from git);
- an outcome identifier is forbidden **iff verifiably absent from the cutoff tree**, and the test also fails if a
  listed marker turns out to exist there (mis-specified marker);
- no 40-char window of `outcome.json` prose (60 for `reference.json`) appears in any dossier;
- the target goal's file and any `AC-*` file are never inputs; T0 holds no T1 finding;
- tool replay: trace folding, trace-based grounding, sandbox deny-shape, prompt non-leakage, probe artifact.

Negative controls (mutated copies, `cp`-restored, md5-verified): injected `verdict-parse.ts`, tampered
function line, post-cutoff commit time, pasted target-goal path — each made exactly the intended test fail.
Two false positives were found and fixed in the *tests*: normalised punctuation glued adjacent grep rows into a
quoted shell command, and a pair of identifiers is not a quotation.

## 3. Rich-bundle result (Flash vs Opus), judged blind

16 runs, 0 unevaluated. Mean latency: A 44 s / 78 s (stage A / B), B 30 s / 73 s. Mean prompt ≈ 50 KB.

| dimension | compact baseline (A / B) | rich bundle (A / B) |
|---|---|---|
| Stage B slice acceptable (equivalent or alternative-valid), blind judge | 3/4 / 4/4 | **4/4 / 4/4** |
| Stage B scope OK, blind judge | 4/4 / 4/4 | 4/4 / 4/4 |
| Stage B investigate-vs-goal (enum) | 4/4 / 4/4 | 4/4 / 4/4 |
| Stage B harness 5/5, falsifiable negative control, delta quantified | 4/4,4/4,4/4 · 4/4,4/4,3/4 | 4/4,4/4,4/4 · 4/4,4/4,4/4 |
| Stage A top concern = expected (judge) | 4/4 / 4/4 | 3/4 (+1 adjacent) / 4/4 |
| Stage A any concern = expected (judge) | 4/4 / 4/4 | 4/4 / 4/4 † |
| † one judge reply omitted this field; its top concern was classed matches-expected, so it is counted as a match | | |
| distinct evidence refs cited, per response (stage B) | n/a (not requested) | 15 / 14 |
| file paths asserted but never shown: not-in-dossier / nonexistent-at-cutoff (stage B) | 13 / 0 · 0 / 0 | 5 / 4 · 3 / 3 |

Reading it:

- **The compact bundle was already enough for a correct decomposition once the T1 findings were supplied.** The
  earlier "0/8 sufficient" was entirely the matcher. Rich evidence moved the judge from 7/8 to 8/8 acceptable —
  within noise at n=4 per cell.
- **What the dossier visibly adds is auditability, not accuracy**: responses cite 14–15 specific sections and
  almost every path they assert is traceable. The "nonexistent at cutoff" paths are mostly *proposed new files*
  (e.g. Flash proposed `kernel/verdict-parse.ts` for GOAL-032 — the real file name — inferred from the kernel
  directory listing's naming convention, not seen). They are reported for review, never scored.
- Flash and Opus are **indistinguishable** on stage B in this mode, and on stage A (4/4 vs 4/4 any-match; top concern 3/4 + 1 adjacent vs 4/4).

## 4. Why the lexical granularity row cannot be trusted (and what replaced it)

`overlap = |intersection| / min(|a|,|b|)`. A short counterfactual such as "Move only one of the two edges" is
100 % contained in any long answer, so verdicts follow *answer length*, not content. Concretely, for GOAL-033 both
models proposed moving `driver-vocab.ts` and the `runDriver` core to root-level zero-import modules (the real fix)
and the matcher scored Flash's answer `too-fragmented` (overlap 1.00). Flash and Opus got identical verdict
vectors for that reason. The blinded judge (Sonnet — neither contestant; group, model and mode hidden; seeded
shuffle) classifies the *recommended slice*; its discrimination was measured on 16 candidates built from the gold:
reference → equivalent (4/4), alternatives → alternative/equivalent (4/4), too-broad counterfactuals → too-broad
(4/4), too-fragmented → too-fragmented (4/4). The judge is a single model and advisory; it is reported next to,
not merged with, the lexical dimensions.

## 5. Repository / tool replay (mode B)

GOAL-032 and GOAL-033, both stages, both runtimes: 8 cells. Sandbox (`ownership-tool-replay.mjs` header):
detached worktree at the stage's cutoff commit (stage A → T0, stage B → T1); `CLAUDE.md`, `.claude/`, ArchGuard
history stripped; tools `Read,Grep,Glob` + **one** shell command (`archq.sh`, which pins `--arch-dir` and
forwards query flags); `dontAsk` permission mode; deny rules for the main checkout, `~/.claude` and every *other*
replay tree; a 45-call cap enforced by the runner (this CLI build has no max-turns flag); `stream-json` trace.

**Sandbox was probed, not assumed** (`ownership-tool-replay-results-probe.json`, both runtimes): denied —
`CLAUDE.md` in the main checkout, `reference.json`, a Grep across `plugin/fixtures`, a *later* replay tree, the
session transcript, a file write, `ls /`, `git log`, `archq …; cat /etc/hostname`, `archq --arch-dir <main>`.
Allowed — in-tree Read/Glob and plain `archq`. `probe.txt` was never created. 10–11 of 13–15 attempts denied.

Stage B here gets the confirmed concern but **not** the T1 findings, so it is harder than the dossier's stage B.

| cell | tool calls (Flash / Opus) | files read | outcome (blind judge) |
|---|---|---|---|
| GOAL-032 · A | 29 / **14** | 8 / 5 | both: concern about routine-quota config ownership — real, **not** the expected duplicate pair (`unrelated`) |
| GOAL-032 · B | **46, cap hit, no answer** / 25 | 16 / 7 | Flash: never converged. Opus: answered about a **different** duplicate group (Touches parsers) → `unsound` vs gold |
| GOAL-033 · A | 35 / 33 | 14 / 9 | Flash: duplicated primitives across layers (`adjacent-defensible`); Opus: includes the 6-member cycle as concern #2 (`any match`) |
| GOAL-033 · B | 34 / **22** | 5 / 4 | **both `equivalent-to-reference`**, scope OK; found exactly the two root→cli imports from scratch (`serve.ts:50`, `serve-sessions.ts:20`) |

All 159 cited refs resolved to paths the agent had actually opened or seen in tool output (0 ungrounded). Tool
denials during real runs: 4 (Flash) / 3 (Opus) — every one an attempt to drive `grep`/`ls`/`cd`/`python` through the shell instead of the Grep/Glob/Read tools.

What this shows:

1. **When the question is findable with the available instruments, agents find it** (GOAL-033 stage B: two
   equivalent decompositions from a cold start, 22–34 calls).
2. **GOAL-032 was unreachable for a structural reason.** The duplicate group that *is* the concern was only ever
   visible through the ArchGuard **MCP** `detect_duplicates` tool; the CLI `query` that `archq` exposes has no
   duplicates (or literal-dispersion) query. Agents had no way to rank 86 groups, wandered into other duplicate
   families, and one ran out of budget. This is a tool-surface gap, not a model result.
3. **Stage A in free exploration is not scorable against "the human's concern".** Both agents surfaced
   *real* ownership problems that were not the one the human picked. Matching the human's choice measures
   prioritisation agreement; whether a concern is *valid* needs its own rubric (the judge's `adjacent-defensible`
   is a first cut).

## 6. Do the models finally differ?

Quality: **no, not established.** Stage B is saturated for both in the bundle modes; stage A is 3/4–4/4 for both;
in tool mode the one clear failure per runtime (032) has the same structural cause.

Process: **one consistent difference, with n=4.** Opus used fewer tool calls in all four cells
(14 vs 29, 25 vs 46, 33 vs 35, 22 vs 34; mean 24 vs 36), read fewer files (6 vs 11), and never hit the cap,
while Flash hit it once. Wall-clock was about equal (96 s vs 105 s), so Opus spent longer per call. Opus's
efficiency did not buy accuracy where the instrument was missing: it confidently analysed the wrong group.

## 7. Recommendations for the production meta-driver

1. **Keep dossier-style evidence, for auditability.** Raw, derived-with-provenance facts let you verify every
   citation. Do not expect it to raise decomposition accuracy once confirmed findings are in hand.
2. **Give the agent instruments, and close the CLI/MCP gap first.** Expose duplicate detection and
   literal-dispersion (and package-level cycles, already present) through whatever surface the agent actually
   has. Make an empty tool result self-describing: the default-sources dispersion run returned "0 smells", which
   is indistinguishable from "none exist".
3. **Read/Grep/Glob + one pinned query command is sufficient and sandboxable.** Reuse this pattern
   (`dontAsk`, explicit deny lists, a probe run that must show every forbidden action denied) rather than
   `bypassPermissions`. Enforce a tool-call budget externally; Flash exceeded a "25–40 calls" instruction.
4. **Do not score concern *discovery* by agreement with a human's pick.** Score validity and groundedness; keep
   prioritisation agreement as a separate, explicitly-labelled number.
5. **Do not switch the decomposition path to Opus on this evidence.** No quality signal. For open-ended
   *investigation* Opus was more economical in calls; quality parity is untested beyond two cases.
6. **Never use the lexical matcher for granularity.** If a cheap check is wanted, compare against the
   *recommended* slice only and keep a semantic judge with gold-built controls as the arbiter.
7. **Treat instrument readings as unstable inputs.** At the GOAL-031 cutoff the dispersion tool reads 4 files in
   two groups, whereas the historical reading was 5; `goal-driver.ts` (plain-string typing) is invisible to it.

## 8. Limits and incidents

- n=4 / n=2, one rep. The judge is one model; two of its control "alternatives" were called `equivalent` (accepted
  by the control rule, but a mild leniency).
- The environment was interrupted several times (CloudCLI service). All runners are resumable and bank only
  verified cells; a cap-hit is kept as a real outcome, infrastructure failures are re-run. During the tool run the
  `claude` binary was replaced (`exec: claude: not found` on 4 cells, re-run). Cells before that point do not
  record the CLI version; the later ones record `2.1.295`.
- The first judge pass ran 3-parallel and 29/55 calls failed fast; failed items were re-queued, none banked.
- The dossier selection, the gold and the judge are all mine; a different curator could produce different bundles.

## Reproduce

```
node docs/analysis/gen-rich-dossier.mjs                      # rebuild rich_a/b.json from git + recorded ArchGuard output
node --test plugin/test/ownership-rich-dossier.test.mjs plugin/test/ownership-two-stage-corpus.test.mjs
node --experimental-strip-types docs/analysis/ownership-rich-ab.mjs --reps 1 [--resume]
node --experimental-strip-types docs/analysis/ownership-tool-replay.mjs --probe --group A|B
node --experimental-strip-types docs/analysis/ownership-tool-replay.mjs [--resume]   # needs the replay trees (see spec)
node --experimental-strip-types docs/analysis/ownership-blind-judge.mjs --parallel 1
node docs/analysis/summarize-rich-and-tool.mjs                # re-scores everything with the final evaluator
```

The replay trees are `git worktree add --detach /data/scratch/yale/replay-cutoffs/GOAL-03x[-T0] <commit>`
(commits in `rich-dossier-spec.json`) with `archguard analyze` run once; the dossier tests need only the git objects.
