---
id: gap-hypgen-prereg-gate-trusts-caller-and-run-identity-collides
title: "arch-hypothesis-generation: pre-registration gate trusts caller-supplied
  hashes, default prompt is not the frozen one, run identity collides across
  experiments"
status: done
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
---
## Proposal
I ran the independent acceptance on 2026-10-12. The tool was `docs/analysis/arch-hypothesis-generation.mjs` at develop `b9cc4bfce`. Artifacts are in `/data/home/yale/work/quay-scratch/hg-accept-run/`: `prereg.json`, `runs/run-{1,2,3}.json`, `mechanical-matches.json`, `verify.json`, `verify-records.jsonl`. I found six verified defects. None changes a reading, but each one weakens the guarantees the tool claims:
1. **The pre-registration gate trusts the caller.**
   - `preregRefusal` compares only the hashes the caller passes on the CLI (`--inventory-sha`, `--prompt-sha`) against the prereg file.
   - The `prompt_sha256` each run records is never compared with anything.
   - The labels file is never hashed.
   - So a run made with a different prompt, or labels edited after the runs, can still score as pre-registered.
2. **The default prompt is not the frozen one.** The default `arch-hypothesis-generation-prompts/investigator.txt` hashes to `e2f97678…`, but the frozen round-1 prompt is `19be8974…`. Line 1 was reworded from "up to 15 exported names" to "up to a fixed number". The acceptance run had to pass `--prompt <frozen copy>` to reproduce. The verifier and reviewer prompts are byte-identical to the frozen ones.
3. **Run files record `model: null`.** The model used is not recorded. The launcher actually resolved `v4.1flash-anthropic`.
4. **The real cause of an import failure is swallowed.** `await import("../../plugin/scripts/driver-runtime.ts").catch(() => ({}))` reports only "driver-runtime.ts unavailable". The real cause in the acceptance run was `ERR_MODULE_NOT_FOUND: yaml` (a worktree with no `node_modules`).
5. **Strippedness of the verify tree is not checked.** `verifyCwdRefusal` only checks `cwd === --pin-dir`. Nothing checks that `tasks/`, `goals/`, `docs/`, `orchestration/` are actually absent from the verifier's tree.
6. **Run identity collides across experiments.**
   - The store records hard-code `experiment: "E-HYPGEN-1"` and `experiment_ref: "E-HYPGEN-1 cluster N"`, so an acceptance or later run is indistinguishable from round 1, and cluster N means a different cluster in each run.
   - `subject_key` uses bare file names (`hypgen:invariant|task-status.ts,…`), while round 1 used repo paths (`plugin/scripts/…`). The same concept therefore cannot be joined across rounds.

## Plan
- **Pre-registration.** Make the prereg the source of truth for hashes. The scoring step refuses unless each of the following equals the prereg's recorded value:
  - every run's recorded `prompt_sha256`;
  - the sha256 of the inventory file;
  - the sha256 of the labels file.
  
  The CLI hash flags become optional extra assertions.
- **Default prompt.** Ship the frozen round-1 investigator prompt as a named file, and make the reproduction path default to it. Keep the reworded prompt only as a separately named variant. Any run records which prompt file it used and that file's hash.
- **Model.** Record the resolved model in each run file.
- **Import failure.** Surface the real error code and message.
- **Verify tree.** `verify` refuses when any of `tasks/`, `goals/`, `docs/`, `orchestration/` exists under `--pin-dir`.
- **Run identity.**
  - The experiment id comes from the prereg (`--experiment`, or a prereg field), never a constant.
  - `experiment_ref` includes that id.
  - `subject_key` uses repo-relative paths.

## Resolution
Implemented in `docs/analysis/arch-hypothesis-generation.mjs` (commit `2163fff80` on the task branch):
- `runPromptRefusal` re-derives each run's RECORDED digest from the prompt + inventory bytes the caller supplies (`runPromptDigest`), and `score` hashes the labels from the bytes it just read and compares with `prereg.hashes.labels`. `--prompt-sha`/`--inventory-sha` survive only as optional extra assertions (`cliExtraShaRefusals`). Where the bytes are unavailable the gate refuses (`RUN_PROMPT_UNVERIFIABLE`) rather than passing — 硬规则 3b.
  The run file's `prompt_sha256` semantics are unchanged (sha256 of prompt-file bytes + inventory bytes), so the acceptance run's recorded runs remain verifiable instead of being rewritten.
- The frozen round-1 prompt ships as `investigator-round1-frozen.txt` and is the DEFAULT (`defaultInvestigatorPrompt()`) for `investigate` and for the run-digest check (`--investigator-prompt`); `investigator.txt` survives as the reworded VARIANT, marked as such in its first line.
- `runInvestigator` records `model` (resolved from the hardened argv via `modelFromArgv`), `prompt_file`, `prompt_file_sha256` and `inventory_sha256`. An unresolved model is a refusal (`MODEL_UNRESOLVED`), never a recorded `null`.
- `importDriverRuntime` reports `DRIVER_RUNTIME_IMPORT_FAILED:<code>:<message>` / `DRIVER_RUNTIME_MISSING_EXPORT:<name>`.
- `verifyCwdRefusal` enumerates `STRIPPED_DIRS` under `--pin-dir` and refuses by name (`PIN_NOT_STRIPPED:tasks,docs`).
- `resolveExperimentId` reads the id from `--experiment` then the prereg (`experiment` | `experiment_id` | `acceptance_run`); `repoRelComponent` / `repoRelSubjectKey` normalise component names onto `plugin/scripts/…`, so round 1 and round 2 produce one joinable key.

## Acceptance Criteria
- [x] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0. New cases (with a stubbed model runner):
  - (a) A run file whose `prompt_sha256` differs from the prereg makes scoring refuse with a hash-mismatch reason, even when no CLI hash flag is given.
  - (b) A labels file changed after the prereg makes scoring refuse.
  - (c) An import failure reports the underlying error code.
  - (d) `verify` refuses when `--pin-dir` contains `tasks/`.
  - (e) Records carry the prereg's experiment id, and their `subject_key` uses repo-relative paths.
  - (f) Each run file records a non-null model.
- [x] Real reproduction:
  - The default reproduction prompt hashes to `19be897494996db41e05cc3862cfbb53361d0e5f10a82e41f91e99a2e0ad16ea`; paste the `sha256sum` output.
  - The match step on `/data/home/yale/work/quay-scratch/hg-accept-run/runs` with `--prereg /data/home/yale/work/quay-scratch/hg-accept-run/prereg.json` and no CLI hash flags still scores. Paste the scored JSON.
  - The same command against a copy of that prereg whose `hashes.labels` was altered refuses. Paste the output.
- [x] Mutation control: remove the run-prompt-hash comparison and show case (a) goes red. Paste the output, then revert.

## Definition of Done
- All AC ticked with outputs pasted.
- `scripts/test.sh --for-task gap-hypgen-prereg-gate-trusts-caller-and-run-identity-collides` green.

## Acceptance Evidence

### AC1 — `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0
```
✔ AC1(a) … ✔ AC1(f)
✔ bounds: max-runs, max-clusters and max-ms each refuse with a distinct exit code
✔ inventory: exports/carriers are deduped, capped and identical for every component
✔ match: a hypothesis hit needs one component on each side AND an admissible concept kind
✔ clustering: same kind + overlapping components merge; order is confidence then run
✔ records: match/verify/review records validate against the production evidence store
✔ hardening: the launcher argv pins tools off, no session, strict MCP (and --max-turns when bounded)
✔ report: aggregates recorded artifacts into markdown with both arms labelled
✔ AC2(a): a run recorded with a different prompt digest refuses — with NO CLI hash flag given
✔ AC2(b): a labels file changed AFTER the prereg makes scoring refuse
✔ AC2(c): a failed driver-runtime import surfaces the underlying error code, not 'unavailable'
✔ AC2(d): verify refuses when --pin-dir contains tasks/ (and every other stripped dir)
✔ AC2(e): records carry the prereg's experiment id and repo-relative subject keys
✔ AC2(f): each run file records a non-null model; an unresolved model is a refusal, not a null
✔ prompt: the tool's default investigator prompt is the frozen round-1 file, byte for byte
ℹ tests 20
ℹ pass 20
ℹ fail 0
```

### AC2 — Real reproduction (`/data/home/yale/work/quay-scratch/hg-accept-run`, develop `b9cc4bfce` artifacts; tool run from the task worktree)
Default reproduction prompt:
```
$ sha256sum docs/analysis/arch-hypothesis-generation-prompts/investigator-round1-frozen.txt
19be897494996db41e05cc3862cfbb53361d0e5f10a82e41f91e99a2e0ad16ea  …/investigator-round1-frozen.txt
$ sha256sum docs/analysis/arch-hypothesis-generation-prompts/investigator.txt
f14cba2c3e0636a00ab3fc38cdc13c768fdc746070cef3ddf243575ceeb214d1  …/investigator.txt
```
Match, **no CLI hash flag**, `--inventory` supplied as a FILE (the recorded digests are re-derived from it):
```
$ node docs/analysis/arch-hypothesis-generation.mjs match \
    --runs /data/home/yale/work/quay-scratch/hg-accept-run/runs \
    --labels /data/home/yale/work/quay-scratch/hg-accept-run/labels-sealed.json \
    --prereg /data/home/yale/work/quay-scratch/hg-accept-run/prereg.json \
    --inventory /data/home/yale/work/quay-scratch/hg-accept-run/inventory-A.txt --run-count 3 --json
{ "by_case": { "HOLDOUT-PM": {"role":"holdout-regression","hits":0,"hids":[]},
               "POS-DRIVER-KIND": {"role":"positive","hits":0,"hids":[]},
               "POS-QUALITY-ROUND-WRITERS": {"role":"positive","hits":0,"hids":[]},
               "NEG-SIGNATURE-NO-MERGE": {"role":"negative","hits":0,"hids":[]},
               "NEG-QUALITY-GATES": {"role":"negative","hits":0,"hids":[]} },
  "recall_positive": {"hit":0,"total":2},
  "holdout": [{"id":"HOLDOUT-PM","hits":0}],
  "negative_false_positive": {"hit":0,"total":2},
  "validator": {"accepted":0,"refused":0} }
exit=0
```
Same command, prereg COPY with `hashes.labels` altered (mtime preserved, so only the hash can refuse):
```
$ node docs/analysis/arch-hypothesis-generation.mjs match … --prereg …/prereg-labels-altered.json …
arch-hypothesis-generation match: PREREG_HASH_MISMATCH:labels
exit=4
```
Additional negative controls on the same real artifacts:
```
$ … --investigator-prompt …/investigator.txt (the reworded VARIANT)
arch-hypothesis-generation match: PREREG_HASH_MISMATCH:prompt-investigator   (exit 4)

$ … without --inventory
arch-hypothesis-generation match: INVENTORY_REQUIRED                          (exit 2)
```
Run identity against the real prereg:
```
prereg.acceptance_run         = E-HYPGEN-ACCEPT-1
resolveExperimentId({prereg}) = E-HYPGEN-ACCEPT-1      (the hard-coded constant was E-HYPGEN-1 — the collision)
--experiment override         = E-EXPLICIT
round-1 spelling plugin/scripts/task-status.ts -> hypgen:invariant|plugin/scripts/task-status.ts
round-2 spelling task-status.ts                -> hypgen:invariant|plugin/scripts/task-status.ts
joinable across rounds        = true
```

### AC3 — Mutation control (removed the run-prompt-hash comparison, then reverted)
```
mutation applied: run-prompt-digest comparison removed

✖ AC2(a): a run recorded with a different prompt digest refuses — with NO CLI hash flag given
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  true !== false                       (at assert.equal(refused.ok, false))
ℹ tests 1
ℹ pass 0
ℹ fail 1
```
Reverted (`cp` from the pre-mutation backup):
```
20b3a6713db41eeaf587ec6c0e212ed5843960700a652ffd4b93609060836af6  docs/analysis/arch-hypothesis-generation.mjs
20b3a6713db41eeaf587ec6c0e212ed5843960700a652ffd4b93609060836af6  …/arch-hypothesis-generation.mjs.bak
ℹ tests 20  ℹ pass 20  ℹ fail 0
```

## Touches
- tasks/gap-hypgen-prereg-gate-trusts-caller-and-run-identity-collides.md
- docs/analysis/arch-hypothesis-generation.mjs
- docs/analysis/arch-hypothesis-generation-prompts/investigator.txt
- docs/analysis/arch-hypothesis-generation-prompts/investigator-round1-frozen.txt (new)
- plugin/test/arch-hypothesis-generation.test.mjs
