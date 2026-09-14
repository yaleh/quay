---
id: AC-190
title: 反例检测器：声称长期保证却只有 task AC ⇒ 报红（位置判定——delivery-critical 新立案任务必须声明 goal_ac）
status: achieved
kind: criterion
goal: GOAL-007
criterion: >
  s=plugin/scripts/long-term-guarantee-goal-backed-check.ts

  if [ ! -f "$s" ]; then echo "AC-190 fail - 检查脚本不存在 $s" >&2; exit 1; fi

  if ! node --no-warnings --experimental-strip-types "$s"; then echo "AC-190
  fail - 真仓库上报红（应为绿），$s 未 exit 0" >&2; exit 1; fi

  if node --no-warnings --experimental-strip-types "$s"
  --inject-unbacked-fixture; then echo "AC-190 fail - 负控制未触发，注入未声明 goal_ac 的
  delivery-critical 任务后 $s 仍绿" >&2; exit 1; fi

  echo "双向负控制通过：真仓库绿、注入未声明 goal_ac 的新立案任务红"

  exit 0
expect: exit 0
origin: >-
  人 2026-09-07 就 GOAL-007 裁定方向【丁：不修，上移 goal 层】——承认 task 层判据是一次性的，

  把需要长期保证的东西显式上移为 goal 层 AC（那里 goal-driver 每轮已有再评估）。四条候选中甲被

  GOAL-007 自陈为不成立（「守与不守在记录上无法区分 ⇒ 硬规则⑨应造产物」）；乙只覆盖三例中的①

  （取值形态漂移），②是 abort 分支未覆盖、③是绕闸，都不是 fixture 与生产的取值不一致。


  这是丁的真正难点，也是人在裁定时点名的一条（选项预览逐字：「⚠ 这条是丁的真正难点——没有它，

  丁 与『什么都不做』在记录上同形」）。硬规则⑨：一条规则若「守」与「不守」在记录上无法区分，

  它就只能靠意志——该给它造产物。丁 若只有 AC-188 的一次性迁移和 AC-189 的散文纪律，第四条、

  第五条长期保证仍会默认停在 task 层，而没有任何红。


  判据要求双向负控制（硬规则③b：读不懂/未评估不得与合格同形；硬规则④：结构上不可能取假的量不是

  测量）：真仓库上必须绿，注入一条「只有 task AC 背书的长期保证」后必须红。--inject-unbacked-fixture

  是实现者必须提供的测试缝，⛔ 不接受只有单向断言的实现。


  ⚠ 实现注意：新增 plugin/scripts/*.ts 会触发三个注册闸（outline + capability-catalog + laydown，

  见 plugin/scripts/capability-catalog.sh 头注释）——实现任务的 ## Touches 必须同时列出这三处。


  干跑（2026-09-07）：脚本不存在，exit 1 ⇒ 今天取假。


  ⚠ 换形态（gap-long-term-guarantee-registry-hand-maintained，2026-09-09）：原实现枚举一张手维护的

  三项登记表，PASS 3/3 是按构造的绿——同一时刻带 delivery-critical 标签的任务 125 条、

  其中 120 条无 goal_ac（96%），手写表只覆盖 2.4%。这与 CORE_REFERENCED（手维护两项漏掉
  driver-runtime.ts）

  同一形态、同一周内第二次。本 criterion 改判据：位置判定（枚举 tasks/*.md 里带 delivery-critical 标签的

  任务，对【生效线 2026-09-09T00:00:00Z 之后新立案】者 fail-closed 要求 goal_ac 非空），存量（125/120）

  grandfathered 单独排期、不在本任务清。负控制缝 --inject-unbacked-fixture 语义随之改为「注入一条生效线后

  无 goal_ac 的 delivery-critical 任务」。
long-term: true
---
