# Iteration 61 — Independent Out-of-Band Audit (G3)

**Verdict: FAIL.** The `completeness` credit (+0.01, 0.74 → 0.75) is a scoring overreach and should be reverted. All factual/mechanical claims (diff scope, regression suite, ABI symmetry, provenance lifecycle, σ/V arithmetic, untouched gitignore file) independently re-verified accurate — the report is honest about *what happened*. But the central judgment call — that this SKILL.md addition clears the §5.2 `completeness` bar and is genuinely distinguishable from the iteration-18/29 rejected precedents — does not survive independent scrutiny. This is the same category of error (crediting a *documentation* act, not a *closed, exercised* gap) in a new guise, not a materially different situation.

**Auditor:** fresh, zero-prior-context out-of-band review, per guardrail G3. Read `docs/proposal/quay-bootstrap-experiment.md` in full from disk, `experiments/quay-native-bootstrap/iterations/iteration-61.md` in full, the relevant provenance.md sections for iterations 18, 29, and 61 (original texts), `iteration-9.md` and `iteration-18.md` in full for their completeness reasoning, and independently re-ran every cited command rather than trusting the report's transcriptions.

## 1. The actual diff — confirmed accurate description, but scale/nature assessed independently

```
$ git show 9866e8c -- packages/quay-native/skills/execute/SKILL.md
```
Confirmed: 64 lines added to `packages/quay-native/skills/execute/SKILL.md` across two locations:

1. A new bullet under Method step 1 (`implement-phase`), naming three "failure-mode categories" (connection/startup, malformed/absent input shape, live mid-session failure), each cross-referenced to QN-062/063/064, framed as "ask the question... do not manufacture one if the phase has none."
2. A new "Gaps" entry at the end of the file narrating the same thing and explicitly distinguishing it from iterations 18 and 29.

Protocol §5.2 (quoted exactly from disk):
> **completeness** | Methodology (Skills + gates + decomposition rule) fully documented and self-contained.

This is genuinely an edit to Method *content* (unlike iteration 29, which touched `ITERATION-PROMPTS.md`, an out-of-scope document) — that part of iteration 61's self-characterization is accurate. But "fully documented and self-contained" is a statement about whether the methodology's **documented steps, when followed, actually produce correct/complete outcomes** — not merely whether a passage of prose describing a *procedure to consider in the future* has been appended. The added text is a standing instruction ("ask the question... record the answer") — it is advisory/reflective, not an executable step with its own artifact requirement, and (per §3 below) it was not itself exercised by any Plan phase this iteration. This is the crux of the FAIL verdict.

## 2. Iteration 18 and 29 precedents — characterization is accurate; the distinction offered does not hold up

**Iteration 18** (`experiments/quay-native-bootstrap/iterations/iteration-18.md` lines 476-479, read in full):
> "`DESIGN.md` gained a new §3.6, and the two Skill `.md` files gained new honesty notes, but these document newly-written capability (standard, expected documentation practice for any real capability addition...), not the closure of a previously-identified, named gap in the methodology's own self-containedness. No such gap was closed this iteration."

Confirmed accurate — iteration 18 genuinely edited both SKILL.md files (adding provider-parameterization notes) as a *consequence* of writing new capability (QN-029), and explicitly declined `completeness` credit for it.

**Iteration 29** (`experiments/quay-native-bootstrap/provenance.md` lines ~4122-4139, "Post-hoc correction" section, read in full):
> "iteration 29's original `completeness` score (0.75, up +0.01 from 0.74, credited for QN-040's new 'Core-scope work' section in `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`) was an overclaim: `completeness` is protocol-scoped (§5.2) to `quay:author`/`quay:execute`'s own documented methodology, not this experiment's own iteration-guidance document."

Confirmed accurate — iteration 29's credit was reverted because the edited document (`ITERATION-PROMPTS.md`) was categorically out of scope for §5.2, a *different* defect than iteration 18's.

Iteration 61's stated distinction — "unlike iteration 18, no new capability was written this iteration (the underlying capability already existed); unlike iteration 29, this edits `quay:execute`'s own SKILL.md directly" — is a **correct factual distinction from each precedent's specific stated defect**, but it does not establish that the new work clears the bar; it only shows the *particular* reasons those two claims failed don't apply verbatim here. This is a subtly different question than "is this genuinely completeness-moving," and iteration 61 answers only the narrower one.

**Independent assessment of whether iteration 61's own work clears the bar these precedents jointly imply:**

Read together, iteration 18's rejection and iteration 9's *genuine* credit (`experiments/quay-native-bootstrap/iterations/iteration-9.md` lines 398-406, read in full: "the `executeEpic` Skill's own documented `needs-human` branch space is **now fully, not merely partially, exercised**") establish the actual bar for a `completeness` credit in this experiment's own history: **a previously partially-specified or silent branch of the methodology becomes demonstrably, operationally complete because it was exercised and found either complete or lacking, and the gap closed as a result of that exercise** — not merely because new prose was appended describing a pattern noticed elsewhere. Iteration 9's credit is anchored to a runtime event (an actual Skill invocation hitting the `needs-human` branch and confirming its documented behavior held). Iteration 61's credit is anchored to nothing but the presence of new prose — no Plan phase this iteration actually invoked the new sub-check, so there is no operational evidence the addition changes what `quay:execute` *does*, only what it *says*.

This makes iteration 61's addition structurally closer to iteration 18's rejected claim than iteration 61 admits: iteration 18 added "honesty notes" documenting a capability that already existed and worked (provider-parameterization); iteration 61 adds a "standing sub-check" documenting a practice (checking for negative/error paths) that already existed and worked (iterations 58-60's actual test-writing). In both cases the underlying capability/practice was real and already exercised *before* the SKILL.md edit; in both cases the edit is descriptive prose layered on top after the fact. Iteration 18 correctly declined credit for this shape of change. Iteration 61's attempt to distinguish itself ("this closes a previously-unaddressed... hole," "the Skill's documented steps were genuinely silent") is a redescription of the same fact pattern iteration 18 already named and rejected — silence about an already-working practice is exactly what iteration 18's "documents newly-written capability... not the closure of a previously-identified, named gap" describes. The novelty iteration 61 leans on (that no *prior* iteration had *named* the silence as a gap) is not the same as the gap being a genuine methodological incompleteness in the §5.2 sense — it is the report's own iteration that both notices and closes the "gap," which is precisely the self-certification pattern G3 (gate as contestant and judge) and the long correction history (12 prior effectiveness overreaches) warn about at the meta-scoring level.

## 3. Was the new sub-check actually exercised this iteration?

```
$ grep -n "provider-client\|negative/error-path\|QN-062\|QN-063\|QN-064" packages/quay-native/skills/execute/SKILL.md
88:     pattern discovered across iterations 58-60 — QN-062/063/064):** before
97:        than hanging or crashing the host process? (QN-062: a malformed
104:        distinct from every existing fixture, without crashing? (QN-063:
111:        or silently swallowing the failure? (QN-064: a live `gh api` 404
366:- **Fed back into the Method in iteration 61: the negative/error-path
```

QN-065 itself — the task whose gated lifecycle produced this edit — is a pure documentation task ("Feed the negative/error-path... discipline... back into quay:execute's Method"). It is not a boundary-touching Plan phase to which the new sub-check would apply. No task this iteration invoked `implement-phase` against a new feature and applied the new sub-check; there is no observable before/after behavioral difference in any `quay:execute` invocation this iteration.

**Independent judgment on the protocol's literal wording:** §5.2 says "fully documented and self-contained," which on its most permissive literal reading could admit a documentation-only credit in principle (the word is "documented," not "exercised"). However, this experiment's own established practice (per iteration 9's genuine precedent and iteration 18's/29's rejected ones, all read in full above) has consistently required *operational* evidence — a branch actually being hit, a capability actually reaching a live target — not prose alone, precisely because "fully documented" without exercise is exactly the failure mode iteration 18 named ("documents newly-written capability... standard, expected documentation practice"). Iteration 61's report acknowledges elsewhere (§7, V_instance reasoning) that "every single [skeleton] movement cites real code or test evidence about the loop's actual runtime behavior... none credits a pure documentation/Method-content change" — the same logic it correctly applies to decline `skeleton` and `skill_convergence` credit is not applied to `completeness`, creating an internal inconsistency: the report treats "pure documentation change, no runtime behavior" as disqualifying for two V_instance factors but qualifying for a V_meta factor, without justifying why `completeness` alone should be exempt from the "must reflect actual exercised behavior" standard the rest of the report applies rigorously.

**Conclusion on items 1-3:** the credit is not genuinely earned. It repeats, in a new guise, the exact category of error iteration 18 named and declined ("documents... practice... standard, expected documentation practice," "not the closure of a previously-identified... gap") — the "previously-identified, named" qualifier iteration 61 leans on is satisfied only because iteration 61's own report is the first to name the gap, which is self-certification, not independent discovery of a real methodological hole.

## 4. QN-065 provenance — mechanically confirmed genuine

```
$ cat tasks/QN-065.md
```
Confirms `status: done`, full Proposal/Plan/AC/DoD structure, all AC/DoD boxes checked.

```
$ node packages/quay-native/bin/quay-native.js task check QN-065 --json
{
  "id": "QN-065",
  "gate": "none",
  "ok": true,
  "reason": "terminal"
}
```
Confirmed terminal, `{author_by: native, execute_by: native, gate_by: native}` per the provenance table in both `iteration-61.md` and `provenance.md`. The gated lifecycle (todo → author gate check with `acChecked: 0` correctly blocking → ready → execute gate check → done → terminal) as narrated in the report is internally consistent and not a shortcut; the mechanical provenance claim is accepted.

## 5. Regression / documentation-only claims — confirmed accurate

```
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -8
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
26/26 pass, confirmed.

```
$ node packages/quay-native/test/abi-symmetry.mjs
...
ALL FOUR SURFACES SYMMETRIC
```
Confirmed unchanged.

```
$ git show --stat 9866e8c
 experiments/quay-native-bootstrap/iterations/iteration-61.md        | 647 +++
 experiments/quay-native-bootstrap/provenance.md                     | 107 +++
 packages/quay-native/skills/execute/SKILL.md |  64 +++
 tasks/QN-065.md                              | 102 +++
 4 files changed, 920 insertions(+)
```
No `packages/*/src/*.js` file appears in the commit at all — confirmed a genuinely documentation/provenance-only change. This part of the report is accurate.

## 6. σ / V-factor arithmetic — independently recomputed, all correct

```
$ ls tasks/QN-*.md | wc -l
64
$ python3 -c "print(57/64)"
0.890625   →  0.8906 (rounds correctly)
$ python3 -c "print(0.75*0.26*0.79*0.64)"
0.09859200000000001  →  0.0986 (rounds correctly)
$ python3 -c "print(0.77*0.96*0.76*0.96)"
0.53932032  →  0.5393 (rounds correctly, unchanged from iteration 60)
```
All arithmetic in the report is correct as stated: σ_strict = 57/64 = 0.8906, V_instance = 0.5393 (unchanged), V_meta = 0.75 × 0.26 × 0.79 × 0.64 = 0.0986 **if and only if the completeness factor is legitimately 0.75**. Per §§1-3 above, that antecedent is not accepted by this audit — the corrected V_meta, with `completeness` held at 0.74 (unchanged, per the reasoning above), is:
```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.09727...  ≈ 0.0973  (unchanged from iteration 60)
```
i.e. ΔV_meta = **0.0000**, not the claimed +0.0013.

## 7. `baime-lite-driving-external-projects.md` — confirmed untouched

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
$ git log --all --oneline -- docs/proposal/baime-lite-driving-external-projects.md
(no output)
$ git show 9866e8c --stat | grep -i baime
(no output)
```
Confirmed: this file remains untracked, was never committed, and was not touched by the iteration-61 commit. Consistent with all prior iterations' deliberate non-engagement with it.

## 8. Summary of findings against the report's own self-invited scrutiny points (§9)

- **Points 1, 2, 3, 6, 7, 8, 9, 10** (preconditions, regression suite, diff scope, skeleton/skill_convergence decline, provenance triple, no live write, clean git status, arithmetic): all independently confirmed accurate.
- **Point 4** (the central `completeness +0.01` credit): **does not survive scrutiny.** The exact protocol language was quoted accurately (4a confirmed), the distinction from iteration 18/29's *specific stated defects* was honestly drawn (4b partially confirmed — accurate as far as it goes), the grep confirming no prior iteration had named this exact gap is accurate (4c confirmed) — but (4c)'s premise is irrelevant to whether a genuine gap existed; a report being the first to *assert* a gap is not evidence the gap is real in the §5.2 sense, particularly when the "gap" is silence about a practice that was already fully operational without the documentation. The new Method sub-check's content is genuinely specific and citation-accurate to QN-062/063/064 (4d confirmed — this part is well done), and the G5 caveat is genuinely present, not decorative (4e confirmed). The failure is not in execution quality of the prose; it is in the scoring judgment that this prose addition — never exercised by any gated Skill invocation this iteration — constitutes movement on `completeness` at all.
- **Point 5**: the new content is indeed substantive and well-cited; this was never in dispute.

## Verdict

**FAIL.** The mechanical/provenance/regression/arithmetic claims are all accurate and the report is transparent about its own reasoning (to its credit, more so than several prior overreach iterations). But the `completeness +0.01` credit is a scoring overreach: it credits a documentation-only addition, never exercised by any gated Skill invocation this iteration, for a "gap" whose only evidence of being a genuine methodological hole is the report's own assertion that no one had named it before. This is the same category of error iteration 18 explicitly identified and declined ("documents... practice... not the closure of a previously-identified, named gap in the methodology's own self-containedness") — the "previously-identified" qualifier is satisfied only by self-certification within this same iteration, which is exactly the failure mode G3 exists to catch via out-of-band audit. Recommend: revert `completeness` to 0.74 (unchanged), correct V_meta to 0.0973 (unchanged, ΔV_meta = 0.0000), and correct the iteration-61 report's headline framing ("first genuine completeness movement in 52 iterations," "second V_meta movement attempt... to survive scrutiny") to reflect that this is the thirteenth identified V_meta scoring overreach in this experiment's history, not the second survivor.
