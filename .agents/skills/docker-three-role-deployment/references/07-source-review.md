# DOCKER.SOURCE — provenance and adaptation audit

These are observations of the **supplied** source files, not claims about any already deployed machine. Originals are archived byte-for-byte under `docs/agent-policy/sources/docker-deployment-examples.zip`; do not bulk-load them for routine requests.

| Supplied source | Observed design | What Codex should preserve / change when applying |
|---|---|---|
| `Docker_Engineering_Implementation_Tutorial_Compact.pdf` | 26-page Docker Engine + Compose v2 tutorial. D1 builds/images, D3 volumes, D4 ports/networks/health, D5 Compose, D6 operations/recovery, E1 FastAPI + PostgreSQL project. | Retain its practical terminology/CLI and safe, explicit Compose/storage mental model. It teaches **general Docker**, not the OIDC gateway or three-role source-publish pipeline. |
| `docker-compose.yml` | `search-engine` image/build and frontend startup, named `input_data`/`output_data` volumes; `database-updater` under `profiles: [database-update]`; `nginx` plus `oauth2-proxy` services. | This already models updater + app + gate; it has **four services** because gate = Nginx + OAuth2 Proxy. Updater writes shared volumes, not a newly pushed Docker image. |
| `nginx.conf` | `auth_request /oauth2/auth`; 401 -> `/oauth2/start`; successful auth -> `search-engine:8080`; forwarded host/protocol maps; large limits. | Keep the pattern, but validate forwarded-header provenance and allowed host, server-side authz, multi-cookie refresh, 403/error policy, and application-specific timeouts. |
| `Dockerfile` | Base `ARG`, APT setup, curl-to-shell `uv` install pinned to URL, `uv sync --frozen`, source copy, `EXPOSE 8080`. | Review base digest, installer integrity, locked deps, non-root runtime, copied assets/models and `.dockerignore`/secrets. `EXPOSE` does not publish a port. |
| `deploy_external_ssh.sh` | Copies Nginx to remote host, saves images, targets Docker-over-SSH, `docker load`, `down --remove-orphans` loop, `up -d --no-build`, global image prune. | **Do not** treat as a safe unattended template unchanged. Disable `StrictHostKeyChecking=no`, remove unbounded `until ... down`, avoid normal full teardown and global `prune -af`, verify remote context/digest, and protect secrets. |

## Specific risks from the supplied files

- **DOCKER.SOURCE1 M** The supplied Compose `search-engine` has `ports: ["80:8080"]`, while Nginx has `ports: ["8080:80"]`. This can bypass Nginx/OAuth2 Proxy wherever port 80 is reachable. Remove app host publication or constrain it to explicitly trusted internal host access with separate authorization before reuse.
- **DOCKER.SOURCE2 M** `OAUTH2_PROXY_EMAIL_DOMAINS: "*"` is broad eligibility; determine the actual tenant/group/allowlist and verify the desired policy. A verified corporate identity does not automatically authorize each resource.
- **DOCKER.SOURCE3 M** The Nginx `$http_x_forwarded_proto` / `$http_x_forwarded_host` mapping trusts headers that may be client-controlled unless upstream ingress sanitizes them. Fix the trusted proxy/Host policy before copying the config to another project.
- **DOCKER.SOURCE4 M** The SSH script skips host-key validation and includes an unbounded teardown retry/global remote prune; do not carry these into a default deployment agent workflow.
- **DOCKER.SOURCE5 M** The example updater shares named volumes with the app; it does **not** implement image-pull/edit/image-push. Decide between data publication and new-image publication explicitly instead of silently assuming them equivalent.
- **DOCKER.SOURCE6 S** Current examples place multiple provider/user credentials in Compose environment variables. Prefer approval-backed secret injection with defined lifetime/redaction and rotate according to project policy; do not copy credential values or enable shell tracing.
- **DOCKER.SOURCE7 S** The image build uses `curl | sh` for a remote installer, and no final non-root `USER` is visible. Review checksum/provenance and runtime privileges in the actual build environment before generalizing it.

### Source-to-rule routing

- Docker handbook D1/D5 -> `DOCKER.COMPOSE`, `DOCKER.UPDATE`, `DOCKER.DEPLOY`.
- Docker handbook D3/D4/E1 -> `DOCKER.COMPOSE`, `DOCKER.CHECK`.
- Uploaded `nginx.conf`, OAuth2 Proxy Compose section -> `DOCKER.AUTH`.
- Uploaded `deploy_external_ssh.sh` -> `DOCKER.DEPLOY`.
- Uploaded data updater + image build -> `DOCKER.UPDATE`.

The source review is a risk map and should **not** prompt Codex to rewrite a user's existing deployment unasked. Apply only to the affected changes and report deviations with evidence.
