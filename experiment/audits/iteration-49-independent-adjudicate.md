# Iteration 49 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full (from disk, gitignored,
233 lines), `experiment/iterations/iteration-49.md` in full, and the tail
of `experiment/provenance.md` (the full "Iteration 49" section). Did not
trust the report's narration — independently re-ran every cited command
against the live working tree and the live GitHub/manda substrates, and
read the actual source files the report cites rather than accepting its
paraphrase.

**Verdict: PASS** — every headline claim, including both of the newly
mandated investigations (a: GitHub issues #3/#4 re-attempt, b: manda
dispatch-primitive probe), is independently verified accurate and
reproducible. Iteration 49 extends the clean-PASS streak (37-48) to
**thirteen** consecutive iterations.

## Findings

1. **Protocol and iteration report — read in full, correctly cross-referenced.**
   `docs/proposal/quay-bootstrap-experiment.md` (§5.1/§5.2 value-function
   definitions, §10 resolved decisions) and `experiment/iterations/
   iteration-49.md` (all 10 sections) were read directly from disk. The
   report's own framing — that iteration 48's audit mandated concrete
   pursuit of (a) issues #3/#4 and (b) the dispatch-primitive question,
   rather than another abstract "nothing to do" finding — is accurately
   represented and both items were genuinely pursued with live commands,
   not re-cited from memory.

2. **Mandate (a), issue #4 — gate failure reproduced exactly.** Independently ran:
   ```
   $ QUAY_GITHUB_REPO=yaleh/quay node packages/quay-github/bin/quay-github.js task check gh-4 --json
   { "id": "gh-4", "gate": "author->ready", "ok": false,
     "artifacts": {"proposal":true,"plan":true,"ac":true,"dod":true},
     "acTotal": 3, "acChecked": 0, "reason": "0/3 AC checkboxes checked" }
   ```
   Matches the report's quoted output verbatim. `gh issue view 4 --json body`
   confirms the issue's own AC section has exactly 3 unchecked `- [ ]` items.
   Issue status (`todo`, label `status:todo`) correctly selects the
   `author->ready` gate branch.

3. **Mandate (a), issue #3 — gate failure reproduced exactly.** Independently ran:
   ```
   $ QUAY_GITHUB_REPO=yaleh/quay node packages/quay-github/bin/quay-github.js task check gh-3 --json
   { "id": "gh-3", "gate": "execute->done", "ok": false,
     "acTotal": 4, "acChecked": 0, "reason": "0/4 AC checkboxes checked" }
   ```
   Matches verbatim. Issue #3's status is `ready` (label `status:ready`),
   correctly selecting the `execute->done` gate branch, not `author->ready`
   — the report's gate label is correct. The raw issue body actually
   contains 6 total `- [ ]`-style lines (2 in the Plan section, 4 in AC),
   but `extractGateSection()` (`packages/quay-github/src/github-client.js`
   lines 260-268) isolates only the content under the `## AC` heading before
   counting checkboxes, so the reported `4` (not `6`) is the correct,
   verified count — read the extraction function directly to confirm this,
   rather than accepting the number at face value.

4. **`checkGate()` reads AC state exclusively from `issue.body` — confirmed by reading the source, not by trusting the report.**
   `packages/quay-github/src/github-client.js` lines 356-433: both the
   `todo` branch (`author->ready` gate, lines 361-396) and the `ready`
   branch (`execute->done` gate, lines 398-433) call
   `extractGateSection(body, ["AC", "Acceptance Criteria"])` and count
   `- [ ]` / `- [x]` regex matches against that section. `body` is the raw
   `issue.body` string (confirmed via the surrounding `task` param
   destructuring, `const { id, status, body, role, children } = task;`,
   and `github-client.js` line 140, `body: issue.body ?? ""`, in the
   view-model construction). There is no alternate source of AC state
   (no separate metadata field, no GitHub Projects/labels integration for
   AC) — the mechanism is exactly as claimed.

5. **`task_write`'s `inputSchema` is genuinely `{id, status}` only — confirmed at the cited line.**
   ```
   $ grep -n "inputSchema" packages/quay-github/src/mcp-server.js
   ...
   95:      inputSchema: { id: z.string(), status: z.string() },
   ```
   `packages/quay-github/provider.yml`'s own comment confirms this is
   QN-024's deliberate iteration-10 scope decision ("status-only write.
   title/body/labels/parent/children remain unimplemented"), and
   `packages/quay-github/DESIGN.md` line 163 states verbatim: "`body`,
   `labels` (non-status), `parent`, `children` remain read-only in
   [status-only `data.write`]" — an exact match to the report's quotation.
   Issue #3's own AC (asking to add `extra: z.record(z.any()).optional()`
   to this exact schema) is confirmed, by direct comparison against
   `packages/quay-native/src/mcp-server.js` line 99 (which already has this
   field, QN-007, native side only), to be a genuine, deliberate scope
   expansion request, not a bug within existing scope — the report's
   localization is accurate.

6. **Issue #4's underlying native fix — independently re-verified, live, both AC items.**
   ```
   $ cd packages/quay-native && unset QUAY_NATIVE_TASKS_DIR && node bin/quay-native.js task check QN-001 --json
   { "id": "QN-001", "gate": "none", "ok": true, "reason": "terminal" }
   $ QUAY_NATIVE_TASKS_DIR=/tmp/fake-tasks-dir-xyz node bin/quay-native.js task check QN-001 --json
   { "id": "QN-001", "ok": false, "reason": "not found" }
   ```
   Both outputs match the report's quotations exactly — AC1 (repo-root
   auto-resolution with no env var) and AC2 (explicit env var still wins,
   proven by the bogus-dir "not found" result) both pass, live, confirming
   the underlying QN-001 fix works correctly today, independent of the
   report's own re-run.

7. **Mandate (b) — `manda serve` on port 28912 is genuinely live.**
   ```
   $ ss -tlnp | grep 28912
   LISTEN 0 4096 *:28912 *:* users:(("manda",pid=1088563,fd=3))
   $ curl -s -o /dev/null -w "%{http_code}\n" http://localhost:28912/
   404
   ```
   Confirms both halves of the claim: the daemon is genuinely bound and
   listening (not merely a stale process), and the bare-curl 404 is
   correctly characterized as a normal "no route at `/`" response rather
   than evidence of an inactive daemon.

8. **ToolSearch surfaces the dispatch primitives — confirmed independently.**
   `ToolSearch("dispatch subagent spawn task manda agent")` returned fully
   loadable schemas for `mcp__plugin_manda_manda__Agent`, `Dispatch`,
   `DispatchStatus`, `DispatchSettle`, `DispatchProgress`, `DispatchCancel`,
   `TaskCreate/Get/Update` — matching the report's claim exactly, including
   the specific tool-name list.

9. **Actual `Agent` dispatch call — independently invoked, reproduced the identical timeout.**
   ```
   mcp__plugin_manda_manda__Agent(prompt="Reply with exactly the text: AUDIT_PROBE_OK", timeout=20)
   → MCP error -32603: timeout waiting for cap "agent.spawn" result after 20s: context deadline exceeded
   ```
   This is a genuine, freshly-executed round-trip (this audit used its own
   probe prompt and a shorter timeout, not a replay of the iteration's own
   call) and reproduces the identical failure signature: a clean
   protocol-level timeout after a real network wait, not an immediate
   "tool not found" or schema-validation error. This independently confirms
   the primitive is reachable and the call genuinely executes, exactly as
   claimed.

10. **`.manda/config.yml` routing and `--self`-empty root cause — confirmed by direct inspection.**
    `.manda/config.yml`'s `monitor.bindings` section binds `channels:
    ["cap-requests-{name}"]` to the `parent-proxy` profile, whose template
    text instructs a bound monitor to execute the capability with its own
    native `Agent` tool and reply on `cap-results`. The `mcp_adapters`
    entry for `claude-tools` is configured as `["manda-tools", "mcp",
    "--self", "{name}"]` — the `{name}` template variable is meant to be
    substituted with a session label at process-launch time. Independently
    inspected all three running `manda-tools mcp --self` processes via
    `/proc/<pid>/cmdline`:
    ```
    PID 1050926: manda-tools mcp --self  --allow todo.write,todo.read,agent.spawn
    PID 1085804: manda-tools mcp --self  --allow todo.write,todo.read,agent.spawn
    PID 1090943: manda-tools mcp --self  --allow todo.write,todo.read,agent.spawn
    ```
    Confirmed genuinely empty (`--self` followed immediately by a second
    space then `--allow`, not a name) in all three — the `{name}`
    substitution never happened for any of them. This is a technically
    sound diagnosis: with `--self` empty, `cap-requests-{name}` cannot
    resolve to a channel name any bound monitor is listening on, which
    directly explains why `agent.spawn` requests round-trip to the daemon
    (confirmed live and listening) but never reach a servicing monitor,
    producing exactly the clean protocol-level timeout observed in finding
    9. No alternative explanation (e.g., daemon down, malformed request,
    missing capability grant) fits the evidence better — the daemon is
    confirmed live (finding 7), the call is confirmed to execute a genuine
    round-trip rather than fail immediately (finding 9), and the
    `--self`-empty condition is directly observable and sufficient to
    explain an unrouted channel.

11. **No cleanup issue — `.manda/` state was not modified by this iteration.**
    `git status --short -- .manda/` and `git diff -- .manda/` both return
    empty — `.manda/config.yml` (git-tracked) is byte-identical to its
    committed state; iteration 49 made no edit to it. `.manda/hub.addr` is
    untracked runtime state by design (its own commit history, `ce8ab45
    Untrack .manda/hub.addr; it is session-local runtime state, not
    config`, confirms this is expected and intentional, not an artifact
    this iteration introduced or should revert). No stray lock files, no
    new files under `.manda/`, and no orphaned processes attributable to
    this iteration's single 30-second `Agent` probe were found — the three
    `manda-tools`/`manda mcp`/`manda-dispatch mcp` process triples visible
    in `ps aux` are long-running MCP server processes backing this and
    other sessions' tool connections, not something spawned and abandoned
    by the iteration's dispatch probe. **The iteration correctly stayed
    within scope**: it diagnosed the `.manda/` wiring gap but did not
    attempt to fix it (fixing shared, experiment-external manda
    configuration would be out of scope for a quay-development iteration,
    and the report explicitly defers that decision to "future
    iterations/orchestrator sessions," which is the correct call). No
    revert or cleanup action is needed.

12. **No GitHub issue state was altered by the probes.**
    `gh issue view 3/4 --json state,labels,updatedAt` shows both issues
    `OPEN` with `updatedAt` timestamps (05:40:27Z and 08:18:05Z) predating
    this audit session and the iteration's own probe session — consistent
    with "read-only diagnostic calls only," as claimed. Labels match the
    expected `status:ready`/`lane:execution` (issue #3) and `status:todo`
    (issue #4) states referenced by the gate outputs in findings 2-3.

13. **σ, V_instance, V_meta — all independently recomputed and unchanged.**
    ```
    $ ls tasks/QN-*.md | wc -l
    56
    ```
    Confirms σ = 49/56 = 0.8750 exactly (independently recomputed:
    49/56 = 0.875). `V_instance = 0.70 × 0.96 × 0.76 × 0.96 = 0.4903` and
    `V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973` both independently
    recomputed via direct arithmetic — exact matches, no rounding
    discrepancy.

14. **V-factor flat-hold reasoning verified against the protocol's exact wording.**
    Re-read §5.1 and §5.2 directly (not from the report's paraphrase).
    None of skeleton/abi_symmetry/gate_correctness/skill_convergence
    (§5.1: skeleton loop running, ABI CLI/MCP schema equivalence, gate
    logic correctness, Skill-driven convergence) are implicated by this
    iteration's work — `git status --short` and `git diff --stat` both
    confirm zero source files touched, so there is no candidate change to
    attribute to any of these four factors. For §5.2: `completeness`
    requires new Skill/gate/decomposition-rule content (none changed);
    `effectiveness` requires "speedup building feature N+1 via quay-native"
    measured on "the marginal increment" (no feature was built — the live
    commands were diagnostic gate/dispatch probes against pre-existing
    tasks and issues, not a new increment); `reusability` requires new
    Provider *behavior* on the transfer target (the gate-call evidence
    strengthens confidence in an already-credited iteration-45/QN-24
    finding but does not itself constitute new transferred capability);
    `validation` requires an out-of-band audit of *this iteration's own
    work*, which by construction does not yet exist at iteration-report-
    write time (it is this very audit). The report's own reasoning
    tracking each factor against the precise defining clause, rather than
    asserting flat-hold by default, is verified sound — flat-hold across
    all eight factors is the protocol-correct outcome here, not merely a
    conservative default.

15. **Full regression suite and ABI symmetry — independently re-run, both pass.**
    ```
    $ node --test packages/*/test/*.test.mjs
    tests 25, pass 25, fail 0
    $ node packages/quay-native/test/abi-symmetry.mjs
    ALL FOUR SURFACES SYMMETRIC
    ```

16. **Twelve-consecutive-PASS streak (37-48) independently re-verified, now thirteen (37-49).**
    Grepped the verdict line of every `iteration-{37..48}-independent-
    adjudicate.md`: all twelve report `**Verdict: PASS**` (exact text
    varies slightly per file but all begin with this token followed by
    "every headline claim ... is independently verified accurate"). This
    audit extends the streak to thirteen (37-49).

17. **`git status --short` — clean except the one known pre-existing untracked file.**
    ```
    $ git status --short
    ?? docs/proposal/baime-lite-driving-external-projects.md
    ```
    Matches exactly. `git check-ignore` confirms this file is genuinely
    *not* gitignored (exit code 1), consistent with "untracked, not
    ignored" rather than an intentional exclusion — the standing
    carried-forward item (protocol doc gitignore discovery, unrelated file)
    remains correctly flagged as open for human attention, not resolved or
    silently altered this iteration.

## Critical assessment (per iteration 48's audit caution)

Iteration 48's audit explicitly warned that consecutive "nothing to do"
findings risk self-reinforcement if each iteration re-runs the same
confirmation-register checks rather than pursuing genuine
opportunity-discovery. Iteration 49 was the first iteration under an
explicit two-part mandate to do exactly that, and it delivered on both
parts with materially new, falsifiable evidence rather than restating
prior framing:

- Mandate (a) moved the standing "QN-024 scope blocker" claim from an
  abstract citation to a live, reproducible gate-call failure with exact
  `acChecked`/`acTotal` counts and a source-level mechanism
  (`checkGate()`'s exclusive reliance on `issue.body` text) — this audit
  reproduced every one of those numbers independently and found the
  underlying source-code claim (schema shape, section-extraction logic)
  correct on direct inspection, not just plausible.
- Mandate (b) moved the standing "no verified dispatch primitive" framing
  (unchanged since ~iteration 15, per the report) to a precise, three-part
  mechanistic diagnosis (daemon live, schema loadable, MCP round-trip
  executes and times out due to unsubstituted `--self`) — this audit
  independently reproduced all three parts with its own fresh commands and
  its own fresh `Agent` probe call, and found no gap in the causal chain.

Both investigations conclude "no new execution opportunity" but do so on
genuinely stronger, mechanistically specific evidence than any prior
"nothing to do" iteration in the 37-48 streak — this satisfies the spirit
of iteration 48's caution rather than merely restating it. The correct
V-factor consequence (flat-hold across all eight factors) follows
directly from the protocol's own wording once the actual mechanism found
is diagnostic/confirmatory rather than a new capability, schema, or test —
this audit's own re-derivation of that reasoning (finding 14) reached the
same conclusion independently, not by trusting the report's framing.

One point for the next iteration/orchestrator to weigh, flagged but not
adjudicated here (outside a mechanical audit's remit): mandate (b)'s
finding that the dispatch primitive is reachable-but-unwired is
informative for understanding *how* G3 audits are currently produced
(exclusively via the top-level orchestrator's own separate process, which
this audit itself is an instance of), but fixing the `--self` wiring gap
is squarely outside quay's own deliverables (it is shared,
experiment-external manda infrastructure) — the report correctly declines
to touch it and correctly defers that decision upward. This audit finds
no reason to disagree with that scope boundary.

## Net assessment

Every command cited in iteration 49's report was independently re-run
against the live working tree, live GitHub issues, and the live manda
daemon, and every quoted output was reproduced verbatim or functionally
identical (allowing for the audit's own distinct probe prompt/timeout
values in the `Agent` call). Every source-code claim (`task_write`
inputSchema shape, `checkGate()`'s body-only AC read, `extractGateSection`
scoping, `.manda/config.yml` routing, the empty `--self` in all three live
`manda-tools` processes) was verified by reading the actual file, not by
trusting the report's description. σ, V_instance, and V_meta are all
independently recomputed and confirmed unchanged (49/56 = 0.8750,
0.4903, 0.0973), and the reasoning that neither mandate should move any
V-factor was independently re-derived from the protocol's exact §5.1/§5.2
wording, not merely accepted. The full regression suite (25/25) and ABI
symmetry both pass. `git status --short` is clean except the one known
pre-existing untracked file, and `.manda/` shows no tracked-file
modification and no stray state requiring cleanup — the iteration's
dispatch probe was read-only/diagnostic and left the shared manda
substrate exactly as it found it.

**Verdict: PASS.** Iteration 49 is the first "nothing to do" iteration in
the recent streak to be executed under an explicit mandate to investigate
concretely rather than re-cite, and it discharged that mandate rigorously
on both named items, producing genuinely new, independently-reproducible,
mechanistically precise evidence, while correctly declining to force
either finding into an unsupported V-factor movement or to take any
out-of-scope remedial action on shared manda infrastructure. No cleanup
of manda state is needed.
