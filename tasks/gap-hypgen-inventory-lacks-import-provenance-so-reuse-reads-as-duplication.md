---
id: gap-hypgen-inventory-lacks-import-provenance-so-reuse-reads-as-duplication
title: "arch-hypothesis-generation: inventory and verifier lack import/call
  provenance, so shared reuse is repeatedly misread as duplication"
status: ready
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

## Acceptance Criteria
- [ ] `node --test plugin/test/arch-hypothesis-generation.test.mjs` exits 0, with new cases:
  - (a) The default inventory form's sha256 is unchanged on a fixture.
  - (b) The provenance form lists `imports` and `imported_by` for every component, including re-exports.
  - (c) The contamination scan ignores structural edges but still refuses a free-text cross-mention.
  - (d) The mechanical layer refutes a hypothesis whose components all import the symbol from one module, and does NOT refute one whose components each define it.
- [ ] Real reproduction at pin `e3163e519`: the default form's sha256 is still `fe87bd79420ba4f4f107fab17d1cfb62df47deb5a6776f93e19cd67a6057838c`. Paste it, together with the provenance form's sha256 and its component count.
- [ ] Real replay of the mechanical layer on the 15 acceptance clusters in `/data/home/yale/work/quay-scratch/hg-accept-run/` (no model call). Paste the clusters it refutes as `shared-implementation`, with the evidence lines.
  - Positive control: c7 and c12 are among them.
  - Negative control: none of the 5 verifier-supported clusters (c1, c5, c8, c14, c15) is mechanically refuted. If one is, report it as a finding rather than adjusting the rule.
- [ ] Mutation control: make the mechanical layer ignore re-exports and show case (b) goes red. Paste the output, then revert.

## Definition of Done
- All AC ticked with output pasted.
- `scripts/test.sh --for-task gap-hypgen-inventory-lacks-import-provenance-so-reuse-reads-as-duplication` green.
- No change to any frozen prompt file.

## Touches
- tasks/gap-hypgen-inventory-lacks-import-provenance-so-reuse-reads-as-duplication.md
- docs/analysis/arch-hypothesis-generation.mjs
- plugin/test/arch-hypothesis-generation.test.mjs
