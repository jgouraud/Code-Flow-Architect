# DOCKER.UPDATE — one update role, two different artifact models

The user describes the update role as “pull image, change contents, push image.” Docker images are immutable *snapshots*. Separate the intent from an unsafe in-place `docker commit` workflow:

### Mode A — update authoritative **data** (matches the supplied Compose example)

One-shot `data-updater` (Compose profile) starts from a controlled image, fetches and validates new input, writes a new **versioned data artifact** to a mounted named volume/object store, atomically publishes a complete version, and exits. The frontend mounts the data read-only, selects a complete version, and continues serving until refresh. Updating data **does not automatically push a Docker image**. Do not advertise image publication unless a registry push actually occurred.

### Mode B — publish a new immutable **image** (when image contents must change)

Trusted build job fetches source/base, updates files in an isolated build context, validates output and provenance, builds a new image, scans/tests as required, tags it immutably, pushes to approved registry, and rolls out the referenced digest. Do not mutate a running container then `docker commit`, reuse mutable `latest` without control, or mount `/var/run/docker.sock` into the data updater. The build runner needs narrowly scoped registry credentials and explicit authorized publication.

- **DOCKER.UPDATE1 M** State which artifact is authoritative—volume/object-store data, image content, database rows, or both—and its owner, version, integrity proof, deployment relation and rollback mechanism. Do not conflate `docker pull/push` with reading/writing volume contents.
- **DOCKER.UPDATE2 M** Validate all retrieved data before publication (schema, source identity, checksums/sizes, missing/partial results, domain invariants). Stage in a separate location, then publish the complete version; preserve a known-good prior version.
- **DOCKER.UPDATE3 M** Make updater retries, crash recovery, concurrency, abort, rate limits and secret access explicit. Any data change with external side effects needs authorization, bounded resource budgets and idempotency/reconciliation.
- **DOCKER.UPDATE4 M** If publishing an image, build a fresh immutable artifact from controlled inputs, tag a version/commit or deploy digest, verify registry target and permissions, and confirm the pushed digest before rollout. No `docker commit` or privileged Docker socket inside app/update workers by default.
- **DOCKER.UPDATE5 M** Separate build-time source access, runtime application credentials, updater source credentials, and registry push credentials. Apply least privilege to each and never pass a private key into Dockerfile `ARG`/`ENV` or build logs.
- **DOCKER.UPDATE6 M** Handle data-version and application-version compatibility. Define when readers switch, whether old instances understand the new data, and how a rollback to the old image interacts with a newer shared volume.
- **DOCKER.UPDATE7 S** Prefer CI/build-service publication over a permanent registry-editing daemon. Use artifact promotion instead of rebuilding different bytes under the same release label.
- **DOCKER.UPDATE8 M** Before expensive/provider-bound updates, establish data classification, privacy restrictions, cost budget and what happens if the update fails halfway.

**Example commands (reference only, do not execute implicitly):**

```sh
# MODE A: opt-in one-shot data refresh (actual service/paths vary)
docker compose --profile data-update run --rm data-updater
# inspect the expected new data version and frontend behavior afterwards

# MODE B: after approved CI build; images and targets are project-specific
docker build --tag "$REGISTRY_APP_IMAGE:$RELEASE_ID" .
docker push "$REGISTRY_APP_IMAGE:$RELEASE_ID"
# resolve digest; authorize rollout; verify health; keep previous digest for rollback
```
