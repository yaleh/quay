# quay CI runner image — the reproducible definition of the tokyo-alpha `test` job's host.
#
# Why this file exists (tasks/gap-ac282-runner-prereqs-already-present, GOAL-022 scope item 3
# 「自定义 runner 镜像消除重复装包」): the `test` job runs on an **ephemeral** self-hosted runner
# container. `gh-runner-quay.service` starts it with `--rm` + `ExecStartPre=docker rm -f` +
# `Restart=always` + `EPHEMERAL=true` ⇒ the runner registers, takes ONE job, exits, and systemd
# starts a fresh container **from the same image** ~5s later. Anything installed inside the job is
# discarded with the container, so the `Install suite runtime prerequisites` step in ci.yml
# re-installs PyYAML and tmux **on every single job**. Measured 2026-09-17: that step cost 8s out
# of a 30s target for the test job (26.7%).
#
# ⛔ The fix cannot live in the workflow: a step inside the job runs *after* the container was
# created, so it can never change what the next job starts from. The only place that eliminates
# the repeat cost is **the image itself** — which is what this file is.
#
# ⛔ The ci.yml provisioning step is deliberately KEPT (all its branches, including the apt/pip
# installs): it is the fail-closed guarantee for a runner whose image is not this one (a rebuild, a
# revert to `myoung34/github-runner:latest`, a second runner host). On this image it simply takes
# its no-op branch, which is what `.github/workflows/ci.yml`'s `__PREREQ__` markers record.
# `plugin/test/ci-runner-env-prereqs.test.mjs` asserts that recipe still exists.
#
# ── WHY THIS IMAGE BOOTS SYSTEMD (gap-ci-runner-container-needs-user-systemd) ────────────────────
# The release gate's `serve-own-scope` assertion requires the serve host to run in its own
# `quay-serve-*.scope`, which `quay server start` creates with `systemd-run --user --scope`. A
# container whose PID 1 is the runner ENTRYPOINT has **no user manager for root**, so that envelope
# can never be applied: the availability probe (`packages/quay/src/systemd-scope.ts`) fails with
# "Failed to create bus connection", serve silently falls back to the unwrapped spawn, and its
# cgroup reads `0::/` ⇒ the assertion FAILs **structurally**, not because the product is wrong.
# The fix is that PID 1 must be systemd, and the runner becomes a service inside the container.
#
# ── WHY THE BASE IS ubuntu-noble, NOT `latest` ──────────────────────────────────────────────────
# `latest` is Ubuntu 20.04 / **systemd 245**, and `systemd-scope.ts:228` passes
# `-p OOMPolicy=continue`. systemd 245 rejects that property on a SCOPE ("Unknown assignment:
# OOMPolicy=continue"), so the driver anchor refuses to start and release.yml fails at
# `Start the promotion + worker drivers`. The host is Ubuntu 24.04 / systemd 255, which accepts it.
# ⛔ This incompatibility was LATENT until the user-manager fix landed: before that, `systemd-run`
# failed outright and the product silently took its unwrapped fallback, so the property was never
# passed. Pinning the container's systemd to the host's version is what makes the CI gate measure
# the real target environment.
#
# ⛔ SIX MEASURED TRAPS (each cost a full debug cycle on 2026-10-10):
#   1. Overriding `CMD` is NOT enough — the base image's `ENTRYPOINT ["/entrypoint.sh"]` would
#      receive systemd as an ARGUMENT and run the runner entrypoint instead. Override `ENTRYPOINT`.
#   2. `ExecStart` MUST pass the runner command as ARGUMENTS. `/entrypoint.sh` ends with
#      `gosu runner "$@"`; with no args it execs NOTHING, the service exits every RestartSec, and
#      the runner never comes online (measured: `/actions/runners` total_count 0, "Succeeded"
#      every 5s). Same reason `WorkingDirectory=/actions-runner` is required — the entrypoint
#      invokes `./config.sh` relative to the runner directory.
#   3. `XDG_RUNTIME_DIR` is a HARD prerequisite — without it `systemd-run --user` reports
#      "Failed to create bus connection" even when the user manager is running. It is injected
#      through `/actions-runner/.env` (the runner's own job-environment mechanism), because the
#      unit's `Environment=` alone did not reach the runner process.
#      ⚠️ Corollary for anyone verifying by hand: a bare `docker exec … systemd-run --user …`
#      FAILS and looks like the fix did not work. Always pass `-e XDG_RUNTIME_DIR=/run/user/0`,
#      i.e. reproduce the service's real environment, or you will measure a false negative.
#   4. `PassEnvironment` must carry the CONTAINER's whole environment, not just the project vars.
#      A systemd service starts minimal, so `HOME`/`HOSTNAME`/`PATH`/`LANG`/`LANGUAGE`/`LC_ALL`/
#      `DEBIAN_FRONTEND` that `docker run` provided implicitly are GONE unless forwarded —
#      measured: a workflow step died on `HOME: unbound variable` under its own `set -u`
#      (release run 38022095383), and the locale vars matter to this suite independently.
#   5. On noble, root's user manager needs two extra things or `user@0.service` fails outright:
#      `libpam-systemd` (otherwise `PAM unable to dlopen(pam_systemd.so)`) and a drop-in setting
#      `XDG_RUNTIME_DIR` ("Trying to run as user instance, but $XDG_RUNTIME_DIR is not set").
#
# The container also needs cgroup access: the unit passes `--cgroupns=host`,
# `-v /sys/fs/cgroup:/sys/fs/cgroup:rw`, tmpfs /run,/tmp, and `--cap-add SYS_ADMIN/SYS_CHROOT/MKNOD`
# (⛔ `--privileged` is NOT required — measured).
#
# Build + deploy (tokyo-alpha; GOAL-022 pins development to boheidc, so the host-side action is
# runner deployment only):
#   docker build -t quay-ci-runner:sysd .github/runner
#   # then point gh-runner-quay.service's ExecStart at that tag (one line), daemon-reload, restart,
#   # and check `gh api /repos/yaleh/quay/actions/runners` still shows tokyo-alpha-1 online.
#   # ⚠️ After a restart the runner can sit `offline` for ~2 minutes with "A session for this runner
#   #    already exists" / "Conflict. Retrying until reconnected" — that is the PREVIOUS container's
#   #    session draining, and it clears itself. Do not "fix" it.
#   # Acceptance for THIS change specifically (all measured, not inferred):
#   #   docker exec -e XDG_RUNTIME_DIR=/run/user/0 gh-runner-quay \
#   #     systemd-run --user --scope --quiet -p OOMPolicy=continue -p MemoryAccounting=yes \
#   #                 --unit=quay-anchor-probe true            → rc=0
#   #   docker exec -e XDG_RUNTIME_DIR=/run/user/0 gh-runner-quay \
#   #     systemd-run --user --scope --quiet -p MemoryAccounting=yes true   → rc=0
#   #   a scope's /proc/<pid>/cgroup ends in `…/user@0.service/quay-serve-*.scope`
#
# procps (ps/pgrep) is already in the base image, but it is named explicitly anyway: a base-image
# bump must not silently drop an undeclared prerequisite of the suite (full-suite-runner.ts reads
# `pgrep -c -f 'full-suite-runner\.ts'`, and the process-reaper tests read `ps`).
FROM myoung34/github-runner:ubuntu-noble

RUN apt-get update -qq \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends \
      python3-yaml \
      tmux \
      procps \
      systemd-sysv \
      dbus \
      libpam-systemd \
 && rm -rf /var/lib/apt/lists/*

# ── BUILD-TIME PREREQUISITE ASSERTIONS (AC2) ─────────────────────────────────────────────────────
# Fail the BUILD — not a future job — if a prerequisite did not actually land. A build that succeeds
# while the image is missing a prerequisite reproduces exactly the failure mode this file exists to
# remove: a pile of environment-shaped step failures that read as product defects (and, for the scope
# envelope, a STRUCTURALLY red release gate — see the triage table in
# tasks/gap-ci-runner-container-needs-user-systemd.md).
#
# ⛔ `systemd-run --user` ITSELF cannot be exercised here: it needs a RUNNING user manager, which
# needs systemd as PID 1, which exists only once the container is started. Each assertion below and
# in the second block (just before ENTRYPOINT) is therefore the strongest *buildable* proxy for its
# runtime prerequisite; the runtime reading is AC1. The template is the pre-existing
# `command -v tmux/pgrep/ps` group; this extends it to the four gaps this file fixes (p1..p4).
#
# p1 (user manager) and p3 (systemd version) are asserted here; p2 (env forwarding / XDG plumbing)
# and p4 (tool cache) read files the later RUN steps create, so they are asserted after those steps.
RUN set -eux; \
    python3 -c 'import yaml; print("PyYAML", yaml.__version__)'; \
    command -v tmux; \
    command -v pgrep; \
    command -v ps; \
    command -v systemd-run; \
    command -v dbus-daemon; \
    systemctl --version; \
    test "$(systemctl --version | head -n1 | awk '{print $2}')" -ge 255

# Trap 5: root's user manager must be able to start. The stock `10-login-barrier.conf` also waits on
# a logind a container does not have; the stock `$XDG_RUNTIME_DIR` handling refuses to run without it.
RUN mkdir -p /etc/systemd/system/user@0.service.d \
 && printf '%s\n' \
      '[Service]' \
      'Environment=XDG_RUNTIME_DIR=/run/user/0' \
      > /etc/systemd/system/user@0.service.d/20-xdg-runtime.conf

# The runner becomes a systemd service: PID 1 is systemd (see ENTRYPOINT below), so the runner can
# no longer be the container's entrypoint. `PassEnvironment` carries the whole container environment
# (trap 4); `XDG_RUNTIME_DIR` is the user-manager location the scope envelope needs (trap 3).
RUN printf '%s\n' \
      '[Unit]' \
      'Description=GitHub Actions runner (yaleh/quay)' \
      'After=network-online.target user@0.service' \
      'Wants=network-online.target user@0.service' \
      '[Service]' \
      'Type=simple' \
      'Environment=XDG_RUNTIME_DIR=/run/user/0' \
      'PassEnvironment=HOME HOSTNAME PATH LANG LANGUAGE LC_ALL DEBIAN_FRONTEND REPO_URL ACCESS_TOKEN RUNNER_NAME RUNNER_WORKDIR LABELS EPHEMERAL DISABLE_AUTO_UPDATE AGENT_TOOLSDIRECTORY' \
      'WorkingDirectory=/actions-runner' \
      'ExecStart=/entrypoint.sh ./bin/Runner.Listener run --startuptype service' \
      'Restart=always' \
      'RestartSec=5' \
      '[Install]' \
      'WantedBy=multi-user.target' \
      > /etc/systemd/system/gh-runner.service \
 && systemctl enable gh-runner.service >/dev/null 2>&1 || true

# Container-hostile units: they only add noise/failures under a container PID 1.
RUN systemctl mask systemd-udevd.service systemd-udev-trigger.service getty@tty1.service \
      systemd-modules-load.service systemd-remount-fs.service >/dev/null 2>&1 || true

# Trap 6: `RUNNER_TOOL_CACHE` must be set EXPLICITLY. The base sets AGENT_TOOLSDIRECTORY to
# /opt/hostedtoolcache and creates that directory (runner-owned) — but it ships it EMPTY: measured
# 2026-10-10, `ls /opt/hostedtoolcache/node/` is "No such file or directory" on the base image AND
# on the built quay-ci-runner image, i.e. there is no baked toolchain here to find. What the runner
# does export to jobs is AGENT_TOOLSDIRECTORY, not RUNNER_TOOL_CACHE, so `actions/setup-node` fell
# back to its own default (/_work/_tool — per-job, discarded with the ephemeral container) and
# DOWNLOADED node every job: measured release run 38023497714 the download stalled ("Acquiring
# 24.21.0 … aborted", 7 min), retried, and the job was cancelled at its 25-minute timeout with every
# remaining step skipped. Pointing RUNNER_TOOL_CACHE at /opt/hostedtoolcache instead makes the action
# use the runner-owned cache directory — on the runner HOST that path persists across the ephemeral
# container rotation, which is what removes the per-job download. (That persistence is a property of
# `gh-runner-quay.service`'s mount on the host, NOT of this image — a fresh container from this image
# has an empty cache, so do not read this as "the image bakes node". AC1's `.complete` reading is
# therefore a HOST reading.)
RUN mkdir -p /etc/systemd/system/gh-runner.service.d \
 && printf '%s\n' \
      '[Service]' \
      'Environment=RUNNER_TOOL_CACHE=/opt/hostedtoolcache' \
      > /etc/systemd/system/gh-runner.service.d/30-toolcache.conf

# The runner's OWN job-environment injection point (KEY=VALUE lines are added to every job step's
# environment). This is what actually reaches the job with XDG_RUNTIME_DIR — see trap 3.
RUN printf '%s\n' 'XDG_RUNTIME_DIR=/run/user/0' >> /actions-runner/.env

# ── BUILD-TIME STRUCTURAL ASSERTIONS (AC2, cont.) ────────────────────────────────────────────────
# Same rationale as the first assertion block; these read the unit files / drop-ins / `.env` the RUN
# steps above created, so they must run AFTER them. Each `grep -q` names the exact line its creating
# RUN writes — edit one of those RUNs to drop a prerequisite and the BUILD fails here, rather than
# the release gate failing later in a way that reads as a product defect. 能取假: the predicates test
# specific file CONTENT, so deleting the corresponding RUN turns each into a hard build failure.
#   p1 — the PAM module root's user manager dlopens (else "PAM unable to dlopen(pam_systemd.so)"),
#        the XDG_RUNTIME_DIR drop-in without which `user@0.service` refuses to start (trap 5), and the
#        PID-1 systemd binary the ENTRYPOINT names.
#   p2 — the runner unit forwards the container's whole environment (trap 4), starts in the runner
#        directory WITH an argument (trap 2), and `.env` carries XDG_RUNTIME_DIR to the job (trap 3).
#   p4 — the tool cache dir the base creates is present, and the drop-in points RUNNER_TOOL_CACHE at
#        it (trap 6). ⛔ This asserts the IMAGE-controlled facts only: measured 2026-10-10, the base
#        ships `/opt/hostedtoolcache` EMPTY (no node/<v>/x64, no `.complete`) — tools there are a
#        property of the runner HOST (the path is persisted across the ephemeral containers), so a
#        fresh `docker build` CANNOT assert them and this RUN deliberately does not.
RUN set -eux; \
    ls /usr/lib/*/security/pam_systemd.so >/dev/null; \
    grep -q '^Environment=XDG_RUNTIME_DIR=/run/user/0$' /etc/systemd/system/user@0.service.d/20-xdg-runtime.conf; \
    test -x /lib/systemd/systemd; \
    grep -q '^PassEnvironment=.*HOME' /etc/systemd/system/gh-runner.service; \
    grep -q '^PassEnvironment=.*PATH' /etc/systemd/system/gh-runner.service; \
    grep -q '^WorkingDirectory=/actions-runner$' /etc/systemd/system/gh-runner.service; \
    grep -q 'Runner\.Listener run' /etc/systemd/system/gh-runner.service; \
    grep -q '^XDG_RUNTIME_DIR=/run/user/0$' /actions-runner/.env; \
    test -d /opt/hostedtoolcache; \
    grep -q '^Environment=RUNNER_TOOL_CACHE=/opt/hostedtoolcache$' /etc/systemd/system/gh-runner.service.d/30-toolcache.conf

ENTRYPOINT ["/lib/systemd/systemd"]
