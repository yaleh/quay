---
id: AC-909
title: 3 个纯判定函数各恰 1 个定义处（countAcCheckboxes / stripTrailingFullWidthAnnotation /
  expandGlob）
status: draft
kind: criterion
goal: GOAL-906
criterion: "for n in countAcCheckboxes stripTrailingFullWidthAnnotation
  expandGlob; do c=$(grep -rnE \"function ${n}\\b\" packages/quay/src
  plugin/scripts scripts --include='*.ts' 2>/dev/null | wc -l); if [ \"$c\" -ne
  1 ]; then echo \"$n has $c definitions (want 1)\" >&2; exit 1; fi; done; echo
  \"OK: 3 pure-judge functions each have exactly 1 definition\""
expect: 正向：countAcCheckboxes / stripTrailingFullWidthAnnotation / expandGlob 各恰
  1 个 `function NAME` 定义处（grep 按位置核对），且该定义落在 kernel/（或经 kernel/
  转发的单一真身），产品层与工具层消费方 import 该真身。反向（能取假）：在工具层再手写一份同名定义 ⇒ 判据红（该名字定义数 >1，且 stderr
  写出 cause）；删除 ⇒ 绿。只断言「每个名字各 1」不算总数（避免 3 份定义集中在同一个名字上）。
origin: 架构分析 G-1（detect_duplicates 实测
  countAcCheckboxes/stripTrailingFullWidthAnnotation/expandGlob 各双份）
---
