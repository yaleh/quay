# Two-stage GOAL-030..033 benchmark — Flash vs Opus

Implements `gap-ownership-replay-benchmark-redesign-two-stage`. Replaces the v1 single-shot
benchmark, which scored a **T0-ish evidence bundle against a T1-ish gold** and could not
distinguish the two runtimes on any dimension (16 runs, identical everywhere).

Raw results: `ownership-two-stage-ab-results.json` (16 runs, 1 rep/cell).
Reproduce: `node docs/analysis/ownership-two-stage-ab.mjs --reps 1`.

## Runtime provenance (verified per run, no credentials recorded)

| group | launcher | `--model` in argv | backend |
|---|---|---|---|
| A | `claude-fjdac` | `v4.1flash-anthropic` | LiteLLM `127.0.0.1:26510` → `deepseek/deepseek-flash` (DeepSeek-V4.1-Flash) |
| B | wrapper → `claude` | `opus` | native claude.ai login |

Group B's wrapper drops `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and all
three `ANTHROPIC_DEFAULT_*_MODEL` vars. **This is load-bearing**: without it
`ANTHROPIC_DEFAULT_OPUS_MODEL=v4.1flash` silently rewrites `opus` to DeepSeek and the experiment
would compare DeepSeek against itself — a trap hit during probing.

Harness self-test: `prompts_identical_across_groups_per_cell: true` — A and B received
byte-identical prompts per (case, stage). The repo's `.quay/profiles.yml` was not modified.

## Stage A — discovery (T0)

| group | n | valid concern | grounded refs | valid concern ranked 1st | mean latency |
|---|---|---|---|---|---|
| A (Flash) | 4 | **4/4** | 4/4 | **4/4** | 29 542 ms |
| B (Opus) | 4 | 3/4 | 4/4 | 3/4 | 18 487 ms |

The one B miss is GOAL-032 (`valid=false, rank1=false`) — Opus returned two concerns, neither
matching an expected one.

## Stage B — decomposition (T1)

| group | n | investigate-vs-goal | granularity verdicts | slice≈reference | slice≈alternative | scope viol | harness 5/5 | delta quantified | falsifiability |
|---|---|---|---|---|---|---|---|---|---|
| A (Flash) | 4 | **4/4** | too-broad, too-fragmented, too-fragmented, too-fragmented | 3/4 | **4/4** | 1/4 | 4/4 | 4/4 | 4/4 |
| B (Opus) | 4 | **4/4** | too-broad, too-broad, too-broad, too-fragmented | 2/4 | **4/4** | 1/4 | 4/4 | 3/4 | 4/4 |

Mean latency: A 63 115 ms (includes one 164 s outlier on GOAL-033), B 49 777 ms.

## The headline: the redesign flipped investigate-vs-goal

| corpus | A | B |
|---|---|---|
| v1 single-stage (n=8 each) | **0/8** | **0/8** |
| two-stage, scored at T1 (n=4 each) | **4/4** | **4/4** |

Same models, same underlying facts. The v1 result was produced by showing a T0 state and scoring a
T1 gold — so "investigate" was simultaneously the instructed answer and the wrong answer. That is a
gold defect, and fixing it removed the failure entirely.

## Attribution of causes

- **gold/evaluator — PRIMARY, now fixed.** Proven by the 0/8 → 8/8 flip with nothing else changed.
  Also: every proposed slice scored `alternative_valid` 4/4 in both groups while matching the
  historical slice only 2–3/4 — i.e. the models were producing defensible decompositions that the
  v1 benchmark recorded as `no_match`.
- **evidence sufficiency — PRIMARY, not fixed.** Neither group reached `sufficient` granularity on
  **any** case (0/8). The evidence block is 1.0–2.1 KB against a 2.0 MB ArchGuard snapshot and a
  48 728-line subsystem. Both models miss minimality; they just miss it in different directions.
- **model capability — NOT supported.** Flash ≥ Opus on Stage A (4/4 vs 3/4), equal on Stage B
  agreement (4/4 vs 4/4), equal on scope (1/4 vs 1/4) and harnessability (4/4 vs 4/4). The only
  directional difference is stylistic: Flash under-scopes (3/4 too-fragmented), Opus over-scopes
  (3/4 too-broad).
- **prompt bias — partially addressed.** Removing the "do not invent readings / abstaining is
  correct" framing and supplying a *confirmed* concern is part of why Stage B now commits.

## Recommendation

**Do not switch meta-driver / selector / pool-judge to Opus on this evidence.** There is no
capability signal favouring it, and Flash is cheaper and (on Stage A) scored better. The binding
constraint is evidence, not model: expand the replay evidence bundle with real structural facts
(SCC edge lists, import lines, consumer lists, duplicate snippets, the methodology body) before
re-running. A model switch on the current payload would be optimising the wrong variable.

Caveats: n=4 per cell per stage, 1 repetition. The granularity direction difference (Flash
fragmented vs Opus broad) is suggestive but not established at this n; a 2-rep run would test it.
