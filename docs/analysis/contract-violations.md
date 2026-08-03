# contract-violations.md — shrink-only ratchet list for the ## Contract consumer checks
# (tasks/gap-dispatch-gate-has-no-checklist-and-no-trace, AC6). A violation here means the task's
# ## Contract block (or ## Dispatch review section) fails one of the five consumer judgments.
#
# RATCHET: the list can ONLY get SHORTER. task-contract-check.ts exits 1 if a NEW violation
# appears that is not already listed, or if the list would exceed the baseline-count ceiling.
# Remove an entry only after the underlying violation is fixed (then run --write-ratchet to
# persist the shrunken list).
#
# Format: one `<task-file>: <violation-code>` per line (repo-root-relative, sorted).
# baseline-count: 1

tasks/gap-no-resource-awareness-heavy-ops-run-blind.md: dispatch-review-missing
