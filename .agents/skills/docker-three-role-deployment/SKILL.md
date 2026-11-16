---
name: docker-three-role-deployment
description: Use for Docker Engine/Compose builds, image and data update jobs, protected web deployments, Nginx and OAuth2 Proxy gateways, OIDC/Entra sign-in, internal service networking, SSH-based Docker rollout, or deployment debugging. Apply the portfolio's preferred three-logical-role topology when relevant; do not force Docker into unrelated tasks.
---

# Docker three-role deployment — Codex specialist

**Scope:** Preferred deployment architecture for this repository family, not a command to deploy or a substitute for project requirements. Use with root `AGENTS.md`, `CORE.*` policies and (when appropriate) `backend-engineering`/`frontend-engineering`. Do not auto-run Docker, connect to SSH, change production state, copy secrets, or delete volumes. Plan first; execute only within the user's authorized environment and approvals.

## Preferred topology (three *logical* roles)

1. **Update/publish role:** one-shot or scheduled updater that refreshes versioned application data in durable storage; if the deliverable is a new *container image*, build a fresh immutable artifact and push a versioned tag/digest from an approved CI/build runner. Do **not** edit a running image/container as a publishing strategy or give an updater unfettered Docker socket access.
2. **Application/front-end role:** service listening on an internal container IP/port, discovered by Docker Compose service DNS. It must have **no public host-published port** when authentication is intended to guard access. Persistent input/output belongs in managed storage, not the container writable layer.
3. **Buffer/authentication/gateway role:** externally reached Nginx gate checks each protected request through an authentication service (typically OAuth2 Proxy with OIDC/Entra). On allowed responses it proxies to the private app; on unauthenticated browser requests it redirects to sign-in; on forbidden/error responses it denies safely. This role is often **two containers** (`gateway`, `auth`) plus an upstream corporate TLS reverse proxy: three roles do not imply exactly three containers.

## Required planning procedure

1. Inspect actual `compose.yaml`/`docker-compose.yml`, Dockerfiles, Nginx config, CI/SSH scripts, registry, volumes, secrets delivery, advertised host ports, external reverse-proxy boundary, and any repo-specific deployment instructions. Establish which public DNS name and host bind interface are *actually* trusted; no guessed IPs, ports, credentials or IdP policy.
2. Read `references/01-topology.md` for any deployment change; read only further relevant topics below. Cite `DOCKER.*` IDs in the plan. A Docker-related edit also loads `CORE.ARCH`, `CORE.KEY`, `CORE.AUTH`, `CORE.TEST` and `BE.DEPLOY`, `BE.INFRA` as needed—never their entire skill libraries automatically.
3. Produce a brief topology + data flow + ingress/egress + state/backup + rollout plan. Specify whether the updater is **data-refresh** or **image-publish**; they have different artifacts and permission boundaries.
4. Apply the six root `AGENTS.md` gates: inspect → minimal change → subtract → efficiency → failure/testing → verify. Prefer changing current Compose services rather than inventing a second orchestrator.
5. Validate config *statically* first; then check unauthorized direct app access, unauthenticated/login, authorized, forbidden, refresh, restart, and rollback paths according to risk. Commands that mutate an engine are not permitted by this skill alone.

## Topic router (selective reading)

- `references/01-topology.md` — required for deployment work: three-role contract, network diagram and role boundary.
- `references/02-compose-storage.md` — service DNS, `ports` vs `expose`, named volumes, updater profile, immutable storage coordination.
- `references/03-auth-gateway.md` — Nginx `auth_request`, OAuth2 Proxy OIDC, TLS offload, header/cookie trust, bypass tests.
- `references/04-update-publish.md` — data updates vs image rebuild/push, safe release, registry, CI and data recoverability.
- `references/05-ssh-rollout.md` — remote contexts, immutable image transfer, zero/unnecessary downtime, health, rollback, SSH safety.
- `references/06-validation.md` — concrete checklist, non-mutating commands and adversarial checks.
- `references/07-source-review.md` — mapping of the **supplied** tutorial/Compose/Nginx/Dockerfile/SSH example; consult before adapting those exact examples.
- `templates/compose.three-role.yaml` — **illustrative, non-deployable until project values and commands are adapted**.
- `templates/nginx.conf` — schematic gateway config; replace `app.example.invalid` with approved public DNS and validate exact upstream trust.
- `templates/.env.example` — configuration *names only*, no secrets. Use appropriate secrets manager and ignored local secret files.

## Stop and escalation rules

Stop before any deploy when the frontend is host-published in a bypass path, untrusted users can spoof forwarded identity, an IdP allows broader access than intended, an updater could corrupt the only durable copy, the target Docker daemon/host is uncertain, or rollback/restore is not credible. Report the issue and request explicit human authorization for impactful operations.
