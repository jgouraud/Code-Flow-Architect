# DOCKER.DEPLOY — remote SSH, rollout and recovery

- **DOCKER.DEPLOY1 M** Identify the exact target Docker context/daemon, Compose project, SSH identity/host-key trust, registry and network exposure before *any* remote change. Docker daemon access is highly privileged.
- **DOCKER.DEPLOY2 M** Use verified SSH host keys (`known_hosts` or managed SSH host CA), no unattended `StrictHostKeyChecking=no`. Avoid trace/debug output (`set -x`) around secrets or credential-bearing command lines.
- **DOCKER.DEPLOY3 M** For a remote Docker daemon, host bind-mount paths must exist **on the remote daemon host**. Copy approved Nginx config and secrets safely or use immutable/config-managed mounting; verify ownership, permissions and exact content before rollout.
- **DOCKER.DEPLOY4 M** Treat image distribution (registry pull vs `docker save/load` through the remote daemon) as an explicit choice. Verify digests and platform compatibility, not merely mutable tags. A local tar archive being read by a remote Docker API client is not by itself a pushed registry image.
- **DOCKER.DEPLOY5 M** Validate configuration and backups first, stage new images/config, apply only requested services, preserve volumes, smoke-test gateway/auth/private-app paths, and keep a tested previous version for rollback. A full `docker compose down` causes avoidable downtime and should not be routine when reconciliation can suffice.
- **DOCKER.DEPLOY6 M** Never use an unbounded retry loop for `compose down`, blindly prune remote images globally, or delete other services' resources as a deploy cleanup step. Bound retries and inspect the impact of `--remove-orphans` and any prune command.
- **DOCKER.DEPLOY7 M** Distinguish a changed Dockerfile (rebuild required), changed Compose settings (`up` reconciliation), and process restart (`restart` only); check service readiness/health rather than assuming `depends_on` means ready.
- **DOCKER.DEPLOY8 M** Verify real user-path authorization and HTTP reachability after rollout, not just running container status. Define alerting, stop criteria, old image/config recovery, DB/volume compatibility and backout limits.
- **DOCKER.DEPLOY9 S** Where possible, prefer controlled registry-based deployment and minimal authorized SSH/CI permissions over ad hoc full-engine shell scripts. Retain existing toolchain only when it passes equivalent safety checks; do not force a platform migration in a narrow patch.

**Safe observation (read-only when run on confirmed target):**

```sh
docker context show
docker compose config -q
docker compose ps -a
docker compose logs --tail 100 gateway auth frontend
# check nginx -t using the deployed config/image, and inspect registry digest
# (no mutating commands without approval)
```

Reference: https://docs.docker.com/engine/security/protect-access/ and the uploaded SSH deployment script.
