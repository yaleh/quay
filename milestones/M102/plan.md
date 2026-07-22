# M102 Plan — meta-cc history-mining standing routine (DIR-055)

**Charter:** `experiments/quay-perpetual-stream/charters/M102-dir055-meta-cc-routine.md`  
**Adjudication date:** 2026-07-22

## Adjudication Summary

Two proposals reviewed:

- **Proposal A**: Claims output_routing NOT consumed by routine-scheduler.mjs; proposes script-layer code change to emit routing map on CLI. Also says graceful degrade not implemented.
- **Proposal B**: Claims output_routing IS already handled in SKILL.md skill layer (M92 wired this); claims graceful degrade already in SKILL.md. No script-layer code changes needed for these — only loop.yml + selfcheck test.

**Decision**: Proposal B's assessment is more likely correct — M92 wired the probe-spec mechanism including output_routing consumption in the skill layer. Single-source principle (ADR-004): routing belongs in the skill, not duplicated in the CLI script. The executor must VERIFY by reading SKILL.md before assuming no change needed. If SKILL.md is missing output_routing handling, implement it there.

**Minimal change set** (per Proposal B, verified by executor):
1. `experiments/quay-perpetual-stream/.quay/loop.yml` — add history-mining routine entry
2. `experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh` — add RED+GREEN test for ref-less rejection
3. Real fire attempt via archguard-1 (or `needs-human`)
4. Plugin bump only if plugin/ files changed

## Implementation Steps

### Step 0: Verify current state (before writing any code)

Read:
- `plugin/scripts/SKILL.md` (or wherever the loop-driver skill is defined) — confirm output_routing and graceful-degrade are handled in the skill layer
- `experiments/quay-perpetual-stream/scripts/routine-scheduler.mjs` — confirm what it outputs and whether output_routing needs to be in the CLI output
- `experiments/quay-perpetual-stream/scripts/read-probe-spec.mjs` — confirm output_routing is parsed and returned

If SKILL.md is missing output_routing: implement it in SKILL.md (route `spec.output_routing[finding_type]` → task labels when filing).  
If SKILL.md already has it: no code change.

### Step 1: Add history-mining to loop.yml

In `experiments/quay-perpetual-stream/.quay/loop.yml`, append after the `architecture-analysis` entry:

```yaml
  - name: history-mining
    trigger: on(checkpoint)
    probe: history-mining
```

### Step 2: Add RED+GREEN test to routine-file-gate-selfcheck.sh

After the existing 4 test cases (before the `rm -rf "$T"` cleanup), add:

**RED case** (vague finding, no session-id/commit ref → REJECT):
```bash
# RED: history-mining finding without session-id/commit ref → REJECT
printf '## Finding\nMeta-cc session mining shows agents fail to close tasks properly. This is a systemic issue.\n## Requested action\nAdd a gate to enforce task closure.\n' > "$T/no-ref.md"
node "$CHK" "$T/no-ref.md" >/dev/null 2>&1
if [ "$?" = 1 ]; then echo "PASS: history-mining finding without ref → REJECT"; else echo "FAIL: expected REJECT for ref-less finding"; fail=1; fi
```

**GREEN case** (finding with session-id ref → ACCEPT):
```bash
# GREEN: history-mining finding WITH session-id/commit ref → ACCEPT
printf '## Finding\nSession `abc1234ef` shows a recurring pattern: acceptance gate missing `cwd` param on MCP calls (see commit `a1b2c3d`). Evidence: `node packages/quay/test/gate.test.mjs` exit 1 in 3 consecutive sessions.\n## Requested action\nFile as defect task with gate-cwd AC.\n' > "$T/with-ref.md"
node "$CHK" "$T/with-ref.md" >/dev/null 2>&1
if [ "$?" = 0 ]; then echo "PASS: history-mining finding with session ref → ACCEPT"; else echo "FAIL: expected ACCEPT for ref-backed finding"; fail=1; fi
```

Run `bash experiments/quay-perpetual-stream/scripts/routine-file-gate-selfcheck.sh` — all cases must PASS.

### Step 3: Real fire attempt (done-or-needs-human)

Check archguard session state:
```bash
tmux list-sessions 2>/dev/null
tmux list-panes -t archguard-1 -F "#{pane_current_command}" 2>/dev/null
```

If idle (pane_current_command = `bash`/`zsh`): use ADR-016 three-step remote-drive to dispatch the history-mining probe on the archguard workspace and read results from filesystem.

The dispatch should run `node /home/yale/work/quay/plugin/scripts/routine-scheduler.mjs --event checkpoint ...` or equivalent in the archguard workspace context, then wait for any filed tasks.

**If session busy or dispatch fails**: land this leg as `needs-human` with note: "archguard-1 session existed but was not idle; human should trigger checkpoint in archguard loop to prove real fire."

### Step 4: Plugin sync and version bump (conditional)

Run `bash plugin/scripts/sync-vendor.sh` to sync any changed exp5 scripts → plugin/scripts/.

Only bump `plugin/.claude-plugin/plugin.json` version if plugin/ content actually changed (i.e., any file in plugin/ is modified by this milestone). If only loop.yml and selfcheck.sh changed, no bump needed.

### Step 5: Commit

One commit for the config+test changes:
```
feat(routines): wire history-mining routine to loop.yml + selfcheck ref-less rejection test (DIR-055)
```

If real fire produces a filed task, that's a separate commit (the task file itself).

## Acceptance Criteria Check

- [ ] `history-mining` wired in loop.yml ✓
- [ ] output_routing verified implemented (SKILL.md) or implemented ✓
- [ ] RED+GREEN selfcheck test added and passing ✓
- [ ] Graceful degrade verified ✓
- [ ] Real fire: done-or-`needs-human` ✓

## Grounded Checks

1. Read SKILL.md BEFORE assuming no output_routing code change needed — Proposal B may be wrong
2. Run selfcheck after adding test cases — all existing 4 + new 2 = 6 cases must pass
3. Check `tmux list-panes` before attempting remote-drive (ADR-016: single driver hygiene — never race a human)
4. DoD: real-fire leg explicitly allows `needs-human` — do NOT block the rest of the milestone on it
