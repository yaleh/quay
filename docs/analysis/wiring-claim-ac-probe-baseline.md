# wiring-claim-ac-probe-baseline.md — shrink-only grandfather list for the wiring/reachability-declaration → real-input-probe check
# (tasks/gap-wiring-claim-ac-requires-real-input-probe).
#
# An AC bullet that declares a quantified reachability/real-data relationship (backtick identifier +
# `N 条` + 读到/读取/样本/现成) must ALSO name a real input probe — 真实生产载体记录数 / 真实 argv /
# /proc/<pid>/* / 真实 curl / 真机回放 (a direct量 that can be false). A string-literal direct call, a
# self-built fixture, or an mkdtemp workspace is NOT a probe. The legacy occurrences below are
# grandfathered HERE — the list can only get SHORTER: a task NOT listed whose AC carries the pattern
# is a new violation (task-contract-check.ts `wiring-claim-ac-no-probe`), and the baseline-count
# ceiling never grows. When a grandfathered task's AC is rewritten to name its real input source,
# DELETE its entry here and decrement baseline-count.
#
# The two entries are the canonical instances the check was calibrated against (each AC declares
# "N 条 … 读到/样本" while its test used a string-literal call / an mkdtemp synthetic copy):
#   - gap-readdepends-on-indented-extra-depends-on AC1: "10 条命中任务都能被读到" — test called
#     readDependsOn("depends_on: [a, b]\n") on a string literal, the 10 real files never read.
#   - gap-ac146-human-interface-explicit-owner AC2: "已有 3 条现成样本" — test copied samples into an
#     mkdtemp synthetic file, the real .quay/promotion-outcome.jsonl never read.
#
# Format: one repo-root-relative task file per line (sorted).
# baseline-count: 2

tasks/gap-ac146-human-interface-explicit-owner.md
tasks/gap-readdepends-on-indented-extra-depends-on.md
