# DOCKER.TOPO — preferred architecture and trust boundaries

The user's repeatable pattern comprises **three logical responsibilities**. The demonstrated implementation splits the gate into Nginx and OAuth2 Proxy; upstream corporate reverse proxy / TLS terminator may be separately managed.

```text
Browser --HTTPS--> [corporate ingress / TLS] --> [Nginx auth gate]
                                                   |       |
                                                   |       +-- auth subrequest --> [OAuth2 Proxy]
                                                   |                               |
                                                   |                        [OIDC / Entra identity]
                                                   |
                                                allow only
                                                   |
                                         [app-private Compose network]
                                                   |
                                              [frontend:8080]
                                                   |
                                        [read-only data/artifact volume]
                                                   ^
                                                   | atomically published data
                                    [one-shot data-updater, private egress]

Alternative to volume refresh: trusted CI/build pipeline -> build fresh image ->
registry push immutable version -> authorized controlled rollout. NOT docker commit.
```

- **DOCKER.TOPO1 M** For an internet- or intranet-hosted protected web app, prefer a single ingress gate and one private application service; document every ingress and bypass route. Do not open a second direct host port to the app as a convenience.
- **DOCKER.TOPO2 M** Separate update/publish, application runtime, and access-control responsibilities. Three roles do not require exactly three long-running containers; updater can be a profile-gated one-shot job; Nginx and OAuth2 Proxy normally run separately.
- **DOCKER.TOPO3 M** Record actual public DNS, TLS termination owner, host/port exposure, reverse-proxy path, app origin, auth provider, data artifact ownership, update trigger, and credential scope before a production-relevant change.
- **DOCKER.TOPO4 M** Configure app-to-gateway traffic via Compose service DNS and the *container port*. Never rely on a container's ephemeral bridge IP, `localhost` from another container, or `EXPOSE` as host reachability or an access policy.
- **DOCKER.TOPO5 M** Enforce access control at the gateway *and* domain/object/tenant authorization in the application when protected operations exist. A validated login is not blanket permission for all business data or operations.
- **DOCKER.TOPO6 M** Keep a verified denial path: unauthenticated browsers go to a controlled login path; forbidden users get denied; auth-service errors fail closed; API/machine routes avoid surprise HTML redirects when they require machine-readable 401/403.
- **DOCKER.TOPO7 S** Use a narrow dedicated Compose network for private app traffic and a separate ingress/identity-egress network when this improves isolation. Validate DNS, routing, corporate proxy and IdP outbound access on real hosts.
- **DOCKER.TOPO8 M** No implicit production execution, registry publication, server mutation, secret rotation, volume deletion, or account configuration without approved target and permission.

**Project adoption:** This is the default for this user's portfolio of *protected web deployments*. Do not impose it on a static, public, unauthenticated site or a one-off local script unless the task explicitly adopts the topology.
