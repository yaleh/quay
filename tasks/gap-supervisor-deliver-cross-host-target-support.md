---
id: gap-supervisor-deliver-cross-host-target-support
title: supervisor-deliver.sh 需支持跨主机目标（<host>:<tmux-target> 或 --host）——本机 tmux send-keys + 本地 transcript 读取结构上无法投递到另一台机器；manager 已 3 次手搓 ssh tmux send-keys 违规绕过（ADR-016 禁形态）；AC16③ Level3 在 ad-arm1 真实运行使跨主机投递成为常规路径
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**manager 请求（人 2026-08-11 16:0x 明确授权提此请求，决定权在 outer）——`supervisor-deliver.sh` 需要支持跨主机目标。**

**缺口（manager 实测，非猜测）**：`supervisor-deliver.sh:155/157/159` 是本机 `tmux send-keys -t "$TARGET"`；`send-keys-reliable.sh` 里 `ssh` 命中数 = 0；`transcript-delivery-check.ts:276/316` 用 `fs.readFileSync` 读本地路径。⇒ 当目标 tmux server 与 transcript 都在另一台机器（如 ad-arm1）时，本机跑该工具**结构上必失败**，没有任何参数能让它工作。

**代价已实际发生（manager 自报，B1 审计 CONFIRMED）**：manager 对 ad-arm1 `archguard-0:outer` 投递了 3 次，全部手搓裸 tmux send-keys 三段式经 ssh 转发——ADR-016 明文禁止形态（"do NOT hand-write tmux send-keys sequences"）。**违规根因不是没找工具，是工具对这个场景不存在**；按 C16「绕过不是罪，不留痕才是」已立案入 manager 台账（`OB-SUPERVISOR-DELIVER-CANNOT-CROSS-HOST-BYPASSED-WITHOUT-FILING`），转成实现请求。

**为什么现在值得做**：AC16③ Level3 已在 ad-arm1 真实运行（人 15:2x 起的 archguard 双层会话），对它的观测与驱动会持续，跨主机投递从"偶发"变成"常规路径"。它同时也是 AC16③ 自身的基础设施——没有可靠的跨主机投递，"在别的机器上驱动开发"的每一次驱动都是一次违规绕过。

### 期望形态（manager 形状建议，具体设计归 inner/outer 判定）

1. **目标语法**：`<host>:<tmux-target>`（如 `ad-arm1.wan.hwang.men:archguard-0:outer`）或 `--host <fqdn>` 旗标。
2. **投递侧**：三段 send-keys（C-u/文本/Enter，三次分开调用）经 ssh 转发到目标机器执行。
3. **验证侧**：`transcript-delivery-check.ts` 需要能读远端 transcript（ssh cat 到本地临时文件再验，或远端执行该检查器）。**验证语义不能降级**——ADR-016 的唯一可信送达信号仍是"目标 transcript 出现内容匹配的真实 user message"，不能因为跨主机就退回 pane 回显。

### 验证锚

修后 (a) `supervisor-deliver.sh ad-arm1.wan.hwang.men:archguard-0:outer "<payload>" --transcript <远端或本地解析>` 能投递且 delivered 判据为真（目标 transcript 出现内容匹配的真实 user message）；(b) 不回归本机路径（`quay-0:inner` 照常）；(c) 现有 supervisor-deliver / send-keys-reliable / transcript-delivery-check 测试全绿；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录跨主机结构性失败（本机 tmux send-keys + 本地 readFileSync，目标在别机必失败）+ manager 3 次手搓 ssh 违规绕过（已立案 manager 台账）
- [ ] AC2: **跨主机目标语法**——`supervisor-deliver.sh` 支持 `<host>:<tmux-target>` 或 `--host <fqdn>`，投递侧三段 send-keys 经 ssh 转发
- [ ] AC3: **远端 transcript 验证**——`transcript-delivery-check.ts` 能读远端 transcript（ssh cat 到本地临时文件再验，或远端执行检查器），delivered 判据不降级（仍是目标 transcript 内容匹配真实 user message，非 pane 回显）
- [ ] AC4: **本机不回归**——`quay-0:inner` 本机路径照常，现有测试全绿
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：`supervisor-deliver.sh ad-arm1...:archguard-0:outer` 投递 + delivered 判据证据贴出
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/supervisor-deliver.sh（跨主机目标语法 + ssh 转发投递）
- plugin/scripts/send-keys-reliable.sh（ssh 转发三段式；当前 ssh 命中 0）
- plugin/scripts/transcript-delivery-check.ts（远端 transcript 读取，delivered 判据不降级）
- plugin/scripts/drive-target-check.sh（跨主机目标解析，若适用）
- plugin/test/supervisor-deliver.test.mjs（跨主机用例）
- tasks/gap-supervisor-deliver-cross-host-target-support.md（自身：勾 AC + 贴证据）

## Contract

measure   cross_host_delivered = `bash plugin/scripts/supervisor-deliver.sh <host>:<tmux-target> "<payload>" --transcript <远端> 2>&1 | grep -c 'delivered: true'` stdout 数字
band      cross_host_delivered = 1（跨主机投递 delivered 判据为真）
invariant delivered_signal_not_degraded = 1（delivered 仍基于目标 transcript 内容匹配真实 user message，非 pane 回显）
invoke    `bash plugin/scripts/supervisor-deliver.sh ad-arm1.wan.hwang.men:archguard-0:outer "<测试载荷>" --transcript <远端解析>`（贴 delivered:true 证据）
control   跨主机可投递；delivered 判据不降级；本机不回归；既有不回归
resume    目标语法 / ssh 转发 / 远端验证 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 请求（人 16:0x 授权）——supervisor-deliver.sh 跨主机支持。结构性缺口实测（本机 tmux+本地 transcript 读，目标在别机必失败）；manager 已 3 次手搓 ssh 违规（ADR-016 禁形态）且已立案台账。AC16③ Level3 在 ad-arm1 常规运行使此为基础设施。实现归 inner，判定归 outer
