# M175 (DIR-114) — iteration 0 acceptance audit (round 5)

**Audit session id:** 006748f4-b16e-4522-a7a6-68b595240e42

**Verdict: REFUTED**

Fresh-context adversarial audit of DIR-114 (M175 — args-normalization defense for the 5
checked-in `.claude/workflows/*.js` dynamic workflow scripts). Refute-first stance: every claim
below is checked against a concrete artifact (`grep`/`node --check`/`git show`, a real `wf_*.json`
record independently parsed with `python3 json.load()` — not `grep`, per a documented
string-vs-object trap — or a mechanical script's exit code), never the implementer's self-report
alone. This is the 5th audit pass recorded on this task (`tasks/DIR-114.md` carries rounds 1-4
inline plus 3 rounds of orchestrator-dispatched "Post-audit real evidence" notes); this pass
independently re-derives the verdict from scratch, then checks whether anything changed since
round 4.

## AC satisfaction

### AC1 — all 5 checked-in scripts contain the `$a` normalization, zero raw `args.` refs

**CONFIRMED.** Ran `grep -n 'args\.' <file>` directly against all 5 checked-in files
(`.claude/workflows/{execute-milestone,drain-directives,diagnose-verify-failure,run-routines,
select-preflight}.js`): zero matches in every file (the normalization line itself,
`const $a = (typeof args === 'string') ? JSON.parse(args) : args`, contains no `args.` substring,
so it doesn't self-match). `node --check` passes on all 5. Already ticked `[x]` in the task file
with citation from a prior audit round; independently re-confirmed here.

### AC2 — real `Workflow()` calls, both object-args and string-args forms, both scripts

**REFUTED (unconfirmed).** Since the task's own round-4 audit, 5 additional real, non-fixture
`execute-milestone.js` dispatches occurred in this session for M177/M178/M179/M180/M181
(`wf_bc179c02-707`, `wf_59693e85-7a9`, `wf_62bfa294-3ad`, `wf_d8c1682e-42b`, `wf_efb9b02d-68c`,
`wf_3c72a4b8-2ac`, `wf_a455e08f-70d`, `wf_e4e93e30-717`) — all `status:"completed"`, zero crashes,
genuine production use of the fixed script across 5 different milestones. This is strong new
operational evidence the fix works in practice. **But** checking every one of these plus the 2
round-4 previously-cited artifacts (`wf_789e895c-d3f` for `drain-directives.js`, `wf_558bd42f-ac5`
for `execute-milestone.js`) via `python3 -c "import json; type(json.load(open(f))['args'])"` (not
`grep`, which round 4 documented as a trap — a JSON string whose *content* looks like an object can
fool a naive grep) shows **every single one is string-typed**, never once object-typed, across all
14 `wf_*.json` records now on disk touching either script. AC2's literal text
("分别用『args 是对象』和『args 是 JSON 字符串』两种形态触发") requires demonstrating BOTH forms
crash-free for both named scripts. The string-args half is solidly closed; the object-args half
remains genuinely unconfirmed for either script — not merely under-documented, but never actually
observed in any artifact this or the prior 4 audit rounds could find.

### AC3 — one real `/loop` cold start (DRAIN → SELECT → execute-milestone) free of the crash class

**REFUTED (unconfirmed).** All available post-fix evidence consists of separate, ad-hoc
`Workflow()` dispatches (mostly orchestrator-issued via `scriptPath:`), not one single documented
artifact of the full DRAIN → SELECT → execute-milestone chain run as one cold start. The real
`/loop` cold-start that originally dispatched THIS milestone (`wf_ed780e0e-497`) crashed with
exactly the target error (`args.charterFile.match` on `undefined`) — i.e. the crash DID occur on a
genuine cold-start path, timestamped before the fix landed. No later artifact supersedes this with
a clean full-chain cold start captured as a single record.

## Mechanical gate

Ran `bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-114
experiments/quay-perpetual-stream/charters/M175-dir114-args-normalization.md
/tmp/m175-absorb-entry.md` twice this pass:

1. **Before** appending disposition text: exit 1, failures on `clause0-ac-dod-present` (2 unchecked
   AC items), `clause1-adversarial-audit` (no disposition statement), `clause2-vmeta-lag` (no
   disposition statement).
2. Appended real (not fabricated) disposition text to `/tmp/m175-absorb-entry.md`: an
   `adversarial-audit disposition: REFUTED` line reflecting this pass's own just-reached verdict,
   plus a `V_meta consolidation-lag` line quoting the verbatim output of `bash
   experiments/quay-perpetual-stream/scripts/vmeta-lag-check.sh --counter 182
   experiments/quay-perpetual-stream/v-meta-ledger.md` (`milestone_counter` read live from
   `dashboard.md` line 4, `183`, minus 1 = `182`) — verbatim: `"PASS: no confirmed-unconsolidated
   row past K without a dated carry-forward"` (milestone_counter=182, K=2, both ledger rows `[ok]`).
3. **After** appending: exit 1, clause1/clause2 now PASS, **sole remaining failure:
   `clause0-ac-dod-present`** — genuinely 2 unchecked AC items (AC2, AC3), not fabricated, not a
   template artifact. **Non-zero exit → REFUTED by construction**, per this audit's own charge.

## Definition of Done

- DoD1 (real commit on `master`, not a session-private copy) — **CONFIRMED**: `git show --stat
  f663857` shows the 5 `.claude/workflows/*.js` files (+3 `plugin/workflows/*.js` mirrors) changed
  in commit `f663857df92da46b2f334c9fc4e058d7449acb39` on `master`; `git merge-base
  --is-ancestor f663857 HEAD` confirms ancestry of current `HEAD` (`5e59efa`).
- DoD2 (normalization verified crash-free in both args-delivery forms by a real workflow call) —
  **REFUTED**, mirrors AC2 above.
- DoD3 (human-steered discipline: halt/no self-SELECT) — **CONFIRMED**:
  `experiments/quay-perpetual-stream/.halt` exists, predates the M175 charter and build dispatch;
  `label: human-steered` present on DIR-114's own frontmatter.

## Checklist write-back (DIR-020)

No new AC/DoD checkbox states changed — AC1/DoD1/DoD3 were already ticked `[x]` with citations from
prior audit rounds (independently reconfirmed, not re-ticked to avoid duplicate citations); AC2, AC3,
DoD2 remain `[ ]` unticked, correctly, per this round's independent re-confirmation. Added an
"Independent audit, round 5" section to `tasks/DIR-114.md`, preserving the entire prior body
verbatim (purely additive).

## Deviation-log write-back (DIR-017 Step 3)

Appended 2 rows to `dashboard.md`'s Homeostatic variables (DIR-017 Step 3) table:

1. `caught-by: machine` — this pass's own fresh re-confirmation (the 5 new post-round-4 dispatches,
   all string-typed-only, mechanical gate exit 1 on clause0 alone after real disposition text was
   supplied).
2. `caught-by: human` — transcribing (not originating) `milestones/M175/iterations/iteration-1.md`'s
   own "Known open gap" disclosure: the object-args gap may be structurally unclosable via
   `wf_*.json` metadata inspection (the field appears to be a storage-layer serialization, not a
   reliable signal of the script's own observed `typeof args`), and Build-phase subagents in this
   pipeline have no `Workflow` tool (reconfirmed across 3 consecutive milestones), so closing this
   requires an orchestrator-level in-script `typeof`-probe dispatch, not another Build attempt.

Both rows carry `status: open`, `age: 0`, `caught-at: M175`.

## Overall verdict: REFUTED

Same substantive conclusion as round 4, independently re-derived with additional post-round-4
evidence. The code fix itself (AC1/DoD1/DoD3) is real, complete, on `master`, and genuinely done.
AC2/AC3/DoD2 remain genuinely open — not a documentation gap, a real unmet requirement — and the
mechanical gate hard-fails (exit 1) on exactly those 2 unchecked AC items even after supplying real,
non-fabricated clause1/clause2 disposition text. **Recommend NOT marking DIR-114 `status: done`**
until either (a) an orchestrator-level in-script `typeof args` probe demonstrates the object-args
form for at least one of the two named scripts, and/or (b) a single documented full
DRAIN→SELECT→execute-milestone cold-start artifact is captured, or (c) the task's own AC2/AC3 text
is deliberately relaxed (by a human, via `quay-directive` steering) to match what the charter's
looser Done-when wording already accepts — a decision this audit does not make unilaterally.
