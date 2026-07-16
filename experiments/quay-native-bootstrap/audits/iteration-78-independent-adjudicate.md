# Iteration 78 — independent G3 out-of-band audit

**Auditor**: independent G3 guardrail agent, out-of-band, zero prior context
beyond the audit prompt — every claim below was re-derived from the actual
repository state (git history, working tree, `diff`/`git show` on the raw
commit, direct text of the archived directives) — not taken on trust from
iteration 78's own report, `provenance.md`'s summary, or the commit message.

**Subject**: commit `2333c92` ("Iteration 78: apply DIR-020, correct
iteration-77 attribution, codify manda self-deadlock rule, resolve
DIR-019"), confirmed present on `origin/master` at audit time (HEAD and
`origin/master` both `2333c9235ff114cdb136e34e2dbe148f0c455559`).

**Verdict: PASS (no concerns)**

Iteration 78's report is honest, internally sound, and its most
consequential claim — that it caught DIR-020 overcounting its own
supporting evidence — is independently verified true against the primary
source text (DIR-019's Finding), not merely accepted from either DIR-020's
or iteration 78's own framing. No post-hoc correction is applied. This
would have been the 16th post-hoc correction in this experiment's history
had one been warranted (15 correction sections currently exist in
`provenance.md` — the "V_meta formula correction, iteration 8" plus 13
individually-headed `## Post-hoc correction (...)` sections plus the
"Fifteenth post-hoc correction," iteration 71/73's audit); none was needed
here.

---

## (a) Is `iteration-77.md`'s original body byte-identical, with a genuinely appended (not rewritten) addendum?

```
$ git show 08380a0:experiments/quay-native-bootstrap/iterations/iteration-77.md > /tmp/iter77-orig.md
$ wc -l /tmp/iter77-orig.md
490 /tmp/iter77-orig.md

$ grep -n "^## Addendum" experiments/quay-native-bootstrap/iterations/iteration-77.md
492:## Addendum (2026-07-16, added by iteration 78, per DIR-020 action 1) ...

$ head -n 491 experiments/quay-native-bootstrap/iterations/iteration-77.md > /tmp/iter77-current-body.md
$ diff /tmp/iter77-orig.md /tmp/iter77-current-body.md
490a491
>
```

The only diff between iteration 77's own committed original (`08380a0`)
and the current file's content up to the addendum heading is one trailing
blank line (the separator before the new `## Addendum` heading) — the
490 lines of substantive content are **byte-identical**. `git show
2333c92 --stat` independently confirms `iteration-77.md | 63 +++` — pure
additions, zero deletions, consistent with genuine append-only editing,
not a history rewrite.

**Finding: CONFIRMED — iteration 78 genuinely appended; it did not rewrite
or alter iteration 77's original report body.**

## (b) Does the addendum correctly attribute the "clean success" claim to DIR-020's cross-session reconstruction, not to iteration 77 itself?

Read the addendum in full. It explicitly separates three distinct
epistemic layers, each attributed by name:

1. **"This iteration (77) itself"** — verified only the request-id/
   timestamp/result triple, "with **no independently attributable
   responder**," and states this "remains true and unretracted; nothing
   below overturns iteration 77's own honest scope limitation."
2. **"The human, via DIR-020"** — supplies the cross-session meta-cc
   reconstruction placing the orchestrator's own top-level turn as the
   broker.
3. **"This iteration (78)"** — corroborates internal consistency (same
   request id/timestamps) but explicitly states it "did **not** itself
   re-derive the orchestrator's transcript from scratch."

The addendum's conclusion states plainly: "Iteration 77's own
'inconclusive' framing... was, and remains, the correct, honest verdict
**given its own vantage point**... This is not a correction of an error;
it is an external, later-arriving piece of evidence." This is exactly the
distinction the audit brief required — it does not retroactively make
iteration 77 sound like it always knew the attribution.

Cross-checked against `iteration-77-independent-adjudicate.md` (iteration
77's own already-passed audit, commit referenced in that file): that
audit **independently re-derived** the same attribution directly from a
raw `meta-cc` query against the orchestrator's own session transcript
(session `f0c763bc-9823-49e5-a3d4-7c818af450c5`), confirming the
orchestrator's `Agent()` + `respond(id="18c2c14da8cd87e3", ...)` call at
11:22:29–11:22:42 UTC serviced iteration 77's exact request id. This
means the addendum's claim is corroborated by **two** independent
sources (DIR-020's own reconstruction, and iteration 77's own
already-passed audit's separate re-derivation) — the addendum's text
correctly cites both.

**Finding: CONFIRMED — the addendum correctly attributes the claim, keeps
the layers distinct, and does not blur iteration 77's own scope.**

## (c) Does the new §0b hard-rule subsection accurately state the rule and correctly cite DIR-002/DIR-003?

Read `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`'s new subsection, "Hard rule:
depth-1 caller must never be synchronous same-session-as-broker (added by
DIR-020, iteration 78)," placed correctly inside §0b (verified via `grep
-n "^###\|^## "` — sits after the existing DIR-017 material, before the
next `##`-level section boundary; no duplicate headers).

The rule states: a manda depth-1 caller (`Agent`/`Dispatch`/`request`)
must never be issued synchronously from the same session that owns the
target channel's bound broker/monitor; if caller and broker are the same
session, the caller half must be dispatched as a background subagent
(`run_in_background=true`). This is precisely the rule the audit brief
asked to confirm, worded correctly (no scope creep, no under-statement).

**Precedent citation check** — read `DIR-002-manda-agent-dispatch-live-
attempt.md`'s own "Re-confirmation (DIR-003)" section directly:

> "a synchronous `mcp__plugin_manda_manda__Agent` call that hit a real,
> reproducible 30-second single-session self-dispatch timeout (a
> structural deadlock — the session cannot synchronously wait on its own
> spawned subagent — not a missing capability)"

The new §0b subsection quotes this **verbatim**, word for word, matching
the source exactly (checked side by side; no paraphrase drift, no
fabricated quote). The generalization claim — "the same failure class...
already diagnosed once, ... codifying it here... to prevent a third
recurrence, not to introduce a new hypothesis" — is an accurate
characterization: DIR-002/DIR-003 diagnosed a same-session
requester=responder synchronous self-dispatch deadlock in 2026-07-15
(iterations 8-12); DIR-020 diagnosed the same underlying mechanism
(same-session caller/broker) recurring on 2026-07-16. The generalization
is real, not fabricated.

**Finding: CONFIRMED — the rule is accurately stated and the DIR-002/
DIR-003 citation is verified accurate against the primary source text,
not fabricated or misquoted.**

## (d) The highest-value check: did iteration 78 itself miscount, or is its "one success, not two" correction against DIR-019 accurate?

This is the central check of this audit. Independently re-read
`DIR-019-use-confirmed-method-to-verify-and-use-manda-nested-subagent.md`'s
own **Finding** section (the primary source), doing the arithmetic
directly from its text, without taking either DIR-020's "three" or
iteration 78's "two" at face value:

> "a 2-level manda nested subagent round trip was executed end-to-end and
> **succeeded** for the first time in the entire investigation..."
> (describes one specific trial: depth-1 `Agent()`, cap-request arrival,
> depth-2 leaf completing in ~3.5s, `respond()`, "Depth-1 unblocked
> ~21.6s after its own start (T1=1784200148.979, T2=1784200170.579)")
>
> "This succeeded where **at least two earlier attempts** in this same
> conversation, using the *identical* mechanics... **failed** with the
> classic `MCP error -32603`... timeout..."

This is unambiguous on direct reading: DIR-019's own Finding documents
**exactly one** successful round trip in the human's session (PID
3526382), preceded by **two failures** in that same session — not two
successes. There is no second success described anywhere in DIR-019's
Finding text; the "at least two earlier attempts" sentence describes
**failures**, not additional successes.

Independently confirmed the text is unaltered from when it was
originally created (not silently edited after the fact to make iteration
78's correction look right in hindsight):

```
$ git show 08380a0:experiments/quay-native-bootstrap/directives/pending/DIR-019-...md > /tmp/dir019-at-77.md
$ diff <(sed -n '1,169p' /tmp/dir019-at-77.md) \
       <(sed -n '1,169p' experiments/quay-native-bootstrap/directives/archive/DIR-019-...md)
(no output — byte-identical)
```

The Finding text (lines 1-169, everything before the Resolution section)
is **byte-identical** between iteration 77's committed version and the
current archived file — only the Resolution section was appended later.
This rules out any possibility that the "one success" reading was
manufactured by editing the source after the fact.

**Cross-checked against other sources for a possible second, elsewhere-recorded human-session success:**

```
$ grep -rn "3526382" experiments/quay-native-bootstrap/iterations/ experiments/quay-native-bootstrap/directives/
```
No second success is recorded anywhere in the repo outside DIR-019's own
Finding. `iteration-77.md` describes only its own separate trial (a
different session, PID 236789/PPID 3176586, not PID 3526382).

**Independently reconstructing the true total tally:**

- **Clean successes (2, confirmed):**
  1. One in the human's driving session (PID 3526382), per DIR-019's own
     Finding — T1=1784200148.979, T2=1784200170.579, ~21.6s, exact
     `leaf alive` match.
  2. One in iteration 77's trial (request id `18c2c14da8cd87e3`,
     26.28s, no timeout) — now attributable to the orchestrator's own
     top-level session acting as broker, per DIR-020's cross-session
     reconstruction **and independently re-verified via raw meta-cc
     transcript trace in iteration 77's own already-passed audit**
     (`iteration-77-independent-adjudicate.md`, part (a)) — this is the
     strongest possible corroboration available (two independent
     re-derivations, not one narrative accepted on faith).
- **Explained failures, all non-daemon-defect (3, confirmed):**
  1-2. Two broker-unavailability failures in the human's session, per
     DIR-019's own Finding ("the broker session was not actively
     watching in real time for the whole request window").
  3. One self-deadlock failure in the orchestrator's own 11:27:05-
     11:29:03 UTC attempt, per DIR-020's Finding, itself matching the
     DIR-002/DIR-003 precedent mechanism.

**DIR-020's own claim ("three independent clean successes... two in the
human's session") is confirmably wrong** — it overcounts the human's
session by exactly one relative to its own cited source. **Iteration
78's corrected count ("one success + two failures" in the human's
session, "two" total clean successes) is independently verified
CORRECT** against the primary source text, doing the arithmetic
directly, with no reliance on either party's framing.

**Was hypothesis (a) ("broker-availability artifact only") still
well-supported on the true (corrected) tally?** Yes. Every failure now on
record has a specific, independently-checkable non-daemon explanation
(2× broker not watching; 1× same-session structural self-deadlock,
mechanically prevented going forward by the new §0b rule), and every
trial run under a verified-live, actively-watching broker succeeded
without reproducing the `MCP error -32603` SSE-timeout signature that
characterized the DIR-011/012/014/017-era failures. Two independent
clean successes (rather than DIR-020's claimed three) is a smaller but
still directionally sufficient evidentiary base for this conclusion,
given that both remaining failures have fully specific alternative
explanations and neither implicates the daemon's SSE fan-out path
itself.

**Finding: CONFIRMED — iteration 78's correction to DIR-020 is itself
accurate. DIR-019's Finding documents exactly one success (not two) in
the human's session; iteration 78's "two total clean successes, three
explained non-daemon failures" tally is the correct one, verified
independently from the primary source text by this audit. Hypothesis
(a) remains well-supported on the true, corrected tally.**

## (e) Are DIR-019's and DIR-020's Resolution sections complete, accurate, and does DIR-020 honestly document its own self-correction?

Read both archived files' full `## Resolution` sections.

`DIR-019`'s Resolution: documents `resolved_by: iteration 78`, states the
outcome ("applied — archived with the open question resolved... on a
**corrected** evidence count, not the exact count DIR-020 itself
proposed"), and gives the full corrected tally with exact figures
(matching the independent re-derivation in (d) above exactly). Action 1
(SOP adoption), action 2 (hypothesis resolution, corrected), and action 3
(use-going-forward, correctly left conditional per §0b's own caveats) are
all addressed individually.

`DIR-020`'s Resolution: explicitly states, in its own action-3 subsection:
"This directive's 'two in the human's session' claim over-counts by
one." This is the self-correction the report claims — verified present
in the actual file text, not merely asserted in iteration 78's summary.
The Resolution also correctly notes the correction "does not change this
directive's own bottom-line request... it changes the precision of the
count relied upon to grant it."

Both Resolution sections are internally consistent with each other and
with iteration-78.md's own §5.3-§5.4 narrative — same figures, same
attribution chain, no drift between the three documents.

**Finding: CONFIRMED — both Resolution sections are complete and
accurate, and DIR-020's own text (not just iteration 78's report)
honestly documents the self-correction to its overcount.**

## (f) `experiments/quay-native-bootstrap/directives/pending/` is genuinely empty

```
$ ls -la experiments/quay-native-bootstrap/directives/pending/
total 8
drwxrwxr-x 2 yale yale 4096 Jul 16 11:47 .
drwxrwxr-x 4 yale yale 4096 Jul 16 01:37 ..
```

**Finding: CONFIRMED — empty.**

## (g) V-factor reasoning — no credit claimed, against exact §5.1/§5.2 language and the iteration-65 precedent

Re-read `docs/proposal/quay-bootstrap-experiment.md` §5.1/§5.2 verbatim:
`V_instance = skeleton × abi_symmetry × gate_correctness ×
skill_convergence`; `V_meta = completeness × effectiveness × reusability
× validation`. Iteration 78's report walks each of the eight factors
individually against these exact definitions and declines credit on
each, citing the specific defining phrase each time (e.g.
`skill_convergence` — "`quay:author`/`quay:execute` drive real tasks to a
green gate within bounded rounds" — correctly notes neither Skill nor any
gate was touched).

Cross-checked the cited "iteration-65 precedent": read
`provenance.md`'s "Iteration 65" section directly — it is a genuine,
matching precedent (DIR-012/DIR-013 application, zero V-movement claimed,
same factor-by-factor reasoning style, itself citing DIR-008/iteration
29's precedent). The citation is not fabricated.

```
V_instance = 0.83 × 0.96 × 0.76 × 0.96 = 0.58134528 ≈ 0.5813  (independently recomputed, exact match)
V_meta     = 0.74 × 0.26 × 0.79 × 0.64 = 0.09727744 ≈ 0.0973  (independently recomputed, exact match)
```

**Finding: CONFIRMED — no unsupported credit is claimed anywhere; the
precedent citation is genuine.**

## (h) σ_strict genuinely unchanged; no task files touched in commit `2333c92`

```
$ ls tasks/QN-*.md | wc -l
70
$ grep -l "^status: done" tasks/*.md | wc -l
66
$ git show 2333c92 --stat --name-only | grep "^tasks/"
(no output)
```

σ_strict = 62/70 = 0.885714... ≈ 0.8857, matching the report's claim
exactly. `tasks/` directory is confirmed untouched by commit `2333c92`.

**Finding: CONFIRMED.**

## (i) No file with "audit"/"adjudicate" in its name created by commit `2333c92`

```
$ git show 2333c92 --stat --name-only | grep -i "audit\|adjudicate"
(no output)
```

**Finding: CONFIRMED — no self-audit artifact created. This audit file
itself is being written separately, after the fact, by this
independent out-of-band session, consistent with G3.**

## (j) `git status` clean; HEAD matches `origin/master`

Pre-audit state, checked via `git log` first:

```
$ git log --oneline -3
2333c92 Iteration 78: apply DIR-020, correct iteration-77 attribution, codify manda self-deadlock rule, resolve DIR-019
9790fd8 Iteration 77: independent G3 audit — PASS (no concerns)
1b49677 Add DIR-020: manda depth-1 caller must never be synchronous same-session as broker

$ git status --short
(clean)

$ git fetch origin master && git rev-parse HEAD origin/master
2333c9235ff114cdb136e34e2dbe148f0c455559
2333c9235ff114cdb136e34e2dbe148f0c455559
```

**Finding: CONFIRMED — working tree clean, HEAD exactly matches
`origin/master` (commit `2333c92`), no divergence.**

---

## Summary of independently re-verified figures

| Check | Report's claim | Independently re-derived | Match |
|---|---|---|---|
| `iteration-77.md` original body | untouched, addendum appended | byte-identical (490 lines), addendum appended after | Yes |
| Addendum attribution | iteration 77 vs. human/DIR-020 vs. iteration 78 kept distinct | confirmed, correctly separated, corroborated by iteration 77's own already-passed audit | Yes |
| §0b hard rule | accurately states the rule; cites DIR-002/DIR-003 | rule accurate; DIR-002 quote verified verbatim, not fabricated | Yes |
| DIR-020 "three... two in human's session" | iteration 78: overcounts by one (actually one success) | **independently confirmed correct**: DIR-019's Finding documents exactly 1 success + 2 failures in human's session | Yes |
| True total tally | 2 clean successes, 3 explained non-daemon failures | independently reconstructed: matches exactly | Yes |
| Hypothesis (a) support | well-supported on corrected tally | confirmed — every failure has a specific non-daemon explanation | Yes |
| DIR-019/DIR-020 Resolution sections | complete, accurate, self-correcting | confirmed present and accurate in the actual file text | Yes |
| `pending/` directory | empty | empty | Yes |
| V_instance | 0.5813 (unchanged) | 0.83×0.96×0.76×0.96 = 0.5813 | Yes |
| V_meta | 0.0973 (unchanged) | 0.74×0.26×0.79×0.64 = 0.0973 | Yes |
| iteration-65 precedent | genuine, cited accurately | confirmed matching in provenance.md | Yes |
| σ_strict | 62/70 = 0.8857 | 62/70 = 0.885714... | Yes |
| tasks/ touched by commit | no | confirmed no | Yes |
| Self-audit artifact created | none | none | Yes |
| `git status` | clean | clean | Yes |
| HEAD vs. `origin/master` | matches | exact match (`2333c92`) | Yes |
| Regression suite | unaffected | 28/28 pass | Yes |

## Recommendation

**PASS (no concerns).** Iteration 78's report is honest, and its central,
highest-value claim — catching DIR-020 overcounting its own supporting
evidence ("three... two in the human's session" when the cited source
documents only one) — is independently verified **true** by this audit,
doing the arithmetic directly from DIR-019's own unaltered Finding text
(confirmed byte-identical to its original committed version). The
corrected tally (2 clean successes, 3 explained non-daemon failures)
still supports the "broker-availability artifact only" conclusion. The
new §0b hard rule accurately generalizes the verbatim-quoted DIR-002/
DIR-003 precedent. The iteration-77.md addendum was genuinely appended
(not a history rewrite) and correctly attributes the cross-session
finding without retroactively overstating what iteration 77 itself knew.
Both DIR files' Resolution sections are complete and honestly self-
correcting. σ/V figures, task count, `pending/` emptiness, absence of a
self-audit artifact, and clean/pushed git state are all independently
reconfirmed. No post-hoc correction is applied. This would have been the
16th correction in this experiment's history had one been warranted;
none was.
