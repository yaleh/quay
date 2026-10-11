---
id: gap-hypgen-inventory-lacks-import-provenance-so-reuse-reads-as-duplication
title: "arch-hypothesis-generation: inventory and verifier lack import/call
  provenance, so shared reuse is repeatedly misread as duplication"
status: done
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-hypgen-prereg-gate-trusts-caller-and-run-identity-collides
---
## Proposal
Measured from the two existing hypgen verifier result files (round 1 `/data/home/yale/work/quay-scratch/hypgen/out/verify.json` and acceptance `/data/home/yale/work/quay-scratch/hg-accept-run/verify.json`, both at pin `e3163e519`):
- **6 of 7 refuted clusters were reuse misread as duplication.** The components named in the hypothesis import or call ONE shared implementation:
  - round 1: c2 (`driverCap`), c9 (driver-config quota defaults), c12 (`deriveObligationId`);
  - acceptance: c2, c7 (all consumers import `touches-parser.ts`, which `plugin/test/touches-parser-parity.test.mjs` pins), c12 (`ratchet-baseline.ts`).
- The only non-reuse refutation is round 1 c13, a bash↔TS duplication.
- **The cause is the inventory.** It deliberately carries exported names but no import edges. Similar export names therefore look like separate implementations, and a verifier model call (16-70 s each) is spent refuting what one import lookup would settle.

## Plan
1. **A new opt-in inventory form, `--inventory-form provenance`.** For EVERY component it adds the same structured fields:
   - `imports`: the repo-relative module plus the imported names;
   - `imported_by`: the fan-in modules.

   Compute these with a static ES import parse. Reuse an existing parser in the repo if one is exported (for example the one behind `import-graph-check.ts`); otherwise add a small pure parser. Re-exports count as imports. The original form stays the default and byte-identical: its sha256 is unchanged.
2. **The contamination scan applies only to free-text fields** (the catalog question). Structural edges are neutral repository facts, not labels. Document this, and keep refusing a free-text cross-mention as today.
3. **A mechanical pre-verification layer runs before any verifier model call.** If every non-defining component named by a hypothesis imports the claimed symbol, or the module that defines it, from one single component, record verdict `refuted` with reason `shared-implementation`, with the import lines as evidence (path, line, sha256). That cluster then spends no model call. Every other cluster goes on to the model verifier unchanged.
4. **No investigator prompt is changed.** The frozen prompt (sha `19be8974…`) stays untouched. A provenance-form run needs its own new prompt file, hashed in its own pre-registration. That prompt describes the new fields neutrally and gives no hint about reuse.

## Implementation notes
- The parser is the repo's OWN `extractImports` + `resolveSpecifier` (behind `import-graph-check.ts`), so the code-position discipline (a mention inside a comment/string is not an edge) is not re-invented. This module adds only `importedNames` (that parser returns no names) and `importClauseNames`.
- The contamination scan drops the STRUCTURAL fields (`CONTAMINATION_EXCLUDED_FIELDS = ["imports","imported_by","sha256"]`) from the scanned text; for the `neutral` form this is byte-for-byte the previous `JSON.stringify(e)`, so its behaviour is provably unchanged.
- The provenance rule is: among the hypothesis's components, the intra-set import edges converge on ONE component (the definer) and >= 2 members import from it. `symbol` = the names EVERY importer takes from the definer (null when they take different names — the edge still settles it). With no provenance or < 2 known components it returns null (硬规则 3b: "could not evaluate" is not a refutation).
- Observation (out of scope, NOT fixed here): the acceptance run's `contamination-pairs.json` is an array-of-arrays (`pairs: [[a,b],...]`), which `contaminationScan` reads as `p.groups ?? [p.a,p.b]` => an empty group list, so with that file shape the scan never fires and "contamination clean" is vacuous (a pre-existing 硬规则 3b shape, unchanged by this task). The AC(c) case exercises the documented `{id, groups}` shape. Fixing the pair parsing is a separate decision: with the array shape interpreted as intended, `quality-gate-driver.ts` IS contaminated by the pair `["pool-quality-judge","quality-gate-driver"]`, i.e. the round-1/acceptance inventories would refuse — not a change this task may make silently.

## Acceptance Criteria
- [x] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0, with new cases:
  - (a) The default inventory form's sha256 is unchanged on a fixture.
  - (b) The provenance form lists `imports` and `imported_by` for every component, including re-exports.
  - (c) The contamination scan ignores structural edges but still refuses a free-text cross-mention.
  - (d) The mechanical layer refutes a hypothesis whose components all import the symbol from one module, and does NOT refute one whose components each define it.

  ```
  $ node --test plugin/test/arch-hypothesis-generation.test.mjs
  ✔ AC(a): the default (neutral) inventory form's sha256 is unchanged, and provenance is opt-in
  ✔ AC(b): the provenance form lists `imports` and `imported_by` for every component, incl. re-exports
  ✔ AC(c): contamination ignores structural edges but still refuses a free-text cross-mention
  ✔ AC(d): the mechanical layer refutes all-import-from-one-module, not each-defines-it
  ℹ tests 24
  ℹ pass 24
  ℹ fail 0
  ```
  (a) is pinned to `3a475a3011ed253054024decb02f618d3726269f774e58608a7c199f26a8677e` — the value produced by running the SAME fixture through the module at the commit BEFORE this change (`git show <base>:docs/analysis/arch-hypothesis-generation.mjs`). (b) asserts beta's plain import, gamma's RE-EXPORT (`export { shared } from`), delta's `export * from`, and alpha's fan-in. (d) also drives `runVerifier` and asserts the model seam was called 0 times for the mechanically refuted cluster, and 1 time for the same cluster when no provenance is supplied.
- [x] Real reproduction at pin `e3163e519`: the default form's sha256 is still `fe87bd79420ba4f4f107fab17d1cfb62df47deb5a6776f93e19cd67a6057838c`. Paste it, together with the provenance form's sha256 and its component count.

  ```
  $ node --experimental-strip-types docs/analysis/arch-hypothesis-generation.mjs inventory --root /data/home/yale/work/quay --pin e3163e519 --max-exports 15 --carrier-forms literal --contamination-pairs .../contamination-pairs.json
  arch-hypothesis-generation inventory rev=e3163e519 form=neutral components=283 sha256=fe87bd79420ba4f4f107fab17d1cfb62df47deb5a6776f93e19cd67a6057838c contamination=clean

  $ ... inventory --root /data/home/yale/work/quay --pin e3163e519 --max-exports 15 --carrier-forms literal --inventory-form provenance --contamination-pairs .../contamination-pairs.json
  arch-hypothesis-generation inventory rev=e3163e519 form=provenance components=283 sha256=0f1ea0e4e7a05f7b3693f88470e4d7e1d27b202e0c02df4fd4028ced26359058 contamination=clean
  ```
  - default form sha256 unchanged: `fe87bd79420ba4f4f107fab17d1cfb62df47deb5a6776f93e19cd67a6057838c` (== the round-1 / acceptance pin value, and == the acceptance prereg's `inventory` hash), 283 components;
  - provenance form sha256: `0f1ea0e4e7a05f7b3693f88470e4d7e1d27b202e0c02df4fd4028ced26359058`, **283 components** (222440 bytes vs the neutral form's 133615).
- [x] Real replay of the mechanical layer on the 15 acceptance clusters in `/data/home/yale/work/quay-scratch/hg-accept-run/` (no model call). Paste the clusters it refutes as `shared-implementation`, with the evidence lines.
  - Positive control: c7 and c12 are among them.
  - Negative control: none of the 5 verifier-supported clusters (c1, c5, c8, c14, c15) is mechanically refuted. If one is, report it as a finding rather than adjusting the rule.

  Run through the SHIPPED `mechanicalRefutation` (no model call), clusters + verifier verdicts from the recorded `hg-accept-run/verify.json`, edges from the provenance inventory of the same pin:
  ```
  c1   verifier=supported    mechanical=-
  c2   verifier=refuted      mechanical=-
  c3   verifier=undetermined mechanical=-
  c4   verifier=undetermined mechanical=-
  c5   verifier=supported    mechanical=-
  c6   verifier=undetermined mechanical=-
  c7   verifier=refuted      mechanical=REFUTED shared-implementation (definer=plugin/scripts/touches-parser.ts importers=4 symbol=null)
  c8   verifier=supported    mechanical=-
  c9   verifier=undetermined mechanical=-
  c10  verifier=undetermined mechanical=REFUTED shared-implementation (definer=plugin/scripts/source-text-lib.ts importers=3 symbol=["lineOf"])
  c11  verifier=undetermined mechanical=REFUTED shared-implementation (definer=plugin/scripts/source-text-lib.ts importers=2 symbol=["lineOf"])
  c12  verifier=refuted      mechanical=REFUTED shared-implementation (definer=plugin/scripts/ratchet-baseline.ts importers=3 symbol=null)
  c13  verifier=undetermined mechanical=-
  c14  verifier=supported    mechanical=-
  c15  verifier=supported    mechanical=-

  mechanically refuted as shared-implementation: 4 — c7, c10, c11, c12
  evidence lines:
    c7: definer plugin/scripts/touches-parser.ts; shared symbol null
       plugin/scripts/fan-in-ts-typecheck-gate.ts:48 imports plugin/scripts/touches-parser.ts {extractTouchesSection,parseTouchEntriesWithTags} sha256=2b5e5fac25f95518eb222599b3fa6a860809736f648306b7bba53a796dc009b1
       plugin/scripts/prepare-admission-check.ts:54 imports plugin/scripts/touches-parser.ts {parseTouchEntries} sha256=a622eed18d58730b630893cc3761147f65b71183fe57a000eda8f237a79db0e2
       plugin/scripts/select-tests-for-touches.ts:64 imports plugin/scripts/touches-parser.ts {parseTouchEntries} sha256=5d318996867ee823f19ec115269da7ae24b560649be5ae663c6a3b95c5d34eae
       plugin/scripts/touches-orthogonality-check.ts:36 imports plugin/scripts/touches-parser.ts {extractTouchesSection,parseTouchEntries,parseTouchEntriesWithTags} sha256=48050f1acd8b8fcec5eb0c3965df6ed698a2edc61d3df98715558e50d67f5e48
    c10: definer plugin/scripts/source-text-lib.ts; shared symbol ["lineOf"]
       plugin/scripts/checker-lib.ts:26 imports plugin/scripts/source-text-lib.ts {colOf,lineOf} sha256=8b34e887bab5dc0bb3ff4dc4fe7eef6fa756e189a9efa75a7b0f4470bf555ab9
       plugin/scripts/goal-driver-task-boundary-check.ts:47 imports plugin/scripts/source-text-lib.ts {lineOf,snippetOf} sha256=516c80e9e9152d2f7060f49b0dae249bc65b650ded633baed3ddab4f263faff3
       plugin/scripts/identity-replication-check.ts:50 imports plugin/scripts/source-text-lib.ts {lineOf} sha256=57015e7623fd1186a7f28c621a985ae78c0178143095963a96bfcfe4d7a52f88
    c11: definer plugin/scripts/source-text-lib.ts; shared symbol ["lineOf"]
       plugin/scripts/goal-driver-task-boundary-check.ts:47 imports plugin/scripts/source-text-lib.ts {lineOf,snippetOf} sha256=516c80e9e9152d2f7060f49b0dae249bc65b650ded633baed3ddab4f263faff3
       plugin/scripts/identity-replication-check.ts:50 imports plugin/scripts/source-text-lib.ts {lineOf} sha256=57015e7623fd1186a7f28c621a985ae78c0178143095963a96bfcfe4d7a52f88
    c12: definer plugin/scripts/ratchet-baseline.ts; shared symbol null
       plugin/scripts/sh-census-check.ts:61 imports plugin/scripts/ratchet-baseline.ts {baselinePath} sha256=99f7f6f1698d1e13cace90105c02e6ee20540f64264098889b420e33d092d972
       plugin/scripts/task-ac-carryover-check.ts:67 imports plugin/scripts/ratchet-baseline.ts {readRatchetBaseline,writeRatchetBaseline} sha256=8aa8e3770704dd9c69dccb6117ffc66b2da5f432c6c620d2d93a7f7346e8c25b
       plugin/scripts/touches-one-entry-one-path-check.ts:47 imports plugin/scripts/ratchet-baseline.ts {readRatchetBaseline} sha256=0641d219317abc82867437883e25ed87e7d3b11f7146b366ce56b40c8ae3c6c3

  positive control (c7, c12 among the refuted): true
  negative control (none of c1,c5,c8,c14,c15 refuted): true
  ```
  - **Positive control holds**: c7 → `touches-parser.ts` (4 importers), c12 → `ratchet-baseline.ts` (3 importers).
  - **Negative control holds**: none of c1, c5, c8, c14, c15 is refuted — reported as-is, the rule was NOT adjusted.
  - **Finding (not a reason to adjust the rule)**: the rule also refutes c10 and c11 (both `undetermined` under the model verifier) → `source-text-lib.ts`, shared symbol `lineOf`. These clusters were not in either control; under the rule's own predicate both are genuine star-shaped reuse of one module (2–3 members import `lineOf`/`colOf`/`snippetOf` from it), so the hit is a statement about the EDGES, not a claim the model verifier already contradicted.

- [x] Mutation control: make the mechanical layer ignore re-exports and show case (b) goes red. Paste the output, then revert.

  Mutation applied in `buildProvenance`: `if (/^\s*export\b/.test(src.split("\n")[im.line - 1] ?? "")) continue;` (an `export … from` is no longer an import edge).
  ```
  $ node --test plugin/test/arch-hypothesis-generation.test.mjs
  ✖ AC(b): the provenance form lists `imports` and `imported_by` for every component, incl. re-exports
    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      at ...arch-hypothesis-generation.test.mjs:572:10
    actual: [],
    expected: [ { module: 'plugin/scripts/alpha.ts', names: [Array], line: 1 } ]
  ℹ tests 24
  ℹ pass 23
  ℹ fail 1
  ```
  Only case (b) went red (23/24 pass) — the re-export assertion is what fails. Mutation reverted; `grep -c "MUTATION CONTROL" docs/analysis/arch-hypothesis-generation.mjs` = 0 and the file is back to 24/24.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-hypgen-inventory-lacks-import-provenance-so-reuse-reads-as-duplication` green.
  ```
  $ bash scripts/test.sh --for-task gap-hypgen-inventory-lacks-import-provenance-so-reuse-reads-as-duplication --allow-thin
  EXIT=0   (scoped static checks all PASS/NOT-EVALUATED; the selected test file: 24 pass / 0 fail)
  ```
- No change to any frozen prompt file.
  ```
  $ git status --porcelain docs/analysis/arch-hypothesis-generation-prompts/   # (empty)
  $ md5sum docs/analysis/arch-hypothesis-generation-prompts/*.txt
  cf847797d964ef4a3965555fdc81933e  investigator-round1-frozen.txt   (sha256 19be8974… — the test pins it)
  563b5ce7274087225226d460dd092483  investigator.txt
  bea452604b5c3c8e0e6c550544e9ea30  reviewer.txt
  d3f222ee99ce679748f3adc4dd000230  verifier.txt
  ```

## Touches
- tasks/gap-hypgen-inventory-lacks-import-provenance-so-reuse-reads-as-duplication.md
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/arch-hypothesis-generation.test.mjs
