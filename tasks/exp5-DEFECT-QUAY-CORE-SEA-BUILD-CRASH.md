---
id: exp5-DEFECT-QUAY-CORE-SEA-BUILD-CRASH
title: "defect: quay Core SEA binary crashes at startup (gate/registry.ts
  import.meta.url incompatible with CJS bundle) — DIR-004 Distribution urgent"
status: todo
labels:
  - milestone-candidate
  - defect
parent: null
children: []
extra:
  schema: v1
---
## Proposal

Found while testing the SEA (Single Executable Application) build path at M116 (a due-diligence check
while migrating `packages/quay/bin/quay.js` → `.ts` — not part of that task's own scope, but
discovered by actually running `build-sea.sh` rather than assuming it still worked): **quay Core's SEA
binary crashes on startup** for any command that reaches the gate subsystem (confirmed via `--version`,
which touches `gate/engine.ts` → `gate/registry.ts` at module-init time):

```
$ ./packages/quay/dist-sea/quay --version
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string or an instance of URL. Received undefined
    at fileURLToPath (node:internal/url:1611:11)
    at src/gate/registry.ts (.../quay-bundle.cjs:40094:85)
```

**Root cause:** `packages/quay/src/gate/registry.ts` line 21:
```ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));
```
`esbuild-sea.mjs` bundles quay Core to `format: "cjs"` (Node SEA does not support ESM main modules —
see that script's own header comment). In a CJS bundle, `import.meta.url` is `undefined` (esbuild
itself warns about this during the build: *"You need to set the output format to 'esm' for
'import.meta' to work correctly"* — a warning that's been silently ignored, presumably because nobody
has run the SEA build since `gate/registry.ts` was TS-migrated at M84, `13c1ee3`). `__dirname` is used
to compute `REPO_ROOT` (line 25: `path.resolve(__dirname, "..", "..", "..", "..")`), which the gate
subsystem likely uses to resolve gate-script paths.

**Confirmed pre-existing, not introduced by M116:** `git log -- packages/quay/src/gate/registry.ts`
shows this file untouched by M116's own changes (bin-entrypoint rename only); the last touch was M84
(TS migration) then an M93 refactor (`8c7ba6f`). This SEA-incompatibility has evidently been present
and unexercised since M84 — the quay-native SEA build (a SEPARATE binary, no gate subsystem dependency)
was verified working at M116 (manifest shim redirect confirmed live-tested), but quay Core's has been
silently broken for ~30 milestones.

**Why this matters (DIR-004 urgency):** `docs/proposals/quay-proposal.md` / OUTER-LOOP.md both flag
DIR-004 Distribution as URGENT. A broken Core SEA binary is a real gap in that goal, not a cosmetic one
— the entire point of the SEA build is a portable, no-Node-runtime-needed executable, and it currently
cannot run past module-init for any gate-touching command (i.e., almost the entire CLI surface, since
`registry.ts` is a load-bearing import for most `quay` subcommands).

**Deeper structural note (uncoded, worth scoping into any fix):** even once the `import.meta.url` crash
itself is patched (e.g. swap to a build-time-injected constant, or `process.execPath`-relative logic,
or drop the ESM-only construct for a CJS-safe equivalent), `REPO_ROOT`-relative gate-script path
resolution is likely STILL fundamentally incompatible with a true single-file SEA distribution — the
gates under `experiments/quay-perpetual-stream/scripts/` won't exist inside/near the bundled binary at
runtime on an end-user machine. Whether the SEA build's gate subsystem should (a) embed gate scripts at
build time (like the manifest/version shims already do), (b) disable gate functionality entirely in the
distributed binary, or (c) something else, is a real design decision for whoever picks this up — not
resolved here.

## Plan
N/A — needs investigation into (a) a CJS-safe replacement for the `import.meta.url`/`__dirname`
pattern in `registry.ts`, and (b) the deeper REPO_ROOT-relative-gate-path SEA-compatibility question
above. Likely its own small milestone once scoped; not a one-line fix given the structural note.

## Acceptance Criteria
- [ ] `./packages/quay/dist-sea/quay --version` (and other gate-touching commands) run without crashing.
- [ ] The REPO_ROOT-relative gate-path SEA-compatibility question (structural note above) is explicitly resolved one way or another (embed / disable-in-SEA / other), not left as a silent gap.
- [ ] `bash packages/quay/scripts/build-sea.sh && ./packages/quay/dist-sea/quay --version` (and a `task list`/`gate` smoke command) pasted as real evidence, not asserted.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [ ] All 3 AC items above verified true with pasted command output.
- [ ] it0 DoD meta-enforcer passes all clauses.

## Not selected (M119)

Not selected M119 — exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH selected instead: smaller, cleanly
bounded (one-line regex fix), no open design question. This task is real and DIR-004-urgent, but its
own Plan explicitly admits it "needs investigation" into an unresolved structural question (SEA
gate-path compatibility) — per the sizing gauge (inherited-core.md, "does the proposed scope let
iteration-0 land ALL Done-when in one pass"), this is NOT yet cleanly sized for one milestone.
Recommend a future SELECT either (a) time-box a short investigation-only pass first to resolve the
structural question and re-scope the AC/DoD accordingly, or (b) apply DIR-026 split-or-commit to
separate "fix the import.meta.url crash" (mechanical, bounded) from "resolve gate-path SEA-compat"
(design decision, may itself need its own milestone) before dispatch. Good next high-priority pick
once sized.
