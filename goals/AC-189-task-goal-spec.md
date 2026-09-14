---
id: AC-189
title: 「task 层判据是一次性的、需长期维持的保证必须上移 goal 层」写进 SPEC 正本（按位置可查）
status: achieved
kind: criterion
goal: GOAL-007
criterion: >
  f=orchestration/SPEC-goal-mechanism-2026-09-06.md

  sec=$(awk '/^##.*task 层判据/{g=1;next} g&&/^##/{exit} g' "$f")

  if [ -z "$sec" ]; then echo "AC-189 fail - 章节不存在 $f" >&2; exit 1; fi

  printf '%s' "$sec" | grep -q '上移' || { echo "AC-189 fail - 章节未写上移" >&2; exit
  1; }

  printf '%s' "$sec" | grep -q 'goal 层' || { echo "AC-189 fail - 章节未点名 goal 层"
  >&2; exit 1; }

  n=$(printf '%s' "$sec" | tr -d '[:space:]' | wc -c)

  echo "章节非空白字符数: $n"

  [ "$n" -ge 200 ] || { echo "AC-189 fail: 章节非空白字符数 $n -lt 200" >&2; exit 1; }
expect: exit 0
origin: >-
  人 2026-09-07 就 GOAL-007 裁定方向【丁：不修，上移 goal 层】——承认 task 层判据是一次性的，

  把需要长期保证的东西显式上移为 goal 层 AC（那里 goal-driver 每轮已有再评估）。四条候选中甲被

  GOAL-007 自陈为不成立（「守与不守在记录上无法区分 ⇒ 硬规则⑨应造产物」）；乙只覆盖三例中的①

  （取值形态漂移），②是 abort 分支未覆盖、③是绕闸，都不是 fixture 与生产的取值不一致。


  丁 若只作为一次口头选择，下一个人仍会默认「task AC 已绿 = 长期有保证」。GOAL-007 的层级不对称段

  逐字记录了根因：goal 层每轮（约 42 秒）对每条 active AC 跑 gateCriterion 并报 achieved-but-failing，

  task 层的 extra.acceptance 只在 fan-in 当轮跑一次、此后再不重跑，「能取假」的负控制当轮验证一次即

  被丢弃。这条不对称必须进正本，否则它只活在一次对话里。


  落点选 orchestration/SPEC-goal-mechanism-2026-09-06.md（goal 机制正本）而非
  CLAUDE.md——后者头部

  逐字写着「它的行数是本仓库最稀缺的资源」「只放指针与不随代码过期的纪律」，本条属于机制细节，

  放进去就是制造漂移。


  判据按位置：awk 取 ^## 且含「task 层判据」的章节，要求其正文同时出现「上移」与「goal 层」、

  非空白字符 ≥200（⛔ 一个标题加一句话不算正本条目）。


  干跑（2026-09-07）：章节不存在，exit 1 ⇒ 今天取假。
long-term: true
---
