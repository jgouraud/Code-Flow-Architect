# DOCKER.CHECK — proportionate validation and denial tests

- **DOCKER.CHECK1 M** Validate syntax and rendered Compose configuration; check env substitutions, mounted files, services/profiles, network memberships, host bind addresses, image digest/architecture, secret mounts and startup dependencies.
- **DOCKER.CHECK2 M** Verify that the app has no bypass ingress: check Compose `ports`, `network_mode`, host firewall, load balancer/VPN/SSH tunnels and other proxy mappings. Do not rely on `expose` or an internal DNS hostname as an authorization boundary by themselves.
- **DOCKER.CHECK3 M** Test the authentication/authorization matrix (anonymous, valid eligible, valid ineligible, expired/revoked, IdP unreachable, spoofed identity/forwarded headers) and verify no failure is interpreted as allow. Test from a genuinely untrusted network boundary when authorized.
- **DOCKER.CHECK4 M** Validate updater output and idempotency, startup and restart behavior, atomic publication, compatibility and rollback against representative nonempty data. Never remove or overwrite the only recovery copy for a test.
- **DOCKER.CHECK5 M** Confirm persistent data survives container recreation and backup restore works for data that must survive; use database-native backups for a live DB rather than tarring active data files.
- **DOCKER.CHECK6 M** Check TLS/cookie/redirect correctness from the user's actual public hostname, not a local HTTP-only simulation. Include CORS, CSRF, websocket/streaming, body sizes, client timeouts and health routes when affected.
- **DOCKER.CHECK7 M** Report commands actually run, observed states, untested paths, and deployment target. Static validation does not prove running access control, TLS, performance or disaster recovery.

### Recommended verification order

1. **Read only:** inspect Compose, Dockerfile, Nginx, deploy scripts, current bound ports, role permissions, volume paths, and target context.
2. **Static:** `docker compose config -q`; Nginx syntax check in correct runtime; inspect image/Dockerfile conventions and diff; optional `python tools/audit_docker_topology.py path/to/compose.yaml` for a *heuristic* local model check.
3. **Pre-deploy test:** start a test stack only after authorization; test app-internal connectivity, denied direct path, auth redirects and read-only data mounting.
4. **Staged deploy:** authorized release with known stop/revert steps, minimal service recreation and no persistent volume removal.
5. **Post-deploy:** smoke requests from outside, unauthorized access refusal, explicit app health, IdP unavailable fail-closed, updater/revert behavior.

### Source confidence

The attached Docker handbook's recipes D0–D6 and E1 cover Engine/Compose/builds/networks/volumes/secrets, but **do not** themselves implement this particular corporate TLS + OAuth2 Proxy architecture. The uploaded config files are evidence of a concrete Nginx/OAuth2 Proxy pattern and require threat-model validation before reuse. Treat templated sample values as examples only, never successful deployment evidence.
