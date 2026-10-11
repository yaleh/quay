---
id: gap-hypgen-prereg-gate-trusts-caller-and-run-identity-collides
title: "arch-hypothesis-generation: pre-registration gate trusts caller-supplied
  hashes, default prompt is not the frozen one, run identity collides across
  experiments"
status: todo
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

## Acceptance Criteria
- [ ] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0. New cases (with a stubbed model runner):
  - (a) A run file whose `prompt_sha256` differs from the prereg makes scoring refuse with a hash-mismatch reason, even when no CLI hash flag is given.
  - (b) A labels file changed after the prereg makes scoring refuse.
  - (c) An import failure reports the underlying error code.
  - (d) `verify` refuses when `--pin-dir` contains `tasks/`.
  - (e) Records carry the prereg's experiment id, and their `subject_key` uses repo-relative paths.
  - (f) Each run file records a non-null model.
- [ ] Real reproduction:
  - The default reproduction prompt hashes to `19be897494996db41e05cc3862cfbb53361d0e5f10a82e41f91e99a2e0ad16ea`; paste the `sha256sum` output.
  - The match step on `/data/home/yale/work/quay-scratch/hg-accept-run/runs` with `--prereg /data/home/yale/work/quay-scratch/hg-accept-run/prereg.json` and no CLI hash flags still scores. Paste the scored JSON.
  - The same command against a copy of that prereg whose `hashes.labels` was altered refuses. Paste the output.
- [ ] Mutation control: remove the run-prompt-hash comparison and show case (a) goes red. Paste the output, then revert.

## Definition of Done
- All AC ticked with outputs pasted.
- `scripts/test.sh --for-task gap-hypgen-prereg-gate-trusts-caller-and-run-identity-collides` green.

## Touches
- tasks/gap-hypgen-prereg-gate-trusts-caller-and-run-identity-collides.md
- docs/analysis/arch-hypothesis-generation.mjs
- docs/analysis/arch-hypothesis-generation-prompts/investigator.txt
- docs/analysis/arch-hypothesis-generation-prompts/investigator-round1-frozen.txt (new)
- plugin/test/arch-hypothesis-generation.test.mjs
