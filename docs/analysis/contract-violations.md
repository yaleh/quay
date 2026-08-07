# contract-violations.md — shrink-only ratchet list for the ## Contract consumer checks
# (tasks/gap-dispatch-gate-has-no-checklist-and-no-trace, AC6). A violation here means the task's
# ## Contract block (or ## Dispatch review section) fails one of the five consumer judgments.
#
# RATCHET: the list can ONLY get SHORTER. task-contract-check.ts exits 1 if a NEW violation
# appears that is not already listed, or if the list would exceed the baseline-count ceiling.
# Remove an entry only after the underlying violation is fixed (then run --write-ratchet to
# persist the shrunken list). `--write-ratchet --reset-baseline` is the deliberate one-shot
# re-baseline after a criterion fix; it re-anchors the ceiling to the current violation set.
#
# Format: one `<task-file>: <violation-code>` per line (repo-root-relative, sorted).
# baseline-count: 6

tasks/gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point.md: ac-ticked-self-admission
tasks/gap-no-inventory-of-what-the-two-layer-mode-actually-runs.md: contract-line-unknown
tasks/gap-no-inventory-of-what-the-two-layer-mode-actually-runs.md: dispatch-review-missing
tasks/gap-no-inventory-of-what-the-two-layer-mode-actually-runs.md: measure-no-command
tasks/gap-no-inventory-of-what-the-two-layer-mode-actually-runs.md: measure-no-field
tasks/gap-serve-task-list-dies-on-one-malformed-task.md: invoke-evidence-missing
