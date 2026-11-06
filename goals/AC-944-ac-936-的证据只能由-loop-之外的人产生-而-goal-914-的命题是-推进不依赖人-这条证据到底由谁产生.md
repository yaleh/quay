---
id: AC-944
title: AC-936 的证据只能由 loop 之外的人产生，而 GOAL-914 的命题是「推进不依赖人」——这条证据到底由谁产生？ — 退出条件
status: draft
kind: criterion
goal: GOAL-915
criterion: "/data/home/yale/.nvm/versions/node/v24.21.0/bin/node --no-warnings
  --experimental-strip-types /data/home/yale/work/quay/packages/quay/bin/quay.ts
  goal get GOAL-915 --store --root /data/home/yale/work/quay | grep -Eq
  '\"status\": \"(active|superseded)\"' || { echo 'GOAL-915 仍未裁定（draft）—— 认可某选项
  ⇒ goal write GOAL-915 --status active；否决 ⇒ --status superseded' >&2; exit 1;
  }"
expect: 该决策已被裁定：GOAL-915 离开 draft（active = 认可某选项；superseded = 否决）。draft 期间判据为假并写出成因。
origin: |-
  【要裁定什么】AC-936 判据要求主检出 `.quay/goal-requests.jsonl` 里存在一条被 driver 消费的终态请求；但 GOAL-914 的命题恰是「goal 推进不再依赖人读 round fact / 人写任务」。worker 的写守卫禁止把主检出当归档写目标，goal-driver 又不能自产（自产即废掉判据的可取假性）。GOAL-914 要走到退出条件，这三条路选哪一条？
  【选项与代价】① 人在主检出跑一次真实请求 `quay goal request GOAL-914 AC-936 --reason ...`，下一轮 goal-driver 消费即转绿（成本=一次人工动作，证据仍由外部真实请求产生、仍可取假；代价是 GOAL-914 的收尾永久系在人手上）；② 让 goal-driver 在 world-gated 分支自己 append 一条 `requested-by:driver` 的请求行（成本=该载体从此分不清真外部请求与自产请求，AC-936 结构上再也取不了假，且与 AC-938/AC-941 刚立的『绿必须来自落地后的生产写入』直接相抵）；③ 放宽 AC-936 判据接受任意 root（含 worktree）的证据（成本=直接撤回 AC-938/AC-941 建立的生产载体纪律，同一份判据自己否定自己的否证条件）
  【实测依据】criteria.AC-936.verdict = "fail"（meta-driver 机械采集于 2026-11-06T21:14:07Z）
  【为什么不能机械决定】机器不能自决：①②③ 的差别不是实现选择，而是『这条判据还要不要能取假』——选 ② 或 ③ 会让一条判据从此恒真，而恒真的读数等于没有测量（硬规则 4），这类撤回只能由人作出。该问题已于 2026-11-06T20:12:19Z 由上一轮 meta-driver 以 needs-human 任务立案过一次（`tasks/gap-meta-call-ac-936-needs-a-human-run-goal-request-in.md`），但该任务在 21 分钟内被三个不同的短命 CLI 进程从 `needs-human` 退回 `todo` 三次（commit `7e24d0395` / `99fc96141` / `f88a7d3a8`，每次 diff 只有 `status` 一行），现以 `todo` + 行首 `PARKED` 停放——它既不在待派池里，也不出现在任何按 `status: needs-human` 过滤的人读面上。⇒ 同一问题改由 draft GOAL 面（`/goal?status=draft`）承载：goal 记录不经过 promotion/worker 的 status 写路径，那条通道退不掉它；⛔ 不是再造一条同形任务。GOAL-914 自身「范围」节把 AC-936 写成『至少一条真实请求被 driver 消费』，而「命题」节写的是推进不应依赖人——这两句在同一份记录里互相抵触，落败的一方需要被就地更正。
  【怎么关闭】认可某个选项 ⇒ goal-store write <id> --status active；否决 ⇒ 保持 draft 或标 superseded。
---
