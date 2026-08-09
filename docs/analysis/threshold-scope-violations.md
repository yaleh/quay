# threshold-scope-violations.md — shrink-only ratchet list for the quantified stop-condition scope
# and stale-path checks (tasks/gap-quantified-stop-conditions-have-no-scope). A violation here means
# a scanned driver doc (plugin/loop/fast-mode-loop-tick.md / plugin/loop/orchestrator-loop-tick.md
# / CLAUDE.md) carries a count-threshold stop/trigger condition without naming its window, or a
# backtick-named path that cannot be resolved (three-layer judgment, placeholder-skipped).
#
# RATCHET: the list can ONLY get SHORTER. threshold-scope-check.ts exits 1 if a NEW violation
# appears that is not already listed, or if the list would exceed the baseline-count ceiling.
# Remove an entry only after the underlying doc is fixed (then run --write-ratchet to persist the
# shrunken list). `--write-ratchet --reset-baseline` is the deliberate one-shot re-baseline after a
# criterion fix; it re-anchors the ceiling to the current violation set.
#
# Format: one `<rel-file>: <code>: <detail>` per line (repo-root-relative, sorted).
# baseline-count: 5

CLAUDE.md: stale-path: .claude/workflows/execute-milestone.js
plugin/loop/fast-mode-loop-tick.md: stale-path: last-pane.txt
plugin/loop/orchestrator-loop-tick.md: unscoped-threshold: | needs-human 积压 ≥3 | 分诊：真阻塞的攒给人，可继续的指示内层继续 |
plugin/loop/orchestrator-loop-tick.md: unscoped-threshold: 注册表 ≥2 行——有人多装了一个驱动（多半是照旧文档多起了一个 loop）——停下来处理，**不要再加装**。
plugin/loop/orchestrator-loop-tick.md: unscoped-threshold: 超 90 分钟 / needs-human 积压 ≥3」就停下等人——外层就是那个「人」的常规部分。内层仍然停，只是停的
