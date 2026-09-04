<!-- FROZEN FIXTURE — AC59 true-sample replay samples (gap-ac59-family5-scan-covers-execution-cores).

     These four lines are the FAMILY-5 shapes as they existed when AC59 recorded them
     (2026-08-14). The replay test scans THIS FILE, NOT the live execution cores — because
     the live cores' normal fate is to be FIXED (freshness limits added), and a replay pinned
     to live files would go RED the moment someone fixes one (direction-2: 修好 ⇒ 样本消失 ⇒ 红).
     Pinning to this frozen copy tests "does the scanner recognize the shape" (always-true),
     independent of whether any live instance still exists.

     DO NOT "update" these lines to match the current cores — the whole point is they are
     frozen at recording time. If the scanner's FAMILY-5 shape definition changes, update the
     DETECTOR + its baseline, and re-verify this replay still fires all four.
-->

| A9 | 读外层 `.quay/full-suite-state.json` | `running`/`green` ⇒ 照常派发与合并 |

**戊【字面为真且恒真】**——`.quay/full-suite-state.json` 仍是 `state=red scope=main startedAt=2026-08-13T16:19:54Z`,

| A11 | 读 `.quay/full-suite-state.json` 的 `state`/`reason`/`durationMs` |

- **B3 全量 suite 后台起跑**:条件 = 本轮收尾 ≥1(或有新 merge 落地)**且** `state != running` 且 `resource-gate.sh --for full-suite` 放行。被测 worktree/integration checkout 时**必须**同传 `--state-dir "$REPO_ROOT/.quay"`。
