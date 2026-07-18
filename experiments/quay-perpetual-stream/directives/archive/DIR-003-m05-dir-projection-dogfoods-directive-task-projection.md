# DIR-003

- status: applied
- created_by: iteration-0 (self-raised, M05-dir-projection milestone, per charter item 5's
  live-dogfood-demonstration requirement — a small genuinely-true finding is explicitly sanctioned
  by the charter for this purpose)
- created_at: 2026-07-18
- title: M05-dir-projection dogfoods its own directive-to-task projection mechanism

## Finding

This milestone (`M-DIR-PROJECTION`, charter `experiments/quay-perpetual-stream/charters/
M05-dir-projection.md`, sourced from DIR-002) builds a mechanism whereby `/quay-directive` writes
BOTH a `DIR-NNN.md` file (as before) AND, newly, a `label: directive` task via `task_write` that
projects the file (link + Finding summary + a status-mirror field), with an anti-drift
reconciliation script (`experiments/quay-perpetual-stream/scripts/it0-dir-projection-check.sh`)
that fails if a projected task has no corresponding file, or if the file's `status:` disagrees
with the task's status-mirror. Charter item 5 explicitly requires "a real, live `/quay-directive`
invocation this milestone" and states that documenting "the M-DIR-PROJECTION milestone itself
dogfoods this mechanism" is an acceptable, truthful finding to use for that demonstration. This
file IS that live invocation — a real `/quay-directive` call made during iteration-0's own work,
used to generate the pasted task_get/task_list evidence the charter's binary Done-when clause 1
requires.

## Requested action

None beyond the demonstration itself — this directive exists to be the concrete artifact that
`/quay-directive`'s newly-added task-projection step (SKILL.md step 5, this milestone's edit)
operates on, producing a real `label: directive` task (`DIR-003`) linking back to this file. No
further action is requested; iteration-0's own report is where the resulting evidence is recorded
and disposed of (this directive is expected to be applied/self-resolved within the same iteration
that created it, since it is the demonstration vehicle itself, not a request for separate future
work).

## Resolution (added when moved to archive/, or updated in place if deferred)
- resolved_by: iteration-0 (M05-dir-projection)
- outcome: applied — this directive's own text was used as the real `/quay-directive` invocation
  the charter's item 5 (live dogfood demonstration) requires. Applying it means: the file was
  written; the new SKILL.md step 5 was exercised against it for real, producing a real
  `label: directive` task (`DIR-003`) via `packages/quay-native/bin/quay-native.js task edit`
  (the native provider's own write path — the `quay` Core CLI's `task edit` was confirmed
  status-only and unable to do this, a genuine finding folded into the SKILL.md edit); the
  resulting task was confirmed listed under the real Web UI's `?label=directive` filter (screenshot
  + curl transcript); the anti-drift check confirmed PASS against it (isolated) and demonstrated
  both FAIL modes against deliberately-constructed divergent inputs.
- evidence: `experiments/quay-perpetual-stream/milestones/M05-dir-projection/iterations/iteration-0.md`
  §"Live dogfood demonstration" and §"Done-when evidence"; screenshot at
  `experiments/quay-perpetual-stream/milestones/M05-dir-projection/iterations/dir003-webui-label-directive.png`.
