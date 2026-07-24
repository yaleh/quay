---
id: exp5-DEFECT-DELIVERY-MANIFEST-INCOMPLETE-RELEASE
title: "defect: release.yml publishes an INCOMPLETE artifact-set vs delivery-manifest.json (4/7), and delivery-manifest-check passes anyway"
status: todo
labels:
  - milestone-candidate
  - defect
parent: null
children: []
extra:
  schema: "v1"
---
## Proposal

Found at the v0.3.12 release (2026-07-24, GitHub Actions run 30059096816 — all 8 jobs green):
`delivery-manifest.json` (M129 — the single source of truth for the release artifact-set; "release.yml
must produce exactly this set — no more, no less") declares **7 artifacts**, but the actual GitHub
Release `v0.3.12` published only **4**:

| delivery-manifest.json declares | v0.3.12 actually published |
|---|---|
| npm tarball `quay-{v}.tgz` | ✅ |
| SEA `quay` × {linux-x64, macos-arm64, windows-x64} | ✅ (3) |
| SEA `quay-native` × {linux-x64, macos-arm64, windows-x64} | ❌ not built by release.yml |
| plugin `quay` marketplace bundle | ❌ not uploaded as a Release asset |

Two coupled gaps:

1. **release.yml does not construct the full declared set** — there is no `quay-native` SEA build leg
   and no plugin-bundle upload step, so the manifest's `sea-binaries[quay-native]` and `plugin` entries
   are aspirational, not actually produced.
2. **`delivery-manifest-check` (M129) PASSED on this 4/7 release** — i.e. the assertion does NOT
   compare the manifest's declared set against the concrete artifacts actually produced/uploaded. It
   appears to validate release.yml's *self-described* output against the manifest, which is circular
   when release.yml and the manifest disagree on scope. The single-source guarantee M129 intended
   ("no more, no less") is therefore not enforced.

Consequence: chart-2 S2's `manifest-published` conjunct
(`chart2-s2-delivery-completeness.ts` → `fullManifestPublished` evidence flag in `chart2-s2-delivery.json`)
correctly stays `false` — the release is genuinely incomplete, not merely un-flagged. This is the
remaining work for `exp5-M-PRODUCTIZED-DELIVERY-C` (the human-steered real outward publish that flips
S2): make release.yml construct + publish the full manifest set, tighten the check to compare declared
vs actually-produced, then flip `fullManifestPublished: true` on real evidence.

## Plan
N/A — needs a sizing decision before SELECT: either (a) extend release.yml to build
`quay-native` SEA (×3 platforms) + upload the plugin marketplace bundle, and tighten the check to
compare declared vs produced; or (b) if those artifacts are intentionally out of the public release,
shrink `delivery-manifest.json` to match reality and make the check enforce that smaller set. Either
way the manifest and release.yml must converge on one truth and the check must fail on divergence.

## Acceptance Criteria
- [ ] `delivery-manifest.json`'s declared artifact-set and release.yml's actually-produced set agree
      (a documented decision: extend release.yml OR shrink the manifest).
- [ ] `delivery-manifest-check` fails (non-zero) when the actually-produced set ≠ the declared set —
      proven by a RED fixture (drop/withhold a declared artifact → check fails before the fix holds).
- [ ] A real tagged release publishes exactly the declared set, after which S2's `manifest-published`
      conjunct can be honestly flipped with recorded evidence.

## Definition of Done
Standard inherited-core DoD clauses apply (adversarial-audit, V_meta consolidation-lag, line-budget,
impl-row N/A, no-self-exemption, escrow-Δv, test-floor, task-canonical-lifecycle-record, tree-hygiene,
worktree-branch-hygiene, audit-independence).
- [ ] All AC items above verified true with pasted command output / real release-run URLs (not asserted).
- [ ] it0 DoD meta-enforcer passes all clauses at ABSORB.
