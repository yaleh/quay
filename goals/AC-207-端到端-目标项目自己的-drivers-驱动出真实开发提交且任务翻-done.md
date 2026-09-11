---
id: AC-207
title: 端到端：目标项目自己的 *-drivers 驱动出真实开发提交且任务翻 done
status: achieved
kind: criterion
goal: GOAL-009
criterion: >-
  python3 - <<'P'

  import json,os,socket,sys

  p=".quay/productization-verification.jsonl"

  if not os.path.exists(p): sys.stderr.write("NOT-EVALUATED: carrier absent\n");
  sys.exit(3)

  me=socket.gethostname(); here=os.path.realpath(".")

  BOOK=("tasks/","goals/",".quay/")

  for l in open(p,encoding="utf-8"):
      if not l.strip(): continue
      r=json.loads(l)
      if r.get("ac")!="GOAL-009-AC-207": continue
      h=str(r.get("host") or ""); pr=os.path.realpath(str(r.get("project_root") or "/nonexistent"))
      if not h or h==me or pr==here or pr.startswith(here+os.sep): continue
      if not r.get("commit_sha") or not r.get("task_id"): continue
      if r.get("task_status")!="done": continue
      if int(r.get("gate_events") or 0)<=0: continue
      if r.get("produced_by_driver") is not True: continue   # 提交出自任务 worktree，非人手敲
      cf=r.get("commit_files")                               # 【触及的文件】区分记账/实现，⛔ 非关键词
      if not isinstance(cf,list) or not cf: continue         # 缺该字段/空 = 老形态记录 ⇒ 不满足（本缺陷正是它）
      if all(str(x).startswith(BOOK) for x in cf): continue  # 全在 tasks/goals/.quay 下 ⇒ 记账提交，不算开发提交
      sys.exit(0)
  sys.exit(1)

  P
expect: exit 0 = 载体中存在 ac=GOAL-009-AC-207 的记录，host≠本机 ∧ project_root ∉ 本仓库 ∧
  commit_sha 与 task_id 非空 ∧ task_status=done ∧ gate_events>0 ∧ produced_by_driver=true ∧
  commit_files 是非空列表且至少一条路径不在 tasks/ goals/ .quay/ 之下（该字段是判「实现提交 vs
  记账提交」的直接量——只看 commit_sha 非空曾让「零实现、只有记账提交」的项目同样通过）。
  exit 1 = 无合格记录（含「只有记账提交」与「老形态无 commit_files 记录」）。exit 3 = 载体缺失。
origin: 人 2026-09-09 要求①③：点火依靠会话投递，后续驱动依靠 *-drivers；目标项目中的实际开发活动应使用 goals 和
  tasks 等载体。人 2026-09-09 裁定②：退役 2026-08-16「必须真实交互式 tmux、claude -p
  不算」的裁定；裁定③：claude --bg 仅作本次验证手段，不作为产品能力交付。
activatedAt: 2026-09-09T11:49:17.184Z
statusLog:
  - at: 2026-09-09T11:49:17.184Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-09-11T01:49:48.509Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
**判据（能取假）**：2026-09-09 干跑 exit 1（从未发生过）。**证据必须外部可核**：commit_sha 取自第三方项目自身 git 历史（经共享裸仓库镜像可核），⛔ 不采信驱动方自述（硬规则 4b）。**produced_by_driver 的边界（照实说明，不假装机械）**：最强的可得直接量只到「提交出自 driver 建的任务 worktree ∧ gate 事件齐全 ∧ 时间线交错」，**这不能完全排除人在会话里手敲**；该半判据属人裁定的口证，不冒充测量。**产品/夹具边界**：本 AC 允许 claude --bg / -p 作为验证手段，但产品文档与 skill 文案不得因此声称 quay 会启动会话——SPEC-tmux-retirement-2026-09-03「quay 不管会话生命周期」的产品判断原样保留。

---

## 执行说明：跑成功之后必须「把证据取回家」（2026-09-10 人令写入）

**结构事实（实测，非推断）**：产出方与判读方不在同一台机器上，而**两者之间没有任何自动搬运**——

- **产出侧**：`verify-deliver-coldstart.sh` 必须**在目标主机本地运行**（它用 `hostname` 取 `AC207_HOST`，全文无 `ssh`），记录写进该主机上的 `--ac89 <本地路径>`。
- **判读侧**：本 AC 的判据读的是**本机（boheidc）**的 `.quay/productization-verification.jsonl`。
- **该载体是 gitignored**（`.gitignore:314`）⇒ 不随 git 同步，只存在于本机磁盘。

⇒ **一次完美成功的远端跑，本身不足以让本 AC 转绿。** 记录留在远端就等于没发生。2026-09-09 已实证：orangevps 的 `/tmp/ac207-record.jsonl` 里躺着 3 条 GOAL-009 记录（19:47:11Z 产出）从未被带回，本机载体里 GOAL-009 记录始终只有 `AC-201` 一条。

**执行时必须显式做的一步**（跑完之后、宣告完成之前）：

```
# 1. 只取本次跑真正产出的那条，⛔ 不整文件覆盖
ssh <目标主机> "grep 'GOAL-009-AC-207' <该主机上的 --ac89 路径>"
# 2. 去重后追加到本机载体（同 ts+ac 已存在则不重复追加）
#    >> /home/yale/work/quay/.quay/productization-verification.jsonl
# 3. 复跑本 AC 判据确认真的翻绿（⛔ 不以「我拷过了」为准）
```

**⛔ 三条不得违反的纪律**：

1. **只搬运真实跑出来的记录，⛔ 绝不手写/注入一条**——手写记录会让判据在机制没有端到端跑通的情况下变绿，那是硬规则 4 推论三点名的「只能被注入数据满足的判据不是测量」。
2. **⛔ 不搬运出自坏构建的记录**。反例已存在：上述 3 条 stranded 记录的 `build_sha` 是 `a3c4610f`（今晚全部修复之前），且同批的 `AC88` 记录自己写着 `ok:false, coldstart live=no` ⇒ 那是一次**失败**的跑留下的残渣，搬回来就是拿失败当成功。
3. **搬运后必须复跑判据**，以判据的退出码为准，⛔ 不以拷贝动作本身为准。

**这一步没有机制兜底，是执行者的显式义务**——若认为它应当机制化（例如让 `--ac89` 指向一个跨机同步的路径，或给脚本加一个回传步骤），那是另立任务的事，⛔ 不在本 AC 范围内。
## 执行说明（临时，随机制落地即退役）：先按宿主模型栈配置目标项目 profiles

**2026-09-10 实测**：全新 quay-init 出来的目标项目铺的是 shipped 通用默认（`launcher: claude` / `model: null` / `auth: key`），⇒ 模型名落到**宿主机全局 claude 配置**。在 orangevps 上该值是不带后缀的 `deepseek-v4-pro`，端点无对应 fallback group ⇒ worker 起来即 `API Error: 400 … No fallback model group found for original model_group=deepseek-v4-pro` ⇒ **连续 3 次 <60s 秒死 ⇒ 退避上限 ⇒ 目标项目任务翻 needs-human ⇒ e2e 永远走不到 fan-in**。

⇒ **跑 e2e 之前必须显式做一步**：把驱动方仓库 `.quay/profiles.yml` 里 `worker-default` 的 `launcher` / `model` / `auth` 写进目标项目的 `.quay/profiles.yml`（本仓库当前取值：`claude-fjdac` / `deepseek-v4-pro-anthropic` / `token`）。⛔ 不要依赖宿主全局默认——那正是本缺陷。⛔ 手改**不继承**：每个全新 quay-init 的项目都要重做，直到机制落地。

**这一步改变命题的范围，必须照实说**：e2e 于是证明的是「**配置妥当后**，目标项目自己的 drivers 能驱动出真实提交」，⛔ 不是「零配置开箱即用」。这是诚实的边界——任何真实消费者同样要配自己的模型栈。

**退役条件**：`gap-verify-coldstart-does-not-configure-target-profiles`（已立案，`goal_ac: AC-207`）把这一步固化进 `verify-deliver-coldstart.sh` 并落进证据之后，本段**连同这条人工步骤一并作废**——⛔ 不要在机制已生效后继续手工重复它。