---
id: gap-arch-discovery-space-instrument-has-no-candidate-universe-on-non-quay-hosts
title: arch_discovery 的 space 仪器在非 quay 宿主上 candidates 恒为 0（候选集是 quay 自己的
  enum-surface 注册表、routine 不传 --registry），却记成 exit:0 干净轮
status: ready
labels:
  - gap
  - architecture-discovery
parent: null
children: []
extra: {}
---
## Proposal
**Measured 2026-10-14 on ClaudeCodeUI, the first non-quay host to run `arch_discovery` (enabled this session; official dist kernel built from develop `4a322afab`).** The first resident round (`.quay/arch-discovery-findings.jsonl`, scan-round ts `2026-10-14T03:33:15.908Z`) produced 45 findings. **All 45 came from the `time` instrument** (suite-red recurrence over ClaudeCodeUI's own fan-in history, 41/45 with an empty `verdict`). The **`space` instrument (the structural one) contributed zero**, and the round records it as a clean run: `instruments.space = {exit:0, wall_ms:79}`.

That zero is not a measurement of ClaudeCodeUI. Running the shipped instrument by hand with the exact argv the routine used:
```
arch-discovery-space.mjs --scan --root /data/home/yale/work/claudecodeui  → cost:{wall_ms:27, git_calls:3, candidates:0}, results:[]
arch-discovery-space.mjs --scan --root /data/home/yale/work/quay          → cost:{wall_ms:3154, git_calls:127, candidates:13}, 13 results (drift-hypothesis/legit-difference/undetermined)
```
`arch-discovery-space.mjs:28-33` explains the gap. In `--scan` mode, candidates come from quay's own `enum-surface-parity-check` registry ("as shipped in this instrument's own checkout"). A foreign tree is scannable only through `--registry <json>`, which "lets a fixture/foreign tree declare its own authorities+surfaces". **`arch-discovery-routine.ts` never passes `--registry`** (zero occurrences in the routine), and its config schema has no key for it. So on every non-quay host the space half is structurally incapable of a finding, and that incapacity is recorded in the same shape as "scanned, nothing found" (硬规则 3b / 4: a reading that cannot be non-zero carries no information and must not look like a pass).

This is Quay-generic, not a ClaudeCodeUI config problem. It applies to every host that is not quay's own repo, including the clean-room acceptance hosts, where `arch_discovery: verified` likewise came from `time` alone.

## Plan
1. **Make the zero honest first.** When the space instrument reports `candidates: 0`, the routine records a distinct, legible state, for example `space: not-evaluated:no-candidate-universe`, carrying the instrument's own `cost.candidates`. It must not fold that into a clean `exit:0` round. This alone is enough to stop the false reading.
2. **Give hosts a declared way in, as data rather than code.** Add an optional `loop.arch_discovery.space_registry: <repo-relative path>` key. When present, the routine passes `--registry <abs path>` to the space instrument. The registry stays a data file in the checker's own registry format. Quay ships no host-specific analyzer, and the host declares only its authorities and surfaces.
3. Do not change the `time` instrument. Do not change `space`'s behavior on quay's own root, where the default candidate set must stay byte-identical.

## Acceptance Criteria
- [x] AC1: on a non-quay fixture root with no registry, the routine's scan-round records space as `not-evaluated` (or equivalent distinct state) with `candidates:0` surfaced, not as a clean exit. Negative control: the pre-fix routine on the same root records `{exit:0}` with no such marker. Both readings pasted.
- [x] AC2: the same fixture root with a minimal `space_registry` declaring one authority+surface that genuinely drifts yields ≥1 real space candidate in the round. A registry declaring a non-drifting pair yields a candidate judged non-drift. This shows the registry is load-bearing in both directions.
- [x] AC3: quay's own root: space candidate set and results are unchanged before/after (count + ids pasted).
- [x] AC4: a malformed `space_registry` path or file fails closed with a legible reason, not a silent zero.
- [x] AC5: `scripts/test.sh --for-task <this task>` green.

## Definition of Done
- AC1-AC5 checked with pasted evidence.
- No host-specific analyzer code is added to Quay or to any host. The only host-side artifact is an optional, declarative registry data file.

## Evidence
All readings were taken in this task's worktree `quay-worktrees/gap-arch-discovery-space-instrument-has-no-candidate-universe-on-non-quay-hosts` (branch `task/gap-arch-discovery-space-instrument-has-no-candidate-universe-on-non-quay-hosts`, off develop `3fb4830c7`).

**Fixture root** (NOT quay) — an independent git repo with THREE commits carrying explicit committer dates, because the instrument's E1 compares commit timestamps:
- `t1` (2026-10-01): authority `plugin/scripts/fixture-auth.ts` = `export const FIXTURE_CODES = ["alpha", "beta"]` **and** the surface `plugin/scripts/fixture-drift.ts` with the same literal;
- `t2` (2026-10-02): the authority gains `"gamma"` ⇒ the surface literal is now a STALE COPY;
- `t3` (2026-10-03): `plugin/scripts/fixture-legit.ts` = the same two values, with `// Intentional subset: gamma is resolved by the runtime fallback.` above it.

**Declared registry** — three lines of data, ONE authority, NO registered surfaces (the two surfaces are DISCOVERED as subset literals):
```json
{"authorities":[{"id":"fixture-codes","file":"plugin/scripts/fixture-auth.ts","symbol":"FIXTURE_CODES","extract":"ts-array"}],"surfaces":[],"knownDrift":[]}
```

### AC1 — `candidates:0` is a not-evaluated state; the pre-fix routine recorded it as a clean exit
Same fixture root, same argv, only the routine MODULE differs (no registry declared):
```
######## PRE-FIX = the develop copy of plugin/scripts/arch-discovery-routine.ts ########
fact.state  = verified
fact.reason = scan ran: 4 finding_fp (4 new, 0 repeated, 0 gone), 0 transition(s), wall 1188ms, peak RSS 119808kB; appended 4 finding + 1 scan-round line to .quay/arch-discovery-findings.jsonl
round.instruments.space = {"instrument":"space","wall_ms":94,"peak_rss_kb":87644,"exit":0,
                           "argv":["node","--experimental-strip-types","--max-old-space-size=512",
                                   "/data/home/yale/work/quay/docs/analysis/arch-discovery-space.mjs",
                                   "--scan","--root","/tmp/ac2-proto-Zw9VEP/fixC","--out","...","--max-ms","60000","--max-records","2000"],
                           "ok":true,"records":0}
   ⛔ exit:0 + ok:true, and NO candidates field / NO state marker: a reading that structurally
      cannot be non-zero, recorded in exactly the shape of a clean round.

######## POST-FIX = this worktree ########
fact.state  = not-evaluated
fact.reason = space not-evaluated:no-candidate-universe (candidates=0; no loop.arch_discovery.space_registry declared ⇒ the space instrument scanned with ITS OWN checkout's registry, which finds nothing outside quay's repo) — the space half is NOT a measurement of this host, so the round is not clean. scan ran: 4 finding_fp (4 new, 0 repeated, 0 gone), 0 transition(s), wall 1195ms, peak RSS 118784kB; appended 4 finding + 1 scan-round line to .quay/arch-discovery-findings.jsonl
round.instruments.space = {"instrument":"space","wall_ms":100,"peak_rss_kb":85496,"exit":0,
                           "argv":["node","--experimental-strip-types","--max-old-space-size=512",
                                   "<this worktree>/docs/analysis/arch-discovery-space.mjs",
                                   "--scan","--root","/tmp/ac2-proto-Zw9VEP/fixD","--out","...","--max-ms","60000","--max-records","2000","--json"],
                           "ok":true,"records":0,"candidates":0,"evaluated":false,"state":"not-evaluated:no-candidate-universe"}
```
The round still APPENDS (the 4 time-side findings are real and are kept) — it is simply no longer reported as clean. A count that cannot be read at all is a THIRD, distinct state (`not-evaluated:candidate-count-unreadable`, recorded `candidates:null`), never a fabricated 0 (硬规则 3b).

### AC2 — the declared registry is load-bearing in BOTH directions
The REAL instrument, run with the routine's exact argv on the fixture root:
```
$ node --experimental-strip-types docs/analysis/arch-discovery-space.mjs --scan --root <fixture> --out <out>          # NO registry (the pre-fix argv)
arch-discovery-space: SCAN rev=f4d83b6c8 candidates=0 git_calls=3 wall_ms=59 e3_mode=import
(no candidate rows)

$ node --experimental-strip-types docs/analysis/arch-discovery-space.mjs --scan --root <fixture> --registry <fixture>/.quay/space-registry.json --out <out>
arch-discovery-space: SCAN rev=f4d83b6c8 candidates=2 git_calls=8 wall_ms=79 e3_mode=import
verdict           post            E1             E2                    E3=fix/name  candidate
drift-hypothesis  persisting      stale          []                    0/0          discovered:plugin/scripts/fixture-drift.ts:1
legit-difference  persisting      authored-after ["gamma"]             0/0          discovered:plugin/scripts/fixture-legit.ts:2
```
Through the ROUTINE, the same root with `space_registry: .quay/space-registry.json` declared:
```
fact.state = verified
round.instruments.space = {"instrument":"space",...,"ok":true,"records":18,"candidates":2,"evaluated":true,"state":"evaluated"}
round.findings = {"new":8,"repeated":0,"gone":0,"total":8}      # vs 4 without the registry ⇒ the space half
                                                                # contributes 4 REAL findings
space  drift-hypothesis  subject_key=enum-surface:fixture-codes|plugin/scripts/fixture-drift.ts#1
space  legit-difference  subject_key=enum-surface:fixture-codes|plugin/scripts/fixture-legit.ts#2
```
⇒ ONE authority+surface pair that genuinely drifts yields a real `drift-hypothesis` candidate; the intentional-subset pair yields a candidate judged NON-drift (`legit-difference`). Without the declared registry NEITHER candidate exists. This is the same pair, both directions.

### AC3 — quay's own root: candidate set and results are unchanged
`docs/analysis/arch-discovery-space.mjs` is UNTOUCHED by this task (no instrument change was needed — `--json` already exposes `cost.candidates`). The only change on quay's own path is that the routine now also passes `--json`, which alters STDOUT only: the `--out` carrier is written identically. Same root, same bounds, the two argvs:
```
BEFORE (no --json): arch-discovery-space: SCAN rev=3fb4830c7 candidates=13 git_calls=127 wall_ms=2822 e3_mode=import
AFTER  (--json)   : cost.candidates = 13
candidate (verdict,id) SETS identical = true ;  order-identical (byte-for-byte as emitted) = true

before candidate count = 13   after candidate count = 13
same  undetermined      start-drivers-kinds
same  drift-hypothesis  claude-md-driver-kind
same  undetermined      drivers-skill-kind
same  undetermined      discovered:packages/quay/src/mcp-handlers.ts:967
same  undetermined      discovered:packages/quay/src/mcp-server.ts:543
same  legit-difference  discovered:packages/quay/src/serve-dashboard.ts:1009
same  undetermined      discovered:packages/quay/src/kernel/task-transition.ts:77
same  undetermined      discovered:packages/quay-native/src/mcp-server.ts:486
same  legit-difference  discovered:plugin/scripts/criterion-failure-attribution-check.ts:105
same  undetermined      discovered:plugin/scripts/crystallization-half-life.ts:594
same  undetermined      discovered:plugin/scripts/dev-stats-collect.ts:196
same  undetermined      discovered:plugin/scripts/routine-file-gate.ts:560
same  undetermined      discovered:plugin/scripts/routine-file-gate.ts:563
```

### AC4 — a malformed `space_registry` fails closed with a legible reason
```
space_registry: .quay/does-not-exist.json
  fact.state  = failed
  fact.reason = FAIL-CLOSED: loop.arch_discovery space_registry '.quay/does-not-exist.json' not found at <abs> (nothing spawned, nothing appended)
  carrier exists? NO ;  spawns = 0

space_registry: .quay/bad.json          (contents: `{ this is not json`)
  fact.state  = failed
  fact.reason = FAIL-CLOSED: loop.arch_discovery space_registry '.quay/bad.json' is not readable JSON — Expected property name or '}' in JSON at position 2 (line 1 column 3) (nothing spawned, nothing appended)
  carrier exists? NO ;  spawns = 0

space_registry: .quay/noauth.json       (contents: {"authorities":[],"surfaces":[],"knownDrift":[]})
  fact.state  = failed
  fact.reason = FAIL-CLOSED: loop.arch_discovery space_registry '.quay/noauth.json' has no 'authorities' array — nothing would be evaluated (nothing spawned, nothing appended)
  carrier exists? NO ;  spawns = 0
```
All three are refused BEFORE any spawn, with the ROUTINE's own reason (not an opaque child exit code carrying a node stack trace).

### AC5 — `scripts/test.sh --for-task <this task>` green
```
$ bash <worktree>/scripts/test.sh --for-task gap-arch-discovery-space-instrument-has-no-candidate-universe-on-non-quay-hosts --allow-thin
EXIT=0
== scoped static checks (change-relevant tier) ==   ... all PASS / NOT-EVALUATED (none RED) ...
ℹ tests 36
ℹ pass 36
ℹ fail 0
```
(That run includes the new `plugin/test/arch-discovery-routine.test.mjs`, now 19 cases: the 14 pre-existing ones — all still green — plus 5 new ones for this task, including the REAL-instrument integration case.)
Anti-drift Touches check (the same one fan-in runs):
```
$ node --no-warnings --experimental-strip-types plugin/scripts/anti-drift-touches-check.ts --task <this task> --worktree <worktree> --merge-target develop
ANTI-DRIFT OK: task gap-arch-discovery-space-instrument-has-no-candidate-universe-on-non-quay-hosts — 2 actual file(s), all within declared Touches (4 glob(s))
```

### What was NOT changed, and why the cross-module contract is nevertheless pinned
- `docs/analysis/arch-discovery-space.mjs` — UNTOUCHED. It already exposed the candidate universe through its documented `--json` mode; adding an instrument-side flag would have been new surface for no gain.
- The `time` instrument — UNTOUCHED (it has no candidate universe, and the routine neither passes `--json` nor `--registry` to it).
- No host-specific analyzer ships in Quay; the only host-side artifact is the optional declarative registry DATA file.
- The routine↔instrument contract (`--json` ⇒ `cost.candidates`) is pinned END-TO-END by the new integration test `case (10) — REAL instruments on a non-quay root`, which reads `candidates: 2` out of the real instrument's stdout. If the instrument's report shape ever moves, that test goes red.

## Touches
- tasks/gap-arch-discovery-space-instrument-has-no-candidate-universe-on-non-quay-hosts.md
- plugin/scripts/arch-discovery-routine.ts
- docs/analysis/arch-discovery-space.mjs
- plugin/test/arch-discovery-routine.test.mjs
