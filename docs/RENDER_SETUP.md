# Render: locked initial service

Create nothing until the owner approves the paid service and disk. Public repository URL: https://github.com/jaegerpicker/job_intel_tracker. Using this URL avoids granting broad GitHub account access.

Use a Docker Web Service, branch `main`, region Virginia (or the owner's choice), Starter 512 MB / 0.5 CPU ($7/month). Root directory blank; Docker build context `.`; Dockerfile `./Dockerfile`; registry credentials none; Docker Command and Pre-Deploy Command blank; auto-deploy OFF/manual. Attach a persistent disk at `/var/data`, 1 GB ($0.25/month). Expected base total $7.25/month before tax and additional usage; this is not a spending cap. One instance only. Persistent disk deployments have brief downtime. Review current [pricing](https://render.com/pricing), [disk/backup limits](https://render.com/docs/disks), and [terms](https://render.com/terms) before purchase. Do not use the free ephemeral tier for real records.

Environment for the locked initial service:

```
APP_ENV=production
DATA_DIR=/var/data/tracker
```

Health check `/healthz`. Render supplies `PORT`; the container binds `0.0.0.0:$PORT`. No Apple variables, demo variables, secret files, credentials or private data are needed initially. `/healthz` only checks SQLite availability; it does not claim Apple readiness. Expect board API 401 and Apple login 503 until configuration is complete.

The container initializer starts with root only to create/chown the nested private directory to UID/GID 10001 and chmod 0700. It drops supplementary groups, GID and UID permanently before starting Uvicorn. It never recursively chowns the disk or runs the web server as root. Do not override the command or force a platform UID; confirm the runtime UID and disk ownership in Render Shell before enrollment. Docker runtime behavior has CI build coverage; actual Render execution needs owner-authorized validation.

Later Apple setup (separate approval): add an owner-provided Sign in with Apple private key as secret file `apple-auth-key.p8` at `/etc/secrets/apple-auth-key.p8`, and set `APPLE_PRIVATE_KEY_FILE` to that exact path, plus `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_REDIRECT_URI=https://jobs.sandkcampbell.com/auth/callback`. Never put the key in GitHub, this document, a screenshot or chat. Configure the custom hostname and only its DNS record after separate approval; preserve the root and www GitHub Pages records. Live Apple enrollment needs a secure operator Shell and the explicit protocol in OWNER_ENROLLMENT.md. No first visitor gains ownership.

Before real data: verify HTTPS/domain, UID/disk writability across restart, locked API, Apple allowlist login and rejection of another account, backup and restore rehearsal, agent scopes/revocation and authenticated attachment access. Keep exports/backups private and outside the public repository. Render disk snapshots are not a substitute for a tested application-consistent SQLite/upload backup. No deployment has been performed by this repository workflow.
