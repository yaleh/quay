---
id: gap-architecture-hypothesis-generation-shadow-stage-not-in-repo
title: Land the blind cross-component hypothesis-generation shadow stage
  (pre-registered, sealed eval set, bounded verifier) as a report-only analysis
  tool
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal
On 2026-10-11 a first round of a blind hypothesis-generation experiment ran from `/data/home/yale/work/quay-scratch/hypgen/` (`inventory.mjs`, `inventory-B.mjs`, `investigate.mjs`, `verify.mjs`, `match.mjs`, `review.mjs`, `write-findings.mjs`, `prompt-*.txt`, `labels-sealed.json`, `PREREG.md`, `out/`). It ran against the pinned commit `e3163e519`. It reproduces only from that scratch directory today.

**Design.**
- **Investigator input.** A neutral inventory with the same fields for each of the 283 `plugin/scripts/*.ts` components: catalog question, exported names, `.quay` carrier literals. The prompt is fixed; it names no component and no target pair.
- **Investigator isolation.** `--tools ""`, and the process cwd is an empty directory, so no CLAUDE.md or project memory reaches the model.
- **Pre-registration.** The prompt, inventory and label hashes were recorded before the first model call.
- **Scoring.**
  - Mechanical match against sealed labels: 1 holdout, 2 positives, 2 negatives.
  - An independent reviewer confirms each match.
  - A bounded verifier (Read/Grep only, ≤8 turns, 300 s) runs on a pinned tree with `tasks/`, `goals/`, `docs/`, `orchestration/` and the other documentation directories removed.
  - Novelty is a Touches-overlap proxy.

**Round-1 readings.** The model is `v4.1flash-anthropic` (the meta-driver role launcher). Prompt+inventory sha256 is `08a11f52…`.
- **Arm A (pre-registered).** 3/3 runs parsed, 36 hypotheses, 28 clusters. The verifier ran on 15 of them:
  - **Verdicts:** 5 supported, 4 refuted, 6 undetermined (5 hit the turn budget, 1 gave non-JSON output). Precision 5/9 = 0.56.
  - **Intentional differences:** in 4 of the 5 supported clusters, the verifier found the difference is documented as intentional.
  - **Recall:** 0/2 on the positives. The holdout scored 0/3 runs. No negative was falsely hit.
  - **Stable across all 3 runs:** Touches parsing, task-status vocabulary, full-suite-state writers, and concurrency-cap policies.
  - **Novelty (proxy):** 1 of the 5 supported clusters is novel (checker exit-code vocabulary).
  - **Cost:** about 60–73 s per investigator run; verifier calls took 17–133 s.
- **Arm B (declared post-hoc ablation).** Only the inventory extraction changed: all exports instead of 15, plus `path.join(".quay", …)` carriers. The prompt is unchanged. 2 of 3 runs parsed, and 1 run's JSON was malformed. The holdout was partially hit in 1 of the 2 parsed runs; the reviewer judged it `partial=true, same_concept=false`, because it found only the recurrence sub-part. This supports, weakly, the explanation that the inventory format (export truncation, missed carrier forms) limited recall in arm A.

The results are in the production evidence store under `experiment: E-HYPGEN-1` (66 records).

## Plan
1. Add `docs/analysis/arch-hypothesis-generation.mjs`, covering inventory, investigate, verify, match, review and report.
   - It lives under `docs/analysis/`, which is outside the inventory scope, so the tool's own text cannot enter the investigator input.
   - It reuses `driver-runtime.ts` `launchArgv`/`runAsync` with the same `--tools ""` hardening as `ownership-active-loop.mjs`.
   - It refuses to run the investigator unless cwd is an empty directory. It refuses to score unless a pre-registration file with matching hashes exists and is older than every run file.
2. Inventory options: `--pin <rev>`, `--max-exports`, `--carrier-forms literal|literal+join`. Run a contamination scan before any model call: count inventory entries that name both sides of any sealed pair. If the count is non-zero, refuse to run.
3. Sealed labels are passed as a file path (`--labels`). They are read only by the match and review steps. The prompt text is a checked-in file whose sha256 is printed and stored with every run.
4. Every output record goes through the evidence store validator. Use `experiment` ids. Write to the production store only with `--write-store`; the default is a caller-given path.
5. Hard bounds, all fail-closed with distinct exit codes: the number of investigator runs, verifier clusters (≤15), turns, timeouts, and total wall time.
6. Write `docs/analysis/arch-hypothesis-generation-report.md` with the round-1 readings above, regenerated from the landed tool on pin `e3163e519`, with arm A and arm B labelled.

## Acceptance Criteria
- [x] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0. Use fixture stubs for the model calls (inject the runner), and cover each of these as its own case:
  - (a) A non-empty cwd makes the investigator refuse.
  - (b) A missing or mismatched pre-registration hash makes scoring refuse.
  - (c) The contamination scan refuses when an inventory entry names both sides of a sealed pair.
  - (d) An unparseable investigator output is recorded as a failed run, not as zero hypotheses.
  - (e) A verifier that hits its turn limit maps to `undetermined`, never `refuted`.
  - (f) A labels file is never read before all runs exist: assert on the file-read order.

  ```
  $ node --test plugin/test/arch-hypothesis-generation.test.mjs
  ✔ AC1(a): investigator refuses when cwd is not the empty neutral dir — and never calls the model
  ✔ AC1(b): scoring refuses on a missing pre-registration file and on a mismatched hash
  ✔ AC1(c): contamination scan refuses an entry naming BOTH sides of a sealed pair
  ✔ AC1(d): an unparseable investigator output is recorded as a failed run (n_hyps null), never as 0
  ✔ AC1(e): turn-limit and unparseable verifier outputs map to undetermined, never refuted
  ✔ AC1(f): labels are read only AFTER every declared run file exists (assert on read order)
  ✔ bounds: max-runs, max-clusters and max-ms each refuse with a distinct exit code
  ✔ inventory: exports/carriers are deduped, capped and identical for every component
  ✔ match: a hypothesis hit needs one component on each side AND an admissible concept kind
  ✔ clustering: same kind + overlapping components merge; order is confidence then run
  ✔ records: match/verify/review records validate against the production evidence store
  ✔ hardening: the launcher argv pins tools off, no session, strict MCP (and --max-turns when bounded)
  ✔ report: aggregates recorded artifacts into markdown with both arms labelled
  ℹ tests 13
  ℹ pass 13
  ℹ fail 0
  ```
- [x] Static check: `grep -n "probe-routine\|meta-driver\|routine-file-gate" docs/analysis/arch-hypothesis-generation.mjs` returns only the line that resolves the launcher module, if any. The tool's code and prompt files contain no holdout-specific text. Paste the output.

  ```
  $ grep -n "probe-routine\|meta-driver\|routine-file-gate" docs/analysis/arch-hypothesis-generation.mjs
  652:  const argv = launchArgv("meta-driver", prompt, root, { promptViaStdin: true });

  $ grep -rn "probe-routine\|meta-driver\|routine-file-gate" docs/analysis/arch-hypothesis-generation-prompts/
  (no matches — exit 1)
  ```
- [x] Real reproduction on pin `e3163e519`: run the inventory step only (no model call). The inventory sha256 equals `fe87bd79420ba4f4f107fab17d1cfb62df47deb5a6776f93e19cd67a6057838c` for arm A settings, and `186a7355d35a642ac82dd9a4d07880eabc78a4aae33e8e6372764fcb1f83ac9f` for arm B settings. Paste both.

  ```
  $ node --experimental-strip-types docs/analysis/arch-hypothesis-generation.mjs inventory \
      --pin e3163e519 --max-exports 15 --max-carriers 6 --carrier-forms literal \
      --contamination-pairs <sealed-pairs.json> --out /tmp/ac3-A.txt --json
  { "components": 283, "bytes": 133615,
    "sha256": "fe87bd79420ba4f4f107fab17d1cfb62df47deb5a6776f93e19cd67a6057838c",
    "carrier_forms": "literal", "contamination": { "cross": [], "ok": true } }

  $ node --experimental-strip-types docs/analysis/arch-hypothesis-generation.mjs inventory \
      --pin e3163e519 --max-exports 1000 --max-carriers 12 --carrier-forms literal+join \
      --contamination-pairs <sealed-pairs.json> --out /tmp/ac3-B.txt --json
  { "components": 283, "bytes": 170625,
    "sha256": "186a7355d35a642ac82dd9a4d07880eabc78a4aae33e8e6372764fcb1f83ac9f",
    "carrier_forms": "literal+join", "contamination": { "cross": [], "ok": true } }

  $ sha256sum /tmp/ac3-A.txt /tmp/ac3-B.txt
  fe87bd79420ba4f4f107fab17d1cfb62df47deb5a6776f93e19cd67a6057838c  /tmp/ac3-A.txt
  186a7355d35a642ac82dd9a4d07880eabc78a4aae33e8e6372764fcb1f83ac9f  /tmp/ac3-B.txt
  ```
- [x] Mutation control: make the investigator skip the cwd check and show case (a) goes red. Paste the output, then revert.

  ```
  # mutation: `if (refusal && false) return …` in runInvestigator
  $ node --test --test-name-pattern="AC1\(a\)" plugin/test/arch-hypothesis-generation.test.mjs
  ✖ AC1(a): investigator refuses when cwd is not the empty neutral dir — and never calls the model
  ℹ tests 1
  ℹ pass 0
  ℹ fail 1

  # reverted (md5 restored), mutation gone:
  $ grep -c "MUTATION CONTROL" docs/analysis/arch-hypothesis-generation.mjs
  0
  $ node --test plugin/test/arch-hypothesis-generation.test.mjs
  ℹ tests 13   ℹ pass 13   ℹ fail 0
  ```

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-architecture-hypothesis-generation-shadow-stage-not-in-repo` green.
- The tool creates no task or goal.

## Touches
- tasks/gap-architecture-hypothesis-generation-shadow-stage-not-in-repo.md
- docs/analysis/arch-hypothesis-generation.mjs (new)
- docs/analysis/arch-hypothesis-generation-report.md (new)
- docs/analysis/arch-hypothesis-generation-prompts/investigator.txt (new)
- docs/analysis/arch-hypothesis-generation-prompts/verifier.txt (new)
- docs/analysis/arch-hypothesis-generation-prompts/reviewer.txt (new)
- plugin/test/arch-hypothesis-generation.test.mjs (new)
- .gitignore

## Blocker

**2026-10-11T15:19:19.697Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=anti-drift: ANTI-DRIFT HARD FAIL: task gap-architecture-hypothesis-generation-shadow-stage-not-in-repo — 1 violation(s)
- run_id：wk-prod-anchor
- session_id：bc22e1be-d234-411e-aab5-686ddd91da3a
