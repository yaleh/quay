# DIR-008

- status: applied
- created_by: human (Yale), asserted directly in this live conversation
- created_at: 2026-07-15
- title: Codify Core-scope verification constraints into `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`

## Finding

DIR-006 (quay-github compound/epic support) and DIR-007 (Core MCP server)
were both narrow, single-finding/single-action directives, and both were
applied and passed independent audit. Work is now increasingly touching
`packages/quay` (the Core) — QN-036's Core MCP server, plus the pre-existing
Web UI/action-trigger surface (`serve.js`, `action.js`) already exercised by
QN-027/QN-031/QN-033.

A conversation between the human and an out-of-band Claude Code session
(recorded in `docs/proposal/quay-core-scope-expansion-discussion.md`,
present and readable at the start of whichever iteration processes this
directive) worked through what verifying Core-level behavior rigorously
would require, and identified constraints that are **not** scoped to any
single implementation task — they should govern *every* future
iteration that touches Core, the same way G1-G6 already govern every
iteration regardless of task. Baking these into a one-off task-level
directive (the DIR-006/DIR-007 pattern) would mean re-deriving or
re-stating them from scratch in every future Core-related directive. The
discussion document itself, in its own §3.4, already names this
distinction: it explicitly recommends that general, standing constraints
belong in `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` (the artifact
`baime:iteration-prompt-designer` maintains), not in another
single-purpose directive file.

The four constraints, each already reasoned through in
`docs/proposal/quay-core-scope-expansion-discussion.md`, are:

1. **Terminology discipline (§2.1).** This project's glossary
   (`docs/proposal/glossary.md`) freezes "MCP" to mean specifically the
   Provider ABI transport (`quay-native mcp`, `quay-github mcp`,
   `quay mcp`). Browser-automation tooling available to a Claude Code
   session (chrome-devtools / playwright MCP servers) is an unrelated
   mechanism that happens to share the protocol name. Any iteration
   prompt or task body touching both must keep them unambiguous — e.g.
   "browser-automation tooling (chrome-devtools / playwright MCP)", never
   bare "MCP testing" — especially now that a real Core-level `quay mcp`
   exists (QN-036) alongside it.
2. **G5 discipline for Web UI verification (§2.1).** `packages/quay/src/
   serve.js`'s own header states the Web UI is deliberately "crude but
   real... no framework, no styling beyond what's needed to prove the
   loop." Any browser-driven or other Web UI verification work must stay
   scoped to confirming *existing* behavior (list renders, detail
   renders, action-button POST fires) and must not become a pretext for
   improving the UI's appearance or interactivity before the skeleton's
   functional loop is otherwise complete — per G5's own warning that "the
   bootstrap ambition amplifies" the gold-plating temptation.
3. **manda-investigation reuse discipline (§2.3).** Iterations 13-18
   already spent substantial effort establishing that: the async
   `Dispatch` queue primitive works but nothing reliably claims tasks
   submitted to it; a genuine synchronous `Agent` fresh-context spawn
   times out (reproduced 5/5 as of iteration 15); and even a
   correctly-targeted dispatch to a session's own monitor channel
   produces no execution unless a live process is actually watching that
   monitor's output (DIR-005's finding, iteration 18). Any future prompt
   involving action-delivery verification must explicitly instruct: do
   not re-discover these findings from scratch — cite and build on
   `experiments/quay-native-bootstrap/directives/archive/DIR-004-*.md` and
   `experiments/quay-native-bootstrap/directives/archive/DIR-005-*.md` directly — and must not
   make an automated test's pass/fail hinge on live manda delivery
   succeeding, since that has been repeatedly shown to be a per-session,
   per-moment fact, not a reliably available one.
4. **Resolution path for the two open scope/attribution questions
   (discussion doc §4).** The discussion document leaves two questions
   explicitly unresolved: (a) whether extending verification to Core
   requires a formal protocol decision via
   `docs/proposal/quay-bootstrap-experiment.md` §10's resolved-decisions
   process, or is already within the existing instance objective's scope
   since `packages/quay` is already part of the v0 skeleton; and (b)
   which V_instance/V_meta factor(s) should credit Core-level three-way
   symmetry work and action-delivery mock verification, so as to avoid
   repeating the extended `effectiveness`-attribution debate seen in
   iterations 21-24. `ITERATION-PROMPTS.md` should state which path
   governs future Core-scope work, even if the answer is "resolve via
   §10 before the first Core-scope implementation task begins."

## Requested action

A future iteration should revise `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` itself
— using this experiment's own methodology (i.e. invoke or apply the
`baime:iteration-prompt-designer` agent/capability from *inside* the
iteration, the same way the experiment already produces its own other
artifacts) — to durably encode the four constraints above as standing
guidance for all future Core-scope work, not as a one-off task. This
directive intentionally does **not** revise `ITERATION-PROMPTS.md`
directly (from outside the experiment) — doing so would bypass the
experiment's own authorship/provenance discipline
(`author_by`/`execute_by`/`gate_by` in `experiments/quay-native-bootstrap/provenance.md`), the
same reason DIR-006/DIR-007 requested implementation work rather than
supplying a patch to apply verbatim.

Concretely, the iteration that processes this directive should:

1. Read `docs/proposal/quay-core-scope-expansion-discussion.md` in full
   (already present in the repo) as the source material — do not
   re-derive the four constraints from scratch, and do not silently
   narrow or drop any of them without recording an explicit reasoned
   decision.
2. Add a new section to `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` (naming and
   placement at the executing iteration's discretion, consistent with the
   file's existing structure) stating the four constraints as standing
   guardrails for any task that touches `packages/quay` (Core) —
   terminology discipline, G5 Web UI scope, manda-reuse discipline, and
   the resolution path chosen for the two open scope/attribution
   questions.
3. For constraint 4 specifically, make and record an explicit decision
   (not merely restate the question): either (a) resolve it directly per
   `quay-bootstrap-experiment.md` §10's process within this same
   iteration, or (b) explicitly decide "Core is already in scope, no §10
   resolution needed" with reasoning, or (c) explicitly decide "defer
   Core-scope implementation work until a dedicated future iteration
   resolves this," with reasoning — and update `experiments/quay-native-bootstrap/README.md` §1
   if the resolution changes the stated instance objective scope.
4. Record this task's provenance in `experiments/quay-native-bootstrap/provenance.md`, and note
   in the iteration report which V_instance/V_meta factor (if any) this
   protocol/prompt-authoring work itself counts toward (it is
   process/methodology work, not a feature — do not force it into
   `skeleton` or another feature-shaped factor if it doesn't genuinely
   fit; recording "does not move any factor, this is meta-level prompt
   maintenance" is an acceptable and honest outcome if that's what the
   evidence supports).
5. This directive does not itself request implementing any of the three
   original proposals (browser-automation Web UI verification, Core
   CLI/MCP/Web-UI three-way symmetry, mock/log-file action-delivery mode)
   — those remain separate, future, narrower directives to be issued only
   after this one lands, each able to reference the now-codified
   constraints instead of re-deriving them.

## Resolution

- resolved_by: iteration 29 (QN-040)
- outcome: applied
- evidence: `experiments/quay-native-bootstrap/ITERATION-PROMPTS.md`'s new "§Core-scope work:
  standing constraints for any task touching `packages/quay`" section
  (inserted after "§Stage 2+: When GitHub-Provider-building iterations
  begin") states all four constraints verbatim from the source discussion
  document, none dropped or narrowed. Constraint 4's two open
  sub-questions are both given explicit, reasoned decisions inline:
  (a) Core is already in scope, no protocol §10 resolution needed --
  `experiments/quay-native-bootstrap/README.md` §1 is left unchanged, with reasoning recorded
  that its existing text already covers `packages/quay` via the v0
  walking skeleton dependency; (b) Core-level three-way symmetry work and
  action-delivery mock-verification work are credited to the same
  existing factors that already credit analogous Provider-level work
  (`skeleton`/`abi_symmetry`/`gate_correctness` as applicable), explicitly
  not `effectiveness` and explicitly not a new fifth factor. See
  `experiments/quay-native-bootstrap/iterations/iteration-29.md` §5/§7/§8 for the full reasoning
  and this task's own V-factor scoring (this directive-processing work
  itself is process/methodology-maintenance, analyzed on its own merits,
  not forced into a feature-shaped factor).

  DIR-008 appeared in `pending/` mid-iteration-29 (committed
  `c0829d5`, 2026-07-15T14:39:48Z), after iteration 29's own mandatory
  first-step `ls experiments/quay-native-bootstrap/directives/pending/` check (which correctly
  found it empty at that moment) but before the iteration's work
  concluded -- processed as a second unit of work within the same
  iteration rather than deferred to iteration 30, since it was fully
  specified, tractable, and self-contained.
