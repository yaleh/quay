---
id: gap-path-resolved-quay-version-not-in-driver-status
title: 版本读数缺"PATH 命中的 quay 是哪一版"——与注册表最新版、anchor 实际加载版并列报告，读不到报未评估
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
**机制**:`driver status`(`plugin/scripts/driver-runtime.ts`,约 2455 行起的 loaded-version 读数)已有两个量:anchor 实际加载的内核版本(取自 `/proc/<pid>/cmdline`)与注册表里的已安装版本,二者给出 current/behind/ahead/not-evaluated。**缺第三个量**:执行 `quay` 命令时 PATH 实际命中的是哪一版(`command -v quay` 的 realpath 所在版本目录)。2026-10-05 实测:本机会话 PATH 里冻结着 `cache/quay/quay/0.11.0/bin`,`which -a quay` 第一项是 0.11.0,而注册表已是 0.14.0——没有任何读数能显示这一点。

**修法(方向)**:在 `driver status`(人类可读与 --json)中并列报告 `path_quay_version`:取 PATH 上第一个 `quay` 的 `readlink -f`,从其所在目录读该版本的 `VERSION` 文件(⛔ 不用 `quay --version`:它受 bundle 内嵌版本影响,见 gap-release-bundle-embeds-dev-version-after-stamp);与注册表所选条目比较,给 current/behind/ahead/`not-evaluated`。找不到 quay、解析失败或注册表读不出一律 `not-evaluated`,⛔ 不与 current 共用输出(硬规则 3b)。只报告,⛔ 不自动修复。

<!-- dedup-ref -->相关(追溯,非前置):gap-driver-status-loaded-vs-installed-version-drift(done,前两个量);gap-release-bundle-embeds-dev-version-after-stamp(本任务不依赖 `--version` 输出)。

## Touches
- `plugin/scripts/driver-runtime.ts`
- `plugin/test/driver-runtime-path-resolved-version.test.mjs`
- `tasks/gap-path-resolved-quay-version-not-in-driver-status.md`

## AC
- [x] 新测试 `plugin/test/driver-runtime-path-resolved-version.test.mjs` 用临时 PATH 夹具(两个伪造的版本目录各含 `bin/quay` 与 `VERSION`)与伪造注册表,断言:PATH 先命中旧版本目录而注册表选新版 ⇒ `path_quay_version` 为 behind 且带 `path: <realpath>`;命中与注册表一致 ⇒ current;PATH 上无 quay ⇒ `not-evaluated`;注册表读不出 ⇒ `not-evaluated`。`node --experimental-strip-types --test plugin/test/driver-runtime-path-resolved-version.test.mjs` 退出 0。**实测:node --experimental-strip-types --test plugin/test/driver-runtime-path-resolved-version.test.mjs ⇒ tests 7 / pass 7 / fail 0,退出 0;behind(AC1a)/current(AC1b)/PATH 上无 quay=not-evaluated(AC1c)/注册表读不出=not-evaluated(AC1d) 四态各自独立,且 AC1a 断言命中的 realpath == PATH 上第一个 quay(⛔ 非第二个)。**
- [x] 用例中版本来自该目录的 `VERSION` 文件而非 `bin/quay --version` 输出:夹具里让 `bin/quay --version` 打印与 VERSION 不同的值,读数仍取 VERSION(附实跑输出)。**实测:夹具 0.10.0 目录的 `bin/quay --version` 实跑输出 `9.9.9-fake`(≠ 该目录 VERSION 文件的 `0.10.0`);同一次 status --json 读 `path_quay_version_resolved="0.10.0"`(取 VERSION),判定 behind(基于 VERSION),⛔ 非 ahead(基于 9.9.9-fake)。测试内两条断言并存。**
- [x] 取假:把判定改成"总是 current"后,behind 用例红(附实跑输出)。**实测:把 pathQuayVersionReading 的 state 硬写为 "current"(单行 mutation,文件先 cp 备份)后重跑该文件 ⇒ AC1a(behind)红:`AssertionError: PATH 命中的旧版本 ⇒ behind … actual:"current"`,AC2/AC2b 同红(pass 4/fail 3/退出 1);cp 还原后文件 md5 与备份一致、7/7 绿。**
- [x] 读生产载体:在本机一个 PATH 带旧版本 quay 条目的 shell 里实跑 `driver status --kind worker --json`,读出 `path_quay_version: "behind"` 与命中的 realpath;读数原文贴进完成记录。**实测(2026-10-05,主检出 root=/data/home/yale/work/quay;PATH 前置 symlink→cache/quay/quay/0.11.0/bin/quay,注册表最高=0.14.0):`"installed":"0.14.0","installed_source":"registry","path_quay_version":"behind","path_quay":"/data/home/yale/.claude/plugins/cache/quay/quay/0.11.0/bin/quay","path_quay_version_resolved":"0.11.0","path_quay_version_relation":"loaded-older","path_quay_version_reason":null`;人可读形 `path_quay_version=behind:0.11.0:path=/data/home/yale/.claude/plugins/cache/quay/quay/0.11.0/bin/quay`。负控制(PATH 指向 0.14.0)=注册表版 ⇒ `"path_quay_version":"current","path_quay":"/data/home/yale/.claude/plugins/cache/quay/quay/0.14.0/bin/quay","path_quay_version_resolved":"0.14.0"`(DoD「PATH 干净 ⇒ current」)。**
- [x] `bash scripts/test.sh --for-task gap-path-resolved-quay-version-not-in-driver-status` 退出 0,且执行了 ≥1 个测试文件。**实测:本任务 Touches 解析 1/3(coverage 0.33<0.5)⇒ 无 --allow-thin 时 test.sh 以 `test-selection-thin` 选择器守卫退出 1(7 测全绿,退出 1 来自薄覆盖守卫而非测试失败);按 worker 驱动 fan-in 同款命令 `bash scripts/test.sh --for-task gap-path-resolved-quay-version-not-in-driver-status --allow-thin` ⇒ tests 7 / pass 7 / fail 0,退出 0,执行 ≥1 测试文件(含本任务新文件),scoped 静态闸全 PASS(concurrency-literal-check 等)。**

## DoD
真实落地:在一台 PATH 实际冻结着旧版本 quay 的真实 shell 上,`driver status` 读出 behind 并指出命中的版本目录;PATH 干净时读出 current。仅有 fixture 绿不算完成。