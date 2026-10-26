# Render: locked initial service

Create nothing until the owner approves the paid service and disk. Public repository URL: https://github.com/jaegerpicker/job_intel_tracker. Using this URL avoids granting broad GitHub account access.

Use a Docker Web Service, branch `main`, region Virginia (or the owner's choice), Starter 512 MB / 0.5 CPU ($7/month). Root directory blank; Docker build context `.`; Dockerfile `./Dockerfile`; registry credentials none; Docker Command and Pre-Deploy Command blank; auto-deploy OFF/manual. Attach a persistent disk at `/var/data`, 1 GB ($0.25/month). Expected base total $7.25/month before tax and additional usage; this is not a spending cap. One instance only. Persistent disk deployments have brief downtime. Review current [pricing](https://render.com/pricing), [disk/backup limits](https://render.com/docs/disks), and [terms](https://render.com/terms) before purchase. Do not use the free ephemeral tier for real records.

Environment for the locked initial service:

```
APP_ENV=production
DATA_DIR=/var/data/tracker
```

Health check `/healthz`. Render supplies `PORT`; the container binds `0.0.0.0:$PORT`. No Apple variables, demo variables, secret files, credentials or private data are needed initially. `/healthz` only checks SQLite availability; it does not claim Apple readiness. Expect board API 401 and Apple login 503 until configuration is complete.

The container initializer starts with root only to prepare the private data directory and the configured mounted Apple key. A key directly under `/etc/secrets` is copied into a fresh private runtime directory under fixed `/tmp` (0700), ignoring `TMPDIR`/`TEMP`/`TMP`, with its copy owned by UID/GID 10001 and mode 0600. The original mount remains unchanged; no key is copied to the persistent data disk, image, logs or repository. The initializer allows projected secret symlinks only when their resolved file stays within the root-controlled secret mount (broad directory mode bits are permitted only when the kernel reports a read-only filesystem); it rejects escaping links, nonregular files, untrusted owners, writable mounts and empty/oversized contents. Keys configured elsewhere are not staged. The `/etc/secrets` parent is a trusted operator-managed mount; do not make it writable by the runtime user. Private copies survive a same-container restart until that container is removed; recreate the container when retiring a key, and never mount `/tmp` on persistent storage. Compose drops all capabilities except the four required only for initialization (CHOWN, FOWNER, SETGID, SETUID). It drops supplementary groups, GID and UID permanently before starting Uvicorn. It never recursively chowns the disk or runs the web server as root. Do not override the command or force a platform UID; confirm the runtime UID and disk ownership in Render Shell before enrollment. CI checks a root-owned read-only mounted synthetic key, runtime access and restart; actual Apple signing needs owner-authorized validation.

Later Apple setup (separate approval): add an owner-provided Sign in with Apple private key as secret file `apple-auth-key.p8` at `/etc/secrets/apple-auth-key.p8`, and set `APPLE_PRIVATE_KEY_FILE` to that exact path, plus `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_REDIRECT_URI=https://jobs.sandkcampbell.com/auth/callback`. Never put the key in GitHub, this document, a screenshot or chat. Configure the custom hostname and only its DNS record after separate approval; preserve the root and www GitHub Pages records. Live Apple enrollment needs a secure operator Shell and the explicit protocol in OWNER_ENROLLMENT.md. No first visitor gains ownership.

Before real data: verify HTTPS/domain, UID/disk writability across restart, locked API, Apple allowlist login and rejection of another account, backup and restore rehearsal, agent scopes/revocation and authenticated attachment access. Keep exports/backups private and outside the public repository. Render disk snapshots are not a substitute for a tested application-consistent SQLite/upload backup. No deployment has been performed by this repository workflow.

## Explicit public origin behind Render TLS termination

If the app sees the proxy's internal HTTP URL, configure `PUBLIC_BASE_URL=https://<approved-custom-host>` only after approving this deployment contract. The origin must be HTTPS, contain no path/query/userinfo, and match the Apple callback's origin exactly. This opt-in makes the configured hostname canonical: all requests except the unauthenticated health check must carry that exact Host. The alternate onrender.com hostname returns 421 once this setting is enabled. Secure cookies, enrollment's mandatory exact Origin, and owner CSRF checks remain in force. No forwarded host/protocol header can select a different public origin.

This setting declares that the public edge terminates TLS and the app's HTTP listener is confined to trusted ingress. Render documents that its public load balancer terminates SSL and forwards HTTP; the bound application port is not directly reachable from the public internet. However, same-workspace services in the same region can also reach the HTTP server privately. Treat that private workspace/network as trusted, and do not expose the container's HTTP port directly when self-hosting. The application cannot prove a request's original transport from canonical configuration alone. This explicit contract avoids trusting wildcard forwarded-header sources, but does not replace TLS or network isolation.

References: https://render.com/docs/web-services and https://render.com/docs/private-network . Keep Uvicorn's forwarded-header allowlist narrow; do not add `FORWARDED_ALLOW_IPS=*` merely to bypass an origin failure.

## October 2026 certificate remediation

For the [Render eMudhra advisory](https://render.com/docs/advisory-emudhra),
the Dockerfile refreshes the system CA store and both dependency files require
Certifi `2026.10.19`. The direct project dependency covers Docker's `pip install .`,
which does not read `requirements-lock.txt`. HTTPX uses this bundled store for
Apple authentication and the local MCP client. The updated Certifi wheel retains
its MPL-2.0 license and unmodified CA bundle.

This server image contains no Node or PHP runtime. Node-based mobile/CI tooling
is separate; [Render's Node version guidance](https://render.com/docs/node-version)
applies if the actual service builds or runs Node. PHP2Shell does not apply to
this Python image.

After separate publication/deployment approval, build the reviewed security
commit with a fresh base image and no stale package layers. Preserve the service's
private storage and authentication settings. Record the deployed commit/image,
Certifi version and system `ca-certificates` package version, then check health
and access controls. From the running service, without credentials, verify that
its actual HTTPX configuration rejects both advisory endpoints with certificate
verification errors:

- `https://dv-g3b-emudhra.we-have-a-problem.com/`
- `https://dv-g3b-aaa-emudhra.we-have-a-problem.com/`

Check normal HTTPS as a control. DNS failures/timeouts do not demonstrate
certificate rejection. Inspect any custom CA overrides privately; never disable
verification. Local tests do not establish deployed remediation.
