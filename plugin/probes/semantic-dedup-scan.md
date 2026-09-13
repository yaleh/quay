---
instrument: archguard
fallback: git-lens
output_routing:
  duplication: milestone-candidate
  default: milestone-candidate
---
You are a fresh-context DEEP SEMANTIC DEDUPLICATION analyst for the quay repo.

This is the DEEP mode. It exists because the shallow mode (one analyst reading the tree once,
reporting what catches the eye) provably missed real duplication: on 2026-08-25 a one-off manual run
that pulled the FULL entity list of `plugin/scripts/` (≈2000 entities) + `packages/quay/src` (≈370)
and dispatched SEVEN parallel verifiers over 15 suspected clusters confirmed 8+ real duplicates that
the shallow pass had never surfaced — including byte-identical function bodies (`findRepoRoot` /
`findWorkspaceRoot`) and one `write:state` helper implemented six times, split across an atomic and a
non-atomic variant. Sampling cannot find those; only an exhaustive inventory plus per-cluster
verification can.

⛔ DO NOT FIX ANYTHING YOU FIND. Your entire product is the JSON object described below. Merging,
extracting, renaming, or "cleaning up" a duplicate is a separate task filed by a separate mechanism —
a probe that edits the tree is a rogue probe, and the routine that spawns you mechanically rejects its
own run when you touch a tracked file.

## ① Build the FULL inventory (exhaustive — this is the part the shallow mode skips)

Enumerate every entity/function on BOTH surfaces, mechanically:

- `plugin/scripts/` — every `.ts` / `.mjs` / `.js` file.
- `packages/*/src/` — every source file in every package's `src/`.

Do it with a real extractor, not with intuition:

- PRIMARY instrument: the **archguard** MCP tool (the L_D/L_G instrument, ADR-007). Use it if it
  returns a usable scope.
- FALLBACK (this plain-ESM repo often has no tsconfig for archguard to persist a scope — recorded
  2026-07-20): the reclaimed git-lens proxies in `plugin/scripts`:
  - `node --experimental-strip-types plugin/scripts/identity-replication-check.ts --root . --json` —
    P2 identity replication: which entity names / path literals are independently re-declared across
    code files without a single accessor, plus byte-identical file pairs.
  - `node --experimental-strip-types plugin/scripts/git-lens-l-g-structural-drift.ts <dir>` — L_G
    structural drift (dependency cycles, god-modules) over `plugin/scripts` and each `packages/*/src`.
- Then complete the inventory yourself (grep/`node` one-liners over the two surfaces are fine):
  collect `symbol → file:line` for exported and module-level functions, and — crucially — a
  **normalized body digest** per function (strip comments/whitespace) so that byte/near-identical
  implementations are detectable by ARITHMETIC rather than by reading.

Report the inventory SIZE in the `inventory` field of your output (`{"plugin_scripts": <n>,
"package_src": <n>, "candidate_clusters": <n>}`), so the routine's carrier can distinguish a full
pass from a skim.

## ② Verify candidate clusters in SHARDS (⛔ not one agent reading everything)

Group the suspects into candidate clusters: (a) identical/near-identical normalized bodies, (b) the
same symbol defined in ≥2 files, (c) the same runtime entity independently re-declared (the
`identity-replication-check` rows), (d) diverged variants of one behavior (e.g. an atomic and a
non-atomic write of the same state).

Then **shard** them and verify each shard in its own fresh context:

- Dispatch multiple fresh-context subagents (the Task tool), ONE PER SHARD, ≤6 candidate clusters
  per shard. Give each shard agent only its batch and require per-cluster findings back.
- The shard agents are the ones doing the semantic work: for each cluster they decide
  `real-duplication` / `divergent-implementation` / `coincidental` / `uncertain`, and they must cite
  the concrete file paths and symbol names that justify the call.
- You (the lead) aggregate. Report the number of shards you actually used in `shards`.
- If subagents are unavailable in your context, verify cluster-by-cluster SEQUENTIALLY yourself and
  report `shards: 1` — honest, not inflated. Say so in `notes`.

## ③ Output: STRUCTURED findings — never a green/red boolean

A boolean ("duplication: yes") is unusable: it names nothing, so nothing can act on it, and a gate
built from it is indistinguishable from a broken gate. Every finding must carry the concrete paths,
the symbol names, and the reason.

Beyond the clusters, follow the full inventory where it leads — e.g. a helper implemented many times,
one behavior with several divergent implementations, a module that re-implements another module's
function. Report what the ONE-PASS shallow read could not have seen. If a scan is bounded by your
time budget, say in `notes` what was left unverified rather than implying full coverage.

Emit exactly one JSON object on stdout (no prose, no code fences), per the routine's output contract:

```
{"findings":[{"id":"<slug>","kind":"<byte-identical-body|same-symbol-multi-file|divergent-implementation|identity-replication|other>","symbols":["<fn>"],"files":["<path:line>","<path:line>"],"verdict":"<real-duplication|divergent-implementation|coincidental|uncertain>","rationale":"<one line: why these are / are not the same thing>","suggestedAction":"<one line: extract|merge|leave>"}],"shards":<int>,"inventory":{"plugin_scripts":<int>,"package_src":<int>,"candidate_clusters":<int>},"notes":"<one line: coverage / what was left unverified>"}
```

An empty `findings` array is a legitimate answer (it means the exhaustive pass found nothing) — it is
a measurement, not a failure.
