---
id: AC-917
title: 按职责断环：server-state.ts 下沉到 core/，根包不再 import ./serve/，observation 子模块不再回指根包模块
status: draft
kind: criterion
goal: GOAL-910
criterion: 'if [ ! -f packages/quay/src/core/server-state.ts ] || [ -e
  packages/quay/src/serve/server-state.ts ]; then echo "CAUSE=server-state.ts
  must live in packages/quay/src/core/ (shared runtime carrier), not in serve/"
  >&2; exit 1; fi; a="$(grep -lE "from .\./serve/" packages/quay/src/*.ts
  2>/dev/null | wc -l || true)"; if [ "$a" -ne 0 ]; then echo "CAUSE=$a
  root-level file(s) under packages/quay/src still import ./serve/ (want 0)"
  >&2; exit 1; fi; b="$(grep -nE "from .\.\./[A-Za-z0-9_-]+\.ts"
  packages/quay/src/observation/*.ts 2>/dev/null | wc -l || true)"; if [ "$b"
  -ne 0 ]; then echo "CAUSE=$b import(s) in packages/quay/src/observation/ still
  reach a root-level module via ../X.ts (want 0: import core/ or kernel/)" >&2;
  exit 1; fi; echo "OK: server-state in core/, root imports no ./serve/,
  observation reaches no root module"'
expect: 本条防止用错误的方式断环（例如把 goal-preview.ts 也搬进
  serve/：环同样会消失，但职责更乱）。正向：①packages/quay/src/serve/server-state.ts 移到
  packages/quay/src/core/server-state.ts——它是统一服务进程的运行时状态载体，被根包（goal-preview.ts、loaded-version.ts）、cli/、serve/
  与 plugin/scripts 共用，自身只依赖 kernel/write-json-atomic.ts 与 node 内置模块，满足 core
  的叶子约束；②packages/quay/src 根目录下不再有文件 import
  ./serve/；③packages/quay/src/observation/*.ts 不再以 ../X.ts 引用根目录模块——../abi.ts 的
  TaskStatus/TASK_STATUS 改为 ../core/types.ts，../start-end-like.ts 下沉到
  kernel/（它没有任何 import）。反向（能取假）：立案当轮 exit 1，stderr 为 `CAUSE=server-state.ts must
  live in packages/quay/src/core/ …`；三个子谓词都对已知命中样本干跑过：根包命中
  goal-preview.ts、loaded-version.ts 两个文件，observation 命中 4
  处（model.ts:14、events.ts:13、blocking.ts:11、liveness.ts:20）。
origin: 架构分析会话 2026-10-22：环的两条成因边（root→serve 经 server-state.ts；observation→root
  经 abi.ts / start-end-like.ts）按职责定位；人当轮批准立案
---
