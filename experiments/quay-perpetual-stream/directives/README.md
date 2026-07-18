# directives/ — exp5 async human-steering inbox

This is the **asynchronous human input inbox** for quay-perpetual-stream (protocol §4.7).

- `/quay-directive` writes here (`pending/DIR-NNN-<slug>.md`). The skill auto-detects this experiment
  as the active one and writes the directive; it does not commit.
- The OUTER-LOOP **drains `pending/` at each milestone boundary** (cycle step 0): each directive is
  dispositioned into a `../backlog.md` milestone candidate, a standing-rule amendment
  (`../inherited-core.md` / `../dashboard.md` control-limits), or an out-of-cycle action (VT chart
  transition, HALT), then moved to `archive/`.
- It **never perturbs an in-flight inner milestone** — steering takes effect at the boundary only.
  Urgent structural breaks use the `.halt` sentinel (abort) instead.

File format is inherited verbatim from `../../quay-native-bootstrap/directives/README.md`. DIR
numbering is **per-experiment and fresh** — exp5's DIR-001 is unrelated to any other experiment's.

This inbox→queue split is not the DIR-006 dual-representation anti-pattern: `pending/` is a transient
inbox (drained then archived); `backlog.md` is the durable curated milestone queue.
