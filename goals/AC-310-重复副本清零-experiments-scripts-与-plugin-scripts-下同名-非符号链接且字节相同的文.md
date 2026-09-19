---
id: AC-310
title: 重复副本清零：experiments/…/scripts 与 plugin/scripts 下同名、非符号链接且字节相同的文件对 = 0（由
  sh-census-check 读出）
status: achieved
kind: criterion
goal: GOAL-025
criterion: |
  f=plugin/scripts/sh-census-check.ts
  [ -f "$f" ] || { echo "CAUSE=checker-missing — $f 不存在，本量无法读取（不是 0）" >&2; exit 1; }
  node --experimental-strip-types "$f" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.exit(j.evaluated===true&&j.totals&&j.totals.duplicateCopies===0?0:1)}catch(e){process.exit(1)}})' || { echo "CAUSE=duplicate-copies-nonzero-or-not-evaluated — experiments/ 与 plugin/ 仍有非符号链接的字节相同副本，或检查器未评估" >&2; exit 1; }
expect: exit 0（sh-census-check --json 的 evaluated===true 且
  totals.duplicateCopies===0）。失败时 exit 1 且 stderr 携带 CAUSE=…；⛔ echo … >&2 与 exit
  1 写在同一行。检查器不存在/未评估时同样 exit 1（不是 0）。
origin: SPEC-architecture-consolidation-ts-and-shell-2026-09-19 §1.3 S2 / §8-③，人
  2026-09-19 裁定：「先改成符号链接过渡,棘轮清零后再决定是否删除」。实测（cmp
  逐个，2026-09-19）：experiments/…/scripts 共 124 个文件，22 个符号链接、38 个非链接且与
  plugin/scripts 同名文件字节相同（含 gate-script-base.ts 23KB）。副本可被重新复制出来，故
  long-term:true。
activatedAt: 2026-09-19T05:29:25.892Z
statusLog:
  - at: 2026-09-19T11:37:06.219Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
long-term: true
---
**范围**：把 38 个非链接字节相同副本改为指向 `plugin/scripts/` 对应文件的符号链接；另有 2 对同名但内容有差异者，先逐个核对、取权威版本再处理。**不删除**（人裁定：先过渡；是否删除待本条清零后另行裁定）。

**前置**：`gap-arch-sh-census-check` 落地。

**注意**：experiments 目录里有悬空符号链接，读取脚本会直接报错——处理时按 realpath 去重，不要被它绊住。