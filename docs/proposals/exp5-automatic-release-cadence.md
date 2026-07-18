# Automatic, conditional post-milestone release cadence for the exp5 perpetual stream

**Status:** DRAFT (proposal). Authored 2026-07-18 from a live human-steering
conversation. Precedes any DIR / backlog candidate — this document is the design
artifact the eventual milestone charters against.

**Scope:** how the perpetual OUTER loop should *release* the `quay` product
(npm tgz + cross-platform SEA executables) on an automatic-but-damped cadence,
without a human hand-cutting tags and without releasing on every milestone.

---

## 1. Problem — the release mechanism works, but is stale and not wired into the loop

Ground-truth check against GitHub this conversation (not docs):

- **The mechanism exists and works.** `.github/workflows/release.yml` triggers
  on `v*` tag push and builds the npm `quay-<v>.tgz` **plus** cross-platform SEA
  single-file executables. The latest release **v0.3.4** carries all four assets
  (`quay-0.3.4.tgz`, `quay-sea-0.3.4-{linux-x64,macos-arm64}.tar.gz`,
  `quay-sea-0.3.4-windows-x64.zip`); its Release run succeeded. So "build node
  into deliverable executables + GitHub Actions release" — the DIR-004 / M01-dist
  ask — is genuinely shipped.

- **But the released artifact is stale and the pipeline is manual.** The whole
  v0.3.0→v0.3.4 series was pushed in a ~20-minute window during **M01-dist
  iteration-1's own CI debugging** (fixing Windows SEA path, container-absent
  `gh`, private-repo asset download); v0.3.0–v0.3.3 Release runs all *failed*,
  only v0.3.4 succeeded. Since then, milestones **M02–M11** landed real product
  changes on master (M08 merge-recovery restored `--version`/`--page-size`/
  `--format json`; M09 added GitHub-provider write) and **not one cut a release.**
  `packages/quay/package.json` is already at **0.3.5**, but there is **no v0.3.5
  tag and no release** — a bump with no publish. The downloadable executables are
  ~10 milestones behind master.

- **Root cause: layer collapse.** M01-dist delivered the packaging *capability*
  (one-shot) and was marked DONE; the *ongoing act of releasing* was never made a
  step of the perpetual loop. Release is tag-triggered only, and ABSORB never
  cuts a tag, so distribution silently falls behind as milestones land.

## 2. The cautionary precedent — a gate that never fires is worse than no gate

The methodology already has one post-milestone gate, the **adversarial-audit
role** (DIR-007 / M10-audit-consolidation). Status check this conversation:

- **Designed + wired:** yes — `inherited-core.md` §"Adversarial-audit role" +
  §"Adversarial-audit cadence rule", and `OUTER-LOOP.md` step 6 as a HARD BLOCK.
- **Ever executed:** no. Zero `*-adversarial-audit.md` artifacts exist in exp5.
  Its own declared "first real trigger," **M11**, determined in iteration-1 that
  the gate did **not** apply — the cadence rule is a *conjunction* (value type
  includes `capability-growth` AND ABSORB appends nonzero Δv), and M11's value
  type was discovery/risk-option with Δv=0, so both prongs failed. The milestone
  reasoned its way out of the gate at first contact.

**Design consequence for the release gate:** its trigger must be a **mechanical,
git-checkable predicate**, not a value-type judgment that a milestone can argue
away. The manual-release failure mode ("withers from low frequency") and the
audit-gate failure mode ("a clever conjunction talks itself out of firing") are
the same disease — the release gate must be immune to both. Keep the predicate
dumb, and **log the fire/no-fire decision every milestone** (no silent skip),
the same "state plainly why the check did/didn't apply" discipline OUTER-LOOP
already imposes on the audit gate.

## 3. Resolved design decisions (human, this conversation)

1. **Release-branch model:** merge `master` → `release`, then tag on `release`.
2. **Trigger predicate:** fire only when *far enough since the last release* AND
   *enough accumulated change* — two independent dampers, both must hold.
3. **Version bump:** by change type (semver derived from the accumulated
   changes), not blind patch-increment.

Plus the framing constraints from the same conversation:

4. **Automatic, not manual** (manual withers), **but not every milestone**
   (too frequent, and lacks the necessary checks).
5. **A post-milestone "should we release?" judgment**, positioned *near* the
   adversarial-audit gate but **not merged into it** — the two are separate,
   independently-composable capabilities (see §7).
6. **The actual release action runs as an async background subagent** so it never
   blocks the next milestone's execution (see §6).

## 4. Where the release gate sits in the OUTER cycle

Both the audit gate and the release gate are ABSORB-time (post-milestone). They
are **co-located but sequenced**, and kept as two distinct steps:

```
OUTER cycle step 6 (ABSORB):
   … measure Δv, φ/consolidation, V_meta gate …
   6a. Adversarial-audit gate      (existing; HARD BLOCK; DIR-007)
        └─ must CLEAR first — never release un-audited / REFUTED work
   6b. Release-cadence gate        (NEW; this proposal)
        ├─ evaluate the mechanical predicate (§5)
        ├─ log fire/no-fire + reason on the dashboard (mandatory, no silent skip)
        └─ if FIRE → dispatch async release subagent (§6), then CONTINUE
step 7 (UPDATE DASHBOARD) / step 1 (SELECT next milestone) proceed immediately —
   the release runs in the background and does not gate the loop.
```

Ordering rationale: releasing is downstream of trust. The audit gate (when it
applies) must clear before a release can carry that milestone's changes. But the
release gate must still be able to fire on milestones the audit gate skips — so
6b's predicate is independent of 6a's outcome except for the "not REFUTED" floor.

## 5. Trigger predicate — mechanical, both dampers required

Fire the release gate at step 6b iff **all** of:

- **(D) Distance damper — far enough since last release.**
  `milestones_since_last_successful_release ≥ K_dist`. "Last successful release"
  is defined by the actual pushed tag / existing GitHub Release (queried via
  `gh release view`), **never** a local optimistic flag (echoes DIR-010: don't
  trust an un-verified mirror). Soft default **K_dist = 3**.
- **(C) Accumulation damper — enough real product change.**
  Cumulative product-code delta since the last release tag is non-trivial:
  `git diff <last-release-tag>..HEAD -- packages/` shows changes beyond
  whitespace/comments, AND at least one milestone in the window was
  product-touching (its value-typed ledger entry includes `capability-growth`,
  or its diff touches `packages/*/src` / `bin`). Soft floor: **≥1 product-
  touching milestone** and a diffstat above a small line threshold (tunable).
- **(F) Trust floor.** No unresolved REFUTED verdict from 6a on any milestone in
  the window.

`K_dist` and the accumulation floor are **soft/tunable**, same status as the VT
surface weights — revise at checkpoints from live data. Both dampers are
`git`/counter-checkable; neither is a subjective value-type test, so a milestone
cannot argue itself out of a release the way M11 did with the audit gate.

Worked example against current state: last release v0.3.4 at m1; it is now m11 →
`milestones_since = 10 ≥ 3` (D holds); M08/M09 touched `packages/**` product code
(C holds); no REFUTED verdicts (F holds) → the gate **would fire now**, cutting
the overdue release and resolving the 0.3.5-untagged drift.

## 6. The release action — async background subagent

When 6b fires, dispatch a **`run_in_background=true` subagent** to perform the
release, then return to the loop immediately (matches OUTER-LOOP's existing
non-blocking-dispatch + "poll, don't conclude" discipline for long inner work):

Subagent steps:
1. Determine the new version from change type (§8) and the last release tag.
2. `git checkout release && git merge --no-ff master` (fast-forward or merge per
   §7), bump `packages/quay/package.json` (and any sibling published package) to
   the new version, commit on `release`.
3. Tag `v<new>` on `release`, push branch + tag → `release.yml` fires.
4. Poll the GitHub Actions run until complete; verify **all expected assets**
   uploaded (tgz + the three SEA archives) via `gh release view`.
5. Report back: success (tag + asset digests) or failure (which step/asset).

**Failure = self-healing, not lost.** Because predicate (D)/(C) anchor on the
last *successful* release (real tag/Release existence), a failed async release
simply leaves the next milestone's gate still seeing un-released product delta →
it retries. No version is skipped; no double-release, because:

**Concurrency guard.** At most one release subagent in flight. If the previous
release subagent has not reported success by the next boundary, 6b does **not**
dispatch a second one for the same pending delta — it logs "release in flight,
skipped" and lets the outstanding one finish (or its failure surface).

## 7. Separation of concerns — two orthogonal reusable capabilities

`inherited-core.md` is the reusable substrate other quay-using projects inherit.
The audit gate and the release gate must land there as **two independent
sections**, each independently toggleable, **not** one fused "post-milestone
finalization" step. Rationale (human, this conversation): a future project may
want release cadence without adversarial audit, or adversarial audit without any
release step at all. Concretely:

- Adversarial-audit gate: about *trust in the recorded outcome* (did the
  milestone's claims survive an independent refutation attempt).
- Release-cadence gate: about *shipping accumulated, trusted product change*.

They compose (6a before 6b) but neither depends on the other's existence: a
project that deletes the audit section still has a working release gate (the (F)
trust floor degrades to "always satisfied"), and vice versa. Keep the two
`inherited-core.md` sections free of cross-references beyond the 6a→6b ordering
note in `OUTER-LOOP.md`.

## 8. Version bump by change type

Derive the semver increment from the accumulated changes in the release window
(since the last release tag), not a blind patch bump:

- **major** — any window milestone introduced a breaking product change
  (CLI/MCP/ABI contract removed or incompatibly changed; detectable from the
  value-typed ledger's `governance-integrity`/breaking notes or a conventional-
  commit `!`/`BREAKING CHANGE`).
- **minor** — else, any window milestone was `capability-growth`-typed / added a
  user-facing capability (`feat`).
- **patch** — else (fix/polish/instrument-correction only).

Source of truth for "change type" is the milestones' own value-typed SELECT
ledger entries (already recorded per milestone) plus conventional-commit prefixes
on the window's `packages/**` commits — so this reuses signals the methodology
already captures rather than inventing a new classification. The subagent records
the derivation (which milestone/commit forced which level) in the release notes.

## 9. `release.yml` / CI implications + a self-description drift to fix

- **Trigger stays `v*` tag push** — unchanged; the new machinery is *upstream* of
  the tag (it decides when to create the tag, on the `release` branch). No change
  to how the workflow builds assets.
- **Fix stale self-description (DOC-006 sibling).** `release.yml`'s header comment
  still says it "Builds a distributable npm pack artifact" (npm-pack Option B
  only) and never mentions the SEA build later added — this documentation drift is
  part of why the latest release *looks* source-only at a glance. Update the
  header + add a README/CHANGELOG note documenting the SEA executables (same file
  set DOC-006/DOC-007 already flag; fold in or cross-reference).
- **CHANGELOG.** The release subagent should append the derived-version entry so
  CHANGELOG stops lagging (DOC-007).

## 10. Open decisions still to tune (non-blocking; start with the defaults above)

1. Exact `K_dist` and the accumulation line-floor (start 3 / small floor; tune at
   checkpoints).
2. Whether `release` merges are `--no-ff` (audit-friendly history) or
   fast-forward-only (linear) — default `--no-ff`.
3. Whether a human `.release-hold` sentinel (mirror of `.halt`) should let a human
   veto an automatic release at a boundary without stopping the loop — cheap to
   add, matches the async-control-surface pattern; recommended.

## 11. Status / next step

Design-only. When adopted, this becomes a `backlog.md` milestone candidate
(value type: capability-growth on Packaging + governance-integrity on the loop),
SELECTed and chartered through the normal OUTER machinery — it touches product
config (`release.yml`, version files, a new `release` branch), `OUTER-LOOP.md`
(step 6b), and `inherited-core.md` (the new release-cadence capability section),
so it is a real build milestone, not a doc edit. It also cleanly subsumes the
immediate version-hygiene fix (cut the overdue v0.3.5+ release). A companion DIR
may record the human-steering origin and point here.

Separately (out of scope here, flagged for its own record): the adversarial-audit
gate's never-fired / first-contact-self-exemption state (§2) suggests its cadence
condition may be mis-specified — worth its own finding, independent of release.
