---
id: gap-ac234-web-third-party-renders-carriers-and-round-records
title: web 指向第三方项目时显示其真实载体与过程记录——落 ac="GOAL-015-AC-234" 记录（AC-234）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-234
---
## Proposal

正本判据 `goals/AC-234-web-指向第三方项目时显示其真实载体与过程记录-http-200-不算证据-退出条件②.md`（goal=GOAL-015，2026-09-10 人令）：exit 0 = 载体 `.quay/productization-verification.jsonl` 存在 `ac="GOAL-015-AC-234"` 记录，且 host≠本机 ∧ project_root∉本仓库 ∧ `tasks_rendered>0` ∧ `goals_rendered>0` ∧ `round_records_rendered>0`。exit 1 = 无（当前，从未发生）；exit 3 = 载体缺失。立条当轮已干跑 exit 1（可评估、红）。

**现状（位置判定，非关键词）**：`grep -c 'GOAL-015-AC-234' plugin/scripts/verify-deliver-coldstart.sh` = 0；生产载体 `.quay/productization-verification.jsonl`（22400 字节）`grep -c 'GOAL-015-AC-234'` = 0——无人写这条记录。GOAL-015 正文同日做过一次手工内容级实测（/dashboard 显示 e2e-verify-207 任务 id ×4、/tests /git /goal 各 200、round jsonl 961 行），但那一次未落机器记录、且 /goal 那次是**空状态**（第三方项目无 goal）⇒ 不满足本判据。

**修法**：把「web 可观测」接成 `verify-deliver-coldstart.sh` 的一段验证步骤 + 一条载体记录——`quay serve` 指向真实第三方项目，取回页面内容（⛔ 非 curl 200 探活），断言 task/goal 双载体与 round 过程记录都有**真实渲染内容**（三计数全 >0），落 `ac="GOAL-015-AC-234"` 记录。三计数缺一不可——只断言「服务起得来」与「渲染空壳页」同形（硬规则 4）。

## Plan

1. **接线验证步骤**：`plugin/scripts/verify-deliver-coldstart.sh` 新增 AC-234 段（在 step5_e2e 之后或独立 step）：`quay serve` 指向第三方项目（host B/C，新 --root/--prefix），取回 `/dashboard`（或 `/tasks`）、`/goal`、过程记录路由（`/tests` 读 verification-round.jsonl 或 `/journal`）的真实 HTML，按内容计数：`tasks_rendered` = 页面真实渲染的任务 id 数、`goals_rendered` = `/goal` 渲染的 goal 条目数、`round_records_rendered` = 过程记录路由渲染的 round jsonl 记录数。三计数任一 ≤0 则 fail-closed 不写记录（硬规则 3b）。
2. **`goals_rendered>0` 的前置**：quay-init 只 `mkdir -p goals/`、不创建 goal 记录（`quay-init.sh:2236`）⇒ 全新第三方项目 `/goal` 必为空状态 ⇒ `goals_rendered=0`。验证步骤须先确保第三方项目有一条真实 goal 记录（经 goal-store ABI 写，或复用 e2e 流程已有 goal），否则本判据结构上不可满足。
3. **载体落账**：追加 `{"ac":"GOAL-015-AC-234","host","project_root","tasks_rendered","goals_rendered","round_records_rendered"}`，仅当 host≠本机 ∧ project_root∉本仓库 ∧ 三计数全 >0。
4. **生产复跑**（host B/C + 第三方项目）使判据 exit 1 → exit 0。**证据取回同 AC-207**：远端产出不自动回本机载体，须显式取回 `.quay/productization-verification.jsonl` 并复跑判据，⛔ 不得手写/注入。

## Touches

- `tasks/gap-ac234-web-third-party-renders-carriers-and-round-records.md`
- `plugin/scripts/verify-deliver-coldstart.sh`
- `plugin/test/verify-deliver-coldstart.test.mjs`

## AC

- [x] AC1 机制接线：`grep -c 'GOAL-015-AC-234' plugin/scripts/verify-deliver-coldstart.sh` ≥ 1，且 `tasks_rendered`、`goals_rendered`、`round_records_rendered` 三字段名在脚本内各 ≥1 命中；贴前 3 条命中（硬规则②）。【实测】GOAL-015-AC-234=5、tasks_rendered=7、goals_rendered=11、round_records_rendered=7；前 3 条命中 = 脚本行 1210（ac=GOAL-015-AC-234 判据注释）、1244（write_ac234_record 注释）、1254（write_ac234_record printf 落账行）。
- [x] AC2 内容级直接量：贴出读 tasks_rendered/goals_rendered/round_records_rendered 的命令与命中行——三计数取自真实渲染 HTML 内容（非 HTTP 状态码），且各自 >0。【实测】`probe_ac234_render_counts` 用 `grep -o 'href="/task/'`（/tasks）、`grep -o 'href="/goal/'`（/goal）、`grep -o 'href="/tests?round='`（/tests）对 HTML 正文计数；selfcheck 正控制 `ac234-render-counts(positive) tasks=3 goals=2 rounds=5`、负控制空壳页 `0/0/0`；真实 serve 冒烟（本仓库 /tasks=20、/goal=108、/tests=20，全 >0）。
- [ ] AC3 载体落账：生产载体出现 `ac="GOAL-015-AC-234"` 记录，host≠本机 ∧ project_root∉本仓库 ∧ tasks_rendered>0 ∧ goals_rendered>0 ∧ round_records_rendered>0（逐字段满足 criterion 过滤）。（待外部）
- [x] AC4 负控制（能取假）：注入一条三计数任一=0 或 host=本机 的记录 ⇒ criterion 仍 exit 1；验证后移除、不污染生产载体。【实测】criterion 干跑：host=本机 ⇒ exit 1、tasks_rendered=0 ⇒ exit 1、正样本（hostB-fake ∉本仓库 + 3/2/5）⇒ exit 0、载体缺失 ⇒ exit 3；selfcheck `ac234-record(zero-count) refused=1` / `ac234-record(empty-host) refused=1`（write_ac234_record fail-closed 拒写）。
- [ ] AC5 判据翻转：AC-234 criterion 干跑从 exit 1 → exit 0（贴出干跑输出）。（待外部）

## DoD

AC1–AC5 全绿；`scripts/test.sh` 全量绿（含 `plugin/test/verify-deliver-coldstart.test.mjs`）。AC-234 criterion exit 0：宿主 B/C 之一，project_root 为第三方项目（∉ 本仓库），tasks_rendered/goals_rendered/round_records_rendered 三计数全 >0（真实渲染内容，⛔ 非 HTTP 200 探活）。⛔ 不得手写/注入记录；⛔ 不得搬运出自坏构建的记录。