# Policy routing map for Codex

Purpose: load **only the sections that bear on an observed change**. This is an index, not permission to ignore the mandatory root `AGENTS.md`. Always use the shared `CORE.CODE` rules; add `CORE.WORK` for meaningful planning/review. Rule identifiers are globally qualified: `CORE`, `FE`, `BE`; old source IDs are preserved in `RULE_INDEX.tsv`.

## Shared policy: when to read

| Change trigger | Read from `docs/agent-policy/core/` |
|---|---|
| Public modules, dependencies, architectural boundaries | `ARCH.md`, optionally `DOC.md` |
| Data, state ownership, persistence, transactions, idempotency | `DATA.md`, `AUTH.md`, `TEST.md` |
| Untrusted HTTP/files/CLI/queue/model input | `INPUT.md`, `SINK.md`, `AUTH.md` as applicable |
| Authentication, authorization, secrets, privacy, telemetry | `AUTH.md`, `KEY.md`, `PRIV.md`, `LOG.md`, `SINK.md` as applicable |
| Errors, cancellation, resource budgets, retries, recovery | `FAIL.md`, `TEST.md` |
| Behavior, test harness, fixtures, contract changes | `TEST.md` |
| New service topology, autoscaling, sharding or capacity | `SCALE.md`, `ARCH.md`, `DATA.md` |
| Measured performance work | `OPT.md` + compute skill if CPU/GPU numerical optimization |
| LLM/model/tool/retrieval integrations | `AI.md`, `INPUT.md`, `AUTH.md` |
| Architectural decisions / updating the rules themselves | `DOC.md` |
| Explicit scientific stage-file pipelines | `PIPE.md` only when this convention is adopted |

## Specialist routing (references live under each skill)

| Affected surface | Skill and example references |
|---|---|
| Layout/CSS/semantic HTML | `frontend-engineering`: `CSS`, `HTML`, `WEB`, `A11Y`, `BROWSER` |
| Forms, interactions, state and data fetch | `frontend-engineering`: `FORM`, `COMP`, `STATE`, `JS`, `API`, `UX`, `TEST` |
| Public SEO or PWA | `frontend-engineering`: `SEO` or `PWA` (only when actually used) |
| Browser security/session/consent | `frontend-engineering`: `SEC`, `AUTH`, `PRIV`, `DATA` |
| Backend API or domain behavior | `backend-engineering`: `API`, `DOMAIN`, `TYPE`, `AUTH`, `TEST` |
| Database/schema/transaction | `backend-engineering`: `SQL`, `TXN`, `MIG`, `DATA`, `TEST` |
| Queues/workers/distributed or caching | `backend-engineering`: `MSG`, `JOB`, `DIST`, `CACHE`, `FAIL` |
| Security/cryptography/identity/privacy | `backend-engineering`: `SEC`, `AUTH`, `CRYPTO`, `PRIV` |
| Backend build/deploy/cloud/production incident | `backend-engineering`: `BUILD`, `CONFIG`, `DEPLOY`, `INFRA`, `SRE`, `OBS`, `DR` |
| UI/backend performance | Relevant specialist `PERF`, and `TEST`; compare representative end-to-end metrics |
| CPU optimization, GPU kernels, CUDA/PyTorch, remote Colab | `compute-optimization`: workload/profiling, CPU/GPU/Colab references as applicable |

Read linked neighboring sections when a change crosses them. Examples: a new upload may require FE.FORM+FE.SEC + BE.FILE+BE.SEC+BE.AUTH; a payment handler may require BE.DOMAIN+BE.TXN+BE.AUTH+BE.TEST. Do not retrieve irrelevant topics simply because they exist.

## Docker / protected-web deployment router

| Affected deployment surface | Read from `.agents/skills/docker-three-role-deployment/` |
|---|---|
| Any Docker/Compose/web-hosting topology change | `SKILL.md` + `references/01-topology.md` |
| Service networking, private app port, volumes, updater profile | `references/02-compose-storage.md` |
| Nginx, oauth2-proxy, OIDC/Entra, corporate TLS forwarding, auth bypass | `references/03-auth-gateway.md` |
| Pull/edit/push image, refreshed datasets, registry and immutable artifacts | `references/04-update-publish.md` |
| SSH/deploy scripts, rollouts, health, rollback | `references/05-ssh-rollout.md` |
| Deployment testing, threat model, readiness | `references/06-validation.md` |
| Adapting the user's supplied Compose/Nginx/Dockerfile/SSH examples | `references/07-source-review.md` |

**Default topology:** one update/publish role; one private frontend service; one gated ingress/auth role. The gate generally comprises both Nginx and OAuth2 Proxy containers. Never copy uploaded direct app port publication into a protected deployment.

## Codex discovery notes

- Root `AGENTS.md` is the single compact auto-loaded repository contract; `SKILL.md` files offer progressively loaded references. Codex detects repository skills from `.agents/skills`.
- Codex can also load nested `AGENTS.md` files **between repository root and its working directory**. Do not add hypothetical nested instructions here; put one in a *real* frontend/backend subtree only when file scope is established.
- `AGENTS.override.md` in a directory replaces its sibling `AGENTS.md`, not merely appends to it. Use intentionally.
- Scope-specific rules inherit higher-priority instructions; policy is not an authorization mechanism. Enforce critical constraints with tests, checks, sandbox and approvals.
