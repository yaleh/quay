# Provenance — `spec-reporter-suite-log-bda3e2.txt`

**Read-only historical fixture. Do not regenerate, trim, or "clean up" this file.**

`spec-reporter-suite-log-bda3e2.txt` is a byte-for-byte copy of one failing-block excerpt from a
production suite log produced by **quay-fleet**, a separate project which was retired on 2026-10-12
(re-initialized as an unrelated AI Engineering Manager project; its README states the old snapshot is
*"仅作只读参考，不恢复、不迁移代码"*). That project is **not** a dependency of this repo: nothing reads
it, nothing resolves a path into it, and the paths inside the captured text are part of the *captured
bytes*, not pointers this repo follows.

It is kept because the parser it exercises must handle real `spec` reporter output, and a hand-written
sample would only prove that the parser handles what its author imagined. The consumer is
`plugin/test/worker-fan-in-spec-attribution.test.mjs` ("AC3 real replay"), which pins the file's
**md5 = `0387353af971e669e7c544ff895d6b8c`** precisely so that the "this is a real capture, not a
simulation" claim stays measurable. Editing this file silently breaks that proof.

If the fixture is ever deliberately re-captured, update the md5 assertion in that test in the same
commit and say why — otherwise the reading becomes "a fixture that asserts nothing".

Related: `packages/quay/src/primitives/PROVENANCE.md` records the same retired project's one other
trace in this repo (the four session primitives, since made canonical here).
