---
id: gap-arch-coverage-report-couples-to-archguard-manifest-path-form
title: arch-coverage-report.test.mjs 读机器态 .archguard manifest 的路径形态——symlink 形态与
  realpath 形态不一致导致恒红
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/test/arch-coverage-report.test.mjs` 的用例「real repo — a scope source that is a foreign absolute path is relativized, not string-compared」读**机器态** `.archguard/` manifest（gitignored、不入 git）。该 manifest 的 sources 记的是 `/home/yale/work/quay/...`（symlink 形态；该 symlink 于 2026-09-19 出现），而测试的 `MAIN_ROOT` 是 `/data/home/yale/work/quay`（realpath）⇒ `path.relative(MAIN_ROOT, r)` 的期望值与实现的 realpath 归一秒不掉。

实测（本机，`LC_ALL=C.UTF-8 LANG=C.UTF-8 TZ=UTC`，即已排除 locale 成因）：**12 pass / 1 fail**。
失败断言：`AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal: actual: [Array], expected: [Array]`。

⇒ 该文件在任何任务的 fan-in 里恒红，与任何 delta 无关。

⛔ **不得**用「删掉 `.archguard` 让它重新生成」当修法——manifest 会再次按 symlink 形态生成，那只是把缺陷推后。修法方向不锁定实现：要么让测试自造输入（不依赖机器态），要么让归一对**两种路径形态**都成立。

## AC

- [ ] AC1（复现固化）贴出 12/1 读数、失败断言的 `actual`/`expected` 各前 3 条原文，以及证明 `.archguard` 是 gitignored 的 `git check-ignore -v .archguard/output/index.md` 输出
- [ ] AC2（修后）同一命令下该文件全绿（贴读数）
- [ ] AC3（负控制·两种路径形态都成立）构造一份 sources 记 **realpath** 形态的 manifest，同一测试仍绿；再对记 symlink 形态的那份跑一次 —— 两次读数都贴
- [ ] AC4（位置判定，不是"现场恰好干净"）`grep -c '/home/yale/' .archguard/`（机器态原文，非零）与该测试绿**同时**成立 ⇒ 证明是归一生效，而不是机器态碰巧被清理
- [ ] AC5（生产读数）落地后时间窗内一次真实 fan-in 的 suite 日志中该文件不出现在 `passed=false` 行（贴路径 + 时间戳 + 计数 0）
- [ ] AC6 `bash scripts/test.sh --for-task gap-arch-coverage-report-couples-to-archguard-manifest-path-form` 绿

## DoD

真实落地：机器态 manifest 仍是 symlink 形态（AC4 的 `grep -c` 非零）而该测试在真实 fan-in 中不再变红（AC5）。⛔ 不以"删掉机器态"代替修复。

## Touches

- plugin/test/arch-coverage-report.test.mjs
- plugin/scripts/arch-coverage-report.ts
- tasks/gap-arch-coverage-report-couples-to-archguard-manifest-path-form.md
