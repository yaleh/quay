---
id: AC-196
title: 四态返回：输出词表含 not-in-git 与 unchanged，旧 boolean 提交函数 = 0
status: achieved
kind: criterion
goal: GOAL-008
criterion: >-
  test -f packages/quay/src/store-commit.ts || { echo "AC-196 fail -
  packages/quay/src/store-commit.ts 不存在" >&2; exit 1; }

  grep -q 'not-in-git' packages/quay/src/store-commit.ts || { echo "AC-196 fail
  - packages/quay/src/store-commit.ts 词表缺 not-in-git" >&2; exit 1; }

  grep -q 'unchanged' packages/quay/src/store-commit.ts || { echo "AC-196 fail -
  packages/quay/src/store-commit.ts 词表缺 unchanged" >&2; exit 1; }

  test "$(grep -rl 'function commitGoalFileAfterWrite\|function
  commitMetaFileAfterWrite' packages/quay/src | wc -l)" -eq 0 || { echo "AC-196
  fail: legacy boolean commit functions
  commitGoalFileAfterWrite/commitMetaFileAfterWrite still present under
  packages/quay/src" >&2; exit 1; }
expect: 今天：store-commit.ts 不存在、旧 boolean 函数 2 个 ⇒ 红。落地后四态齐备、旧函数 0。
origin: SPEC §3 不可协商第 3 条 / 硬规则 3b。goal-store.ts:264 与 meta-store.ts:77 现在把「不在
  git 工作树」「内容没变所以跳过」「commit 真失败」三件事全部返回 false ——
  一个判定的输出词表若没有「未评估」这一态，它就无法区分「查过且合格」与「没查成」。
---
