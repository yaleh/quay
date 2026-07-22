---
id: exp5-DEFECT-ROUTINE-GATE-SELF-REJECT
title: "defect: routine candidates written INTO the board self-reject as
  duplicates — routine-file-gate boardKeys() scans the whole --board dir
  including the candidate, so every routine finding false-dedups against itself
  (routines can't file unattended)"
status: done
labels:
  - milestone-candidate
  - defect
  - milestone:M-96
parent: null
children: []
extra:
  schema: v1
  acceptance: bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh
    exp5-DEFECT-ROUTINE-GATE-SELF-REJECT
    experiments/quay-perpetual-stream/charters/M96-routine-gate-self-reject-fix.md
    /tmp/m96-absorb-entry.md
---
## Finding
Surfaced by the DIR-051 real routine-fire on archguard (2026-07-22). The loop-driver skill's routine flow
writes a candidate finding `.md` INTO the board directory (`quay-tasks/PROBE-*.md`) and THEN runs
`routine-file-gate.mjs --board <boardDir> <candidate>`. But `routine-file-gate.mjs`'s `boardKeys(boardDir)`
scans **all** `.md` files in `--board` to build the dedup key set — **including the candidate that was just
written there**. So the candidate's own finding-key is "already on the board" → the gate REJECTS it as a
duplicate **of itself**.

**Evidence (the fire that exposed it):**
- FIRST archguard fire: adversarial-explore found 3 REAL defects (JavaPlugin.isTestFile, KotlinPlugin
  regex, Java/Python supportedLevels) → all "REJECTED as duplicates already on board" → 0 filed. These were
  NOT genuine board-duplicates; they self-collided (candidates staged in-board).
- SECOND fire only filed `PROBE-NEW.md` because the probe agent WORKED AROUND the bug: staged the candidate
  to `/tmp/`, gated it there, and moved it onto the board only on ACCEPT.
- Root cause (agent's own diagnosis, confirmed): `boardKeys()` in
  `experiments/quay-perpetual-stream/scripts/routine-file-gate.mjs` (+ vendored plugin copy) indexes the
  candidate file itself.

**Impact:** without the manual `/tmp/` staging workaround, **routines can NEVER file a finding unattended** —
every candidate self-rejects. This defeats DIR-051's whole purpose (standing discovery that files tasks) and
would silently make DIR-052/053/055 routines no-ops. It is the class of bug DIR-052's own DEFAULT-FORM
heuristic warns about: the selfcheck/fixtures pass (explicit candidate path, empty fixture board) while the
real as-wired flow (candidate written into a populated board) is broken.

## Proposal
Fix the gate to be robust regardless of where the candidate lives — the gate-side fix is preferred (doesn't
depend on the caller staging correctly, ADR-004):
- `routine-file-gate.mjs`: **exclude the candidate file itself** from `boardKeys()` (skip the path being
  gated, e.g. by realpath comparison) — so a candidate never dedups against itself even if it sits in
  `--board`; AND/OR
- the skill's routine flow: stage the candidate OUTSIDE `--board` (e.g. `/tmp/`), gate, then move into the
  board only on ACCEPT (make this the documented, single-sourced workflow).
Add a selfcheck fixture that reproduces the as-wired flow: a candidate PHYSICALLY IN a populated `--board`
whose finding is genuinely NOVEL must still ACCEPT (RED today → GREEN after). Re-sync the vendored plugin
copy; bump the plugin.

## Plan
N/A — an in-repo portable-skill + gate fix; proposal-to-plan settles the `boardKeys` self-exclusion (realpath
skip) + the skill's stage-outside-board workflow + a RED→GREEN selfcheck reproducing candidate-in-board with a
novel finding. TDD per ADR-001; fresh-context adversarial audit per DIR-044/048; single-sources the gate.

## Acceptance Criteria
- [x] `routine-file-gate.mjs` `boardKeys()` excludes the candidate file being gated from its own scan (realpath skip); a NOVEL finding whose candidate `.md` physically sits in a populated `--board` still ACCEPTS — a selfcheck reproduces the as-wired flow (RED before, GREEN after).
- [x] The skill's routine flow documents/uses stage-outside-`--board` → gate → move-on-ACCEPT (belt-and-suspenders); vendored plugin copy re-synced + plugin bumped. (Belt-and-suspenders doc is charter-designated NOT a hard requirement; sync + bump done at commit c64e521.)
- [x] Regression: a genuine board-duplicate still REJECTS (dedup not broken by the fix); rate/quality unchanged.

## Definition of Done
References the standard inherited-core DoD clauses; the bar is REAL LANDING, not artifacts:
- [x] Gate self-exclusion fix + selfcheck (RED→GREEN); vendored copy re-synced (ADR-004); TDD per ADR-001; it0 DoD meta-enforcer passes; fresh-context adversarial audit confirms no dedup regression. (Commit c64e521; selfcheck 4/4 PASS; audit session m96-audit-2026-07-22: NO REFUTATION FOUND.)
- [x] A routine files a NOVEL finding through the gate with the candidate in a populated board and NO manual `/tmp/` workaround — **proven by a REAL LIVE FIRE (DIR-026 real object, not only the selfcheck fixture the M103 pass had substituted here):** a tmux-remote-driven (ADR-016) archguard self-validation routine fire (2026-07-22) wrote `quay-tasks/PROBE-INPLACE.md` (a real defect — `CacheManager.getCompositeKey` mutates the caller's array via `files.sort()`, `src/cli/cache/cache-manager.ts:235`, should be `[...files].sort()`) DIRECTLY into the populated board, and `routine-file-gate.mjs` returned **ACCEPT** ("actionable, novel, within rate") — **no `/tmp/` staging**. FILE-only held (`git status` = only the new task). Genuine duplicates still REJECT (M96 selfcheck 4/4).
- [x] Per DIR-026 SPLIT-OR-COMMIT: gate fix + selfcheck + vendored sync + plugin bump landed done (commit c64e521, M96); the real unattended-fire proof landed done via the archguard live fire above (2026-07-22).

## Progress / audit
- 2026-07-22 (M96, `c64e521`) — gate self-exclusion fix: `boardKeys(boardDir, excludePath)` skips the candidate file (realpath) from its own scan; selfcheck 4/4; vendored + plugin bumped; fresh-context audit NO REFUTATION.
- 2026-07-22 — **runtime proof (was outstanding):** the M96/M103 pass had ticked the "real fire" DoD using only the selfcheck FIXTURE (a DoD-weakening — DIR-026 wants a real object). Closed HONESTLY with an actual live fire: **tmux-remote-driven archguard routine fire** filed `PROBE-INPLACE.md` in-board, gate ACCEPT, no `/tmp/`, FILE-only — pasted above. Deployment: the running archguard session's `${CLAUDE_PLUGIN_ROOT}` (0.3.16) gate was hotfixed in place with the fixed script, and the cache was then properly refreshed to 0.3.19 (repo version) + installed_plugins updated, so future sessions get the fix cleanly. Status → `done`.
