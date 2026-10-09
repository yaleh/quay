# Ownership-first manifold recovery replay — can a constrained discovery procedure recover the GOAL-030/031/032 recurring axis, and at which checkpoint?

**Artifacts** (all three committed with this task):

| file | role |
|---|---|
| `ownership-first-manifold-recovery-replay.mjs` | the deterministic extractor + the fixed trigger rule + the anti-retrofit verifier |
| `ownership-first-manifold-recovery-replay.results.json` | the machine-readable result: per-goal feature vectors, per-checkpoint verdicts, the two LLM-authored candidate contracts |
| `ownership-first-manifold-recovery-replay.md` | this writeup |

Reproduce:

```bash
node docs/analysis/ownership-first-manifold-recovery-replay.mjs --extract --out docs/analysis/ownership-first-manifold-recovery-replay.results.json
node docs/analysis/ownership-first-manifold-recovery-replay.mjs --verify-trigger --in docs/analysis/ownership-first-manifold-recovery-replay.results.json
```

---

## 1. The answer, stated plainly first

**`first_threshold_checkpoint` = 2.**

The fixed rule — *"a recurring-axis candidate is proposable at a checkpoint iff the visible goals' feature vectors pairwise agree on ≥ 6 of the 9 declared features"* — first fires as soon as **two** samples are visible: `{GOAL-030, GOAL-031}` agree on **7 of 9**.

So: this axis **would** have been recoverable from two samples, and seeing the third was not necessary to reach the trigger. That is the honest reading of this dataset, and it is the opposite of the retrofitted-narrative failure mode the task warns about — the interesting honesty test here was whether the procedure *could* fail to fire, and it can (see §5's negative controls); on this data it simply did not need to wait.

The checkpoint table:

| checkpoint | visible goals | pairwise agreement | trigger_evaluated | trigger_fired |
|---|---|---|---|---|
| ① | `{GOAL-030}` | — (0 pairs) | **false** | false (as "not evaluable") |
| ② | `{GOAL-030, GOAL-031}` | `030\|031` = **7/9** | true | **true** |
| ③ | `{GOAL-030, GOAL-031, GOAL-032}` | `030\|031` = 7/9, `030\|032` = **9/9**, `031\|032` = 7/9 | true | true |

Checkpoint ① deserves a note because it is exactly where a boolean-only design would lie. With one visible goal there are **zero** pairwise comparisons, so the trigger has no value at all. The results file therefore carries three distinct states, not two: `trigger_evaluated: false` (①) is structurally different from `trigger_evaluated: true, trigger_fired: false`, and ① ships `reason: "insufficient-samples…"`. Reporting ① as plain `false` would have made "we could not look" indistinguishable from "we looked and it did not fire" — the *unevaluated-masquerading-as-negative* form of the hard-rule-3b failure.

## 2. The nine features and where the samples differ

Extraction is pure regex/heading-position over the three real files; every boolean ships its matched source line(s) under `feature_evidence`, so any claim below can be re-checked with a single `grep`.

| feature | GOAL-030 | GOAL-031 | GOAL-032 |
|---|---|---|---|
| `has_archguard_before_after` | ✅ | ✅ | ✅ |
| `has_negative_control` | ✅ | **❌** | ✅ |
| `has_branch_selfhost_probe` | ✅ | ✅ | ✅ |
| `has_explicit_non_goals` | ✅ | ✅ | ✅ |
| `has_stop_signal_list` | ✅ | ✅ | ✅ |
| `has_three_state_exit_code` | ✅ | ✅ | ✅ |
| `sink_target_is_kernel` | ✅ | **❌** | ✅ |
| `human_activated` | ✅ | ✅ | ✅ |
| `merge_shape_single_commit` | ✅ | ✅ | ✅ |

Exactly two features are non-uniform, and both are non-uniform **because of GOAL-031**:

- `has_negative_control` — the string `负对照` appears nowhere in GOAL-031's body (030: lines 16, 51, 60, 67; 032: line 70). GOAL-031 does carry a stop-signal class named "代码身份假阳性" that *serves* the same falsification purpose, but it never constructs a negative control as a runnable check. That is a real, if mild, gap in the third sample rather than an extraction artifact.
- `sink_target_is_kernel` — this one is a genuine finding about the axis itself, and it is reported under a predicate that is deliberately positional rather than keyword-matching. GOAL-031 mentions `kernel/task-transition.ts` three times, and **every one of those mentions excludes it**: once in the frontmatter origin ("而非 kernel/task-transition.ts"), once in 背景 ("只存在于尚未合并的 goal/GOAL-030 分支"), and once inside the ⛔ non-goal fence ("不 import/不依赖 … kernel/task-transition.ts"). GOAL-031's actual destination is the **already-canonical** module `plugin/scripts/task-status.ts`. A naive "does the body contain the word kernel" predicate would have scored this ✅ and manufactured 8/9 agreement out of a keyword collision; the predicate instead requires a `kernel/<module>.ts` artifact named in the goal's **positive** scope (the 范围 block truncated at the 非目标 marker) or in its 退出条件.

## 3. What the synthesized contract names

The candidate contract is at `results.json → contracts`. It was synthesized **only after** `--extract` had run and fixed `first_threshold_checkpoint = 2`, and — per the task's plan — from the extracted vectors of the visible goals rather than from a fresh re-read of the prose. Because the trigger already held at ②, a second contract was regenerated at ③ for comparison. Both are in the file, and each carries `synthesized_at_checkpoint`; the script refuses to emit a contract claiming a checkpoint the trigger has not reached (§5).

The 7 required fields are present and non-empty in both. In plain language, the contract names this axis:

> A recurring ownership defect in the task/goal lifecycle surface, **observable through ArchGuard**: one reading or one vocabulary computed in more than one place. Each recurrence is retired by moving that single decision to **its correct owning layer** in a minimally-scoped slice, fenced by an explicit ⛔ non-goal list, proven by an ArchGuard before/after reading, falsified by a deliberately-constructed negative control, activated by a recorded human ruling, and landed as exactly one merge commit.

**Does that match the axis a human reader recognizes?** Yes on the load-bearing parts, and the third sample is what pins two of them down:

- ✅ *dedup / canonicalization* — `owner_concern` + the "do not create a second canonical declaration" forbidden action.
- ✅ *sunk to the correct ownership layer* — and the ③ contract is **more accurate than the ② one** here: it no longer implies kernel is the destination. GOAL-031 sinks into an already-canonical existing module. `delta_from_checkpoint_2` records this explicitly. The axis is *being correctly placed to the correct owning layer, of which kernel is one instantiation* — not *sinking to kernel*. Had the procedure stopped at ② and never regenerated, this would have been silently over-generalized.
- ✅ *ArchGuard before/after* — `success_metrics[0]`.
- ✅ *negative control* — `success_metrics[1]`. Note the contract keeps it even though only 2 of 3 samples exhibit it, and `feature_support` records it honestly as `2/3` rather than promoting it to an invariant.
- ✅ *branch self-host* — `scope.owned_reading_classes[3]` + `success_metrics[4]`.
- ✅ *human activation* — `scope.owned_mechanisms_or_paths[2]` + `inputs[3]`.
- ✅ *single-commit merge shape* — `success_metrics[3]`.

**② vs ③ comparison.** Scope did **not** change: no reading class, mechanism, input or forbidden action was added or removed. What changed is (a) confidence, `medium` → `medium-high`; (b) `replay_dataset` gained `GOAL-032`; and (c) one correction the ② contract could not have made — the `sink_target_is_kernel` de-generalization above. That is the honest shape of "more evidence": it reconfirmed the axis and tightened one over-claim, rather than expanding it.

## 4. Limitations — what this run does **not** establish

Stated deliberately, because a claim that can explain any outcome is not a test (hard rule 4 推论四).

1. **The feature set was authored with all three bodies readable.** A blind test would fix the 9 predicates before seeing GOAL-031/032's text. That was not possible here: the extractor's job is to run over three real, already-committed files in the same repository, and writing predicates that match *any* real text requires having read it. What *is* mechanically held is the narrower and still-meaningful property: **the nine features and the ≥6-of-9 threshold were frozen before any result was computed, and no feature was added, removed or widened after a result was seen.** The residual risk — that the *choice* of predicates was unconsciously shaped by having read the three samples — is real and cannot be discharged by this artifact.
2. **One predicate was tightened after the first run, and it changed no value.** The first draft of `has_archguard_before_after` accepted a single before-baseline line for both arms; that is weaker than the feature name ("before **and** after"), so it was split into two required arms. Re-running produced identical vectors (7/9, 9/9, 7/9). Likewise `has_explicit_non_goals` was tightened from "any ⛔ in the non-goal block" to "≥1 real ⛔ bullet". Both changes **narrow** the predicate to match its description; neither was made to move a result, and neither did. This is recorded here rather than left implicit.
3. **`human_activated` has two defensible readings and the file reports both.** The primary vector uses the reading that matches the feature's *name* (a human ruling attributed in the frontmatter: `人 YYYY-MM-DD`), which all three goals satisfy. The task's example regex `人.*裁定` is lexically stricter — GOAL-030 quotes the human (「现在开始执行…」) and GOAL-031 says 指令 rather than 裁定, so under that narrower predicate only GOAL-032 matches. `results.json → sensitivity` recomputes the whole pipeline under the narrow reading: `{030: 8/9, 031: 6/9, 032: 9/9}`, `030|031` still agrees **7/9**, and `first_threshold_checkpoint` is **still 2**. The answer does not depend on this choice, and the choice was made from the predicate's meaning, not from which value produced a nicer table.
4. **n = 3, all from one repository, all written by the same author in the same three-day window.** Seven of the nine features being uniform across all three samples is partly a statement about a *shared authorial template*, not necessarily about a law of the system. Whether `≥6-of-9` is the right threshold is not something three samples can establish; it was declared as a fixed rule and its *position* is what is reported, not its calibration.
5. **The extractor reads structure, not meaning.** `has_negative_control`, for instance, is a string test — GOAL-031 arguably performs falsification under a different name without using the literal `负对照`. This is the intended trade (a deterministic zero-LLM reading over an LLM judgment), and its cost is exactly this kind of lexical false negative.

## 5. Negative controls — proving the checks can fail

Two independent falsifications were run; both must fail for the artifact to mean anything.

**(a) Anti-retrofit verifier.** The stored result was copied and doctored to claim the trigger did *not* fire at ② (as a retrospective "it really only became visible at ③" narrative would), then handed to `--verify-trigger`:

```
verify-trigger FAILED:
  - checkpoint 2: stored trigger_fired=false but recomputed=true (RETROFIT DETECTED)
  - first_threshold_checkpoint stored=3 recomputed=2
  - checkpoint_2: claims synthesis at checkpoint 3, but the trigger first fires at 2
negative-control exit=1 (expected 1)
```

**(b) Contract-synthesis guard.** A copy of the extractor with `checkpoint_2.synthesized_at_checkpoint` rewritten from `2` to `3` was run through `--extract`:

```
contract guard FAILED:
  - checkpoint_2: claims synthesis at checkpoint 3, but the trigger first fired at 2
extract-guard exit=1 (expected 1)
```

So `first_threshold_checkpoint = 2` is not a value that could have been asserted independently of the feature vectors: the two places where a retrofit would have to be written are both mechanically checked against a recomputation from those vectors.

## 6. Explicit non-actions

Repeated here for landing-time clarity, matching the task's Plan step 9. This experiment:

- registers **no** RoutineSpec and runs **no** live proposer;
- creates **no** `label:driver-candidate` task and **no** GOAL;
- changes **no** production driver file — `plugin/scripts/meta-driver.ts` is not touched, and neither is anything else under `plugin/`;
- reads exactly three goal markdown bodies and writes exactly two `docs/analysis/` files.

The candidate contracts in `results.json` are an **inert evaluation artifact**. Whether they ever become a shadow-mode input or a production routine is a decision outside this task's scope and is **not** taken here.
