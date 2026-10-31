---
id: -h
status: ready
labels: []
parent: null
children: []
extra: {}
---
## Finding

The `-h` task is a spurious task object: a CLI `-h` help flag was interpreted as a task id and materialized as `tasks/-h.md` with an empty body. It therefore carried no recognized shape and no self-touch grant, failing the todo→ready gate.

## AC

- `tasks/-h.md` carries a recognized finding shape (`## Finding`, `## AC`, `## DoD`).
- `## Touches` lists `tasks/-h.md` as its own self-touch entry, without a `(new)` tag.

## DoD

- Running the promotion gate over `-h` reports `fourArtifacts: true` and `selfTouchOk: true`.

## Touches

- `tasks/-h.md`