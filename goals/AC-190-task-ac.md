---
id: AC-190
title: 反例检测器：声称长期保证却只有 task AC ⇒ 报红——没有它，丁 与「什么都不做」在记录上同形
status: achieved
kind: criterion
goal: GOAL-007
criterion: >
  s=plugin/scripts/long-term-guarantee-goal-backed-check.ts

  if [ ! -f "$s" ]; then echo "检查脚本不存在: $s"; exit 1; fi

  if ! node --no-warnings --experimental-strip-types "$s"; then echo
  "真仓库上报红（应为绿）"; exit 1; fi

  if node --no-warnings --experimental-strip-types "$s"
  --inject-unbacked-fixture; then echo "负控制未触发：注入「只有 task AC 的长期保证」后仍绿"; exit 1;
  fi

  echo "双向负控制通过：真仓库绿、注入未背书条目红"

  exit 0
expect: exit 0
origin: |-
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
---
