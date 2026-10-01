---
id: AC-316
title: fan-in/suite 调度面上按 scripts/test.sh 是否存在推断「本仓库形态」的调用点 = 0（静态枚举，按代码位置判定）
status: active
kind: criterion
goal: GOAL-027
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED: 不在
  git 仓库内" >&2; exit 3; }

  cd "$root"

  pred='\bhasTestSh\(|existsSync\([^)]*test\.sh'

  # 谓词正控：对两条已知为真的样本必须命中 2 条，对注释样本命中 0 条（硬规则 2 两半）

  n_pos=$(printf '%s\n' 'function hasTestSh(dir: string): boolean {' '  if
  (!fs.existsSync(path.join(root, "scripts", "test.sh"))) {' | grep -cE "$pred")

  [ "$n_pos" = 2 ] || { echo "NOT-EVALUATED: 谓词对已知样本命中 $n_pos/2" >&2; exit 3; }

  # 面：第三方项目的 driver 在 fan-in / suite 调度上实际执行的模块

  set -- plugin/scripts/worker-fan-in.ts plugin/scripts/worker-driver.ts
  plugin/scripts/full-suite-runner.ts plugin/scripts/suite-driver.ts
  packages/quay/src/fan-in

  for f in "$@"; do [ -e "$f" ] || { echo "NOT-EVALUATED: 面文件缺失
  $f（被改名/拆分？先更新本判据的面）" >&2; exit 3; }; done

  hits=$(grep -rnE "$pred" "$@" --include='*.ts' | grep -vE '\.test\.' | grep
  -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*)' | while IFS= read -r l; do
  code=$(printf '%s' "${l#*:*:}" | sed -E 's#[[:space:]]//.*$##'); printf '%s'
  "$code" | grep -qE "$pred" && printf '%s\n' "$l"; done)

  n=$(printf '%s\n' "$hits" | grep -c .)

  if [ "$n" -gt 0 ]; then
    { echo "CAUSE=fan-in/suite 调度面上仍有 $n 处按 scripts/test.sh 是否存在推断「本仓库形态」（前 3 条）："; printf '%s\n' "$hits" | head -3 | cut -c1-200; } >&2; exit 1
  fi

  echo "OK: fan-in/suite 调度面上按文件存在推断仓库形态的调用点 = 0"
expect: exit 0（worker-fan-in / worker-driver / full-suite-runner / suite-driver
  / packages/quay/src/fan-in 中 hasTestSh( 或 existsSync(…test.sh) 的非注释命中 =
  0）；面文件缺失 ⇒ exit 3
origin: 立条依据：2026-09-23 对第三方项目
  /data/home/yale/work/claudecodeui（CloudCLI，2026-09-20→09-23，worker-driven
  inner，142 条任务）的驱动过程复盘。人 2026-09-23 裁定：「本仓库形态靠文件是否存在来判断」立为 goal，第 1/2/6 项作为其实例
  task，其余缺陷立独立 task（「按你的意见执行」）。 对应 GOAL-027 范围①。
activatedAt: 2026-10-01T18:04:57.816Z
statusLog:
  - at: 2026-10-01T18:04:57.816Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-01T18:04:57.816Z
---
**判据（能取假）**：在第三方 driver 于 fan-in / suite 调度上实际执行的模块中，按代码位置（不含注释）枚举 `hasTestSh(` 与 `existsSync(…test.sh…)`，命中数必须为 0。

**取假**：落笔当轮在真实仓库上 exit 1，点名 5 处（`worker-fan-in.ts:66/150/177` 等）。夹具负控：去掉调用 ⇒ exit 0；加回一处 ⇒ exit 1；行尾注释里提到不算命中；面文件缺失 ⇒ exit 3。

**已知局限**：谓词是字面形态。若把同一种推断改名成别的函数，本判据会漏检；承载 task 的 AC 必须同时要求契约键被真正读取（config-key-consumer-check），并删除 `hasTestSh`，而不是给它改名。