---
id: gap-e2e-verify-pushes-dev-host-profile-model-to-target-host
title: --ac207-e2e / --ac239-e2e 把开发机 .quay/profiles.yml 原样 scp 给目标主机，其 worker
  模型名（本机网关专属）在 host B 上被拒 ⇒ AC-207/AC-239 两条腿 worker 全死、记录不产出，且无覆盖入口
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal
<!-- dedup-ref -->相关已完成任务（仅追溯，机制不同）：gap-ac257-verify-leg-misses-declared-worker-env（--verify-ac257 腿不下发声明的 worker 环境，另一条腿）、gap-ac207-e2e-target-driver-driven-real-commit-task-done（AC-207 e2e 的引入）、gap-ac214-ac238-239-freshness-upgrade-producer-rerun（上一次成功重跑 upgrade-face）；已 superseded：gap-fix-worker-spawn-inherits-unrecognized-model-deepseek-v4-pro-anthropic（同一类 unrecognized_model 现象，但那是 promotion-driver 自己 spawn 的本机路径，不是向目标主机推送）。按机制查重：`grep -l "quay-driving-profiles\|--driving-profiles" tasks/*.md` 无任何任务以「推送侧无覆盖入口」为机制。

**问题（直接量，2026-09-25）**：`plugin/scripts/develop-deliver-tgz.sh` 在 `--ac207-e2e`（约 :1585）与 `--ac239-e2e`（约 :1744）两处，把驱动方仓库的 `${repo_root}/.quay/profiles.yml` 逐字 scp 到目标主机 `~/quay-driving-profiles.yml`，远端 `resolve_driving_profiles` → `configure_target_profiles` 由它派生目标项目 worker-default 的 launcher/model/auth。**推送侧没有任何覆盖入口**：`grep -c -E 'target-model|target-launcher|target-auth' plugin/scripts/develop-deliver-tgz.sh` = 0，而远端 `verify-deliver-coldstart.sh:615-617` 早已支持 `--target-launcher/--target-model/--target-auth`（「CLI 覆盖 > 驱动方派生」），只是驱动脚本从不转发。
**症状**：本仓 `.quay/profiles.yml` 的 worker-default.model 自 `cfed5fd14`（2026-09-23）起是 `v4.1flash-anthropic`（仅本机网关 127.0.0.1:26510 认得）。2026-09-25 对 host B（orangevps）重跑两条 producer：upgrade-face 的隔离副本 `.quay/profiles.yml:15` 含该模型名，副本内 worker-driver 于 11:10:59Z 自停（`halted_by: worker-driver:environment-fatal`，签名 `unrecognized_model {"model":"v4.1flash-anthropic"}`），AC-239 未产出；coldstart 的 `e2e-verify-207` 于 12:45–12:48Z 连续 4 次 `API Error: 400 Invalid model name passed in model=v4.1flash-` 后被重试上限翻 needs-human，远端脚本随后空等 `AC207_POLL_SECS`（develop-deliver-tgz.sh:1593 导出 3600s）。B 自己的 `claude` 进程用的是 `deepseek-v4-flash-anthropic`。
**因果状态（诚实标注）**：以上与时间线一致（载体末批成功证据 2026-09-20，早于 09-23 的模型名改动），但【尚未被反事实检验】——检验就是 AC4 里「换成 B 认得的模型名再跑一次」。在 AC4 通过前，这是假说，不是结论。

**做法**：给驱动脚本一个【驱动方本地】的 profile 来源覆盖入口（推荐 `--driving-profiles <本地路径>`，与远端脚本同名 flag；亦可用环境变量），未指定时行为与现状逐字节相同（仍用 `${repo_root}/.quay/profiles.yml`），指定时两处 scp 都改用它；指定路径不存在 ⇒ NOT-EVALUATED + 非零退出，⛔ 不回落到开发机 profile（硬规则 3b：读不懂输入不得伪装成合格）。⛔ 不在脚本里写死任何模型名（硬规则 4 推论二：写死的主机专属字面值换台机器就变成静默限制）；用哪个模型名由运行者提供一份目标主机认得的 profile。
**⚠️ 硬约束（sh-census 零余量棘轮 + 行号是公开接口）**：`develop-deliver-tgz.sh` 是被 `plugin/scripts/sh-census-check.ts` 按全文件代码行计费的脚本（当前 embeddedInterpreterLines=7687=基线，零余量）——改动必须【净增代码行 ≤0】（注释行免费；`if ! x; then…fi` 三行可折成 `x || …` 一行以抵扣新增），且 `ssh_opts=(`（:183）、`host_target[B]=`（:1402）等被 `plugin/freshness-producers.json` 与 30 余处引用的锚点行号必须仍然成立（或同一 delta 内同步改引用）。

## AC
- [ ] 动手前干跑谓词（对已知为真的样本）：`grep -c 'repo_root}/.quay/profiles.yml' plugin/scripts/develop-deliver-tgz.sh` 在改动前应为 2（两处 scp 点）——把这个读数与命中的前 3 行贴进提交说明；改动后两处 scp 的源路径必须来自同一个可被覆盖的变量。
- [ ] 新增测试（`plugin/test/develop-deliver-tgz.test.mjs`，PATH 上放假 `scp`/`ssh` 记录 argv，不联网）：(a) 未指定覆盖 ⇒ `--ac207-e2e` 与 `--ac239-e2e` 两条腿的 scp 源都是 `<root>/.quay/profiles.yml`（对照：默认行为不变）；(b) 指定覆盖文件 ⇒ 两条腿 scp 源都是该文件、且被推送的内容是覆盖文件的而不是 root 的；(c) 指定路径不存在 ⇒ 输出含 NOT-EVALUATED、退出码非 0、假 scp 的调用记录里【没有】开发机 profile。`node --test plugin/test/develop-deliver-tgz.test.mjs` 退出 0。负控制：临时回退脚本改动，(b) 必须转红（贴出红的输出）。
- [ ] 行数与锚点不回退：`node --experimental-strip-types plugin/scripts/sh-census-check.ts` 输出 PASS 且 embeddedInterpreterLines ≤ 7687；`grep -n '^ssh_opts=(' plugin/scripts/develop-deliver-tgz.sh` 与 `grep -n 'host_target\[B\]=' plugin/scripts/develop-deliver-tgz.sh` 的行号仍与 `plugin/freshness-producers.json` 里的引用一致（或引用在同一 delta 内同步更新）。
- [ ] `plugin/freshness-producers.json` 同步：coldstart-face / session-delivery / upgrade-face 三条 producer 记录了该覆盖入口的用法，且新增一条前置：「被推送 profile 的 worker-default.model 必须是目标主机网关认得的名字；开发机 profile 的模型名不保证在 B/C 可用」；coldstart-face 与 session-delivery 共用同一命令行，两处必须同改（其 `_same_run_as` 已声明）。`python3 -c "import json;json.load(open('plugin/freshness-producers.json'))"` 退出 0，且 `node --experimental-strip-types plugin/scripts/freshness-producer-coverage-check.ts --json` 报 evaluated=true、ok=true。
- [ ] 【读生产载体，且只计实现落地之后的时间窗】落地后用一份 B 认得的模型名 profile 真跑 coldstart-face（`--verify-coldstart --ac207-e2e --hosts "B C" --driving-profiles <该文件> --force --root <main-checkout>`）与 upgrade-face（`--verify-upgrade … --ac239-e2e --hosts B …`）各一次；`.quay/productization-verification.jsonl` 中 `ac=="GOAL-009-AC-207"` 且 `ts` 晚于落地提交时刻且 `build_sha` == 该次 develop tip 的记录数 ≥1（打印条数与前 3 条）；`ac=="GOAL-009-AC-239"` 同理 ≥1，或者——若 AC-239 腿因【非模型】前置失败（go 工具链 / profiles 未配 / develop 基线分叉，见 freshness-producers.json upgrade-face 前置）而缺失——则写明是哪一条，且远端 `.quay/worker-outcome.jsonl` 中 `Invalid model name|unrecognized_model` 命中数为 0。这一条同时是「模型名假说」的反事实检验：若换了 B 认得的模型名后仍出现同样的 400，则本任务的因果判断为假，须据实改写 Proposal 的因果状态段。

## DoD
- [ ] 上面的判据实跑通过，并且是【真实对象被机制操作过】：覆盖入口被一次真实的 B 端跑用过，载体里有落地后的 AC-207 新记录（fixture / 假 scp 只证明「能转发」，不证明「已产出」，硬规则 4 推论三）。
- [ ] ⛔ 本任务不代关、不改动 gap-routine-freshness-refresh-freshness-goal-009-* 那批 needs-human 任务的状态；它们的收尾按各自 AC 由人确认。⛔ 不手工改目标主机上任何隔离副本的 profiles.yml 来「凑」证据（那会使证据不再是未经改动的交付路径）。
- [ ] 提交说明里贴出：改动前后 `git diff --numstat` 对 develop-deliver-tgz.sh 的净行数（≤0）与 sh-census 读数。

## Touches
- `plugin/scripts/develop-deliver-tgz.sh`
- `plugin/test/develop-deliver-tgz.test.mjs`
- `plugin/freshness-producers.json`
- `tasks/gap-e2e-verify-pushes-dev-host-profile-model-to-target-host.md`
