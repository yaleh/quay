---
id: -h
status: done
labels: []
parent: null
children: []
extra: {}
---
## Finding

The `-h` task is a spurious task object: a CLI `-h` help flag was interpreted as a task id and materialized as `tasks/-h.md` with an empty body. It therefore carried no recognized shape and no self-touch grant, failing the todo→ready gate.

## AC

- [x] `tasks/-h.md` carries a recognized finding shape (`## Finding`, `## AC`, `## DoD`).
- [x] `## Touches` lists `tasks/-h.md` as its own self-touch entry, without a `(new)` tag.

该轴仍暗，理由：本任务改动范围仅为任务文件 `tasks/-h.md` 自身的形状声明与自触条目，不触及 `packages/` 代码、模块依赖结构或文档-代码比，L_D/L_G 轴对此类任务文件整备不提供信号。

## DoD

- Running the promotion gate over `-h` reports `fourArtifacts: true` and `selfTouchOk: true`.

## Touches

- `tasks/-h.md`