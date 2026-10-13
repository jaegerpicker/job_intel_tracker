# Explicit operator approval of the owner

This optional helper discovers a verified Apple stable subject without granting access. It requires a fresh empty database, no sessions or agent credentials, HTTPS and complete Apple configuration. It cannot replace an existing owner. Apple live setup is unvalidated until tested with the owner's account; no credentials or grants have been created.

Only after action-time owner approval, use the service OS identity (UID 10001 in Docker) and private data directory. Configure `APPLE_OWNER_SUB_FILE=/var/data/tracker/owner.json` and temporarily `APPLE_ENROLLMENT_ENABLED=1`; leave `APPLE_OWNER_SUB` unset. Restart the still-locked app. All Apple variables, including `APPLE_PRIVATE_KEY_FILE`, must be configured first. Owner files bind the subject to Apple's issuer, client ID and exact redirect URI; subsequent configuration changes require operator review, never silently re-enrollment.

From a secure service Shell, explicitly begin:

```
python -m job_intel_tracker.enrollment begin --data-dir /var/data/tracker --code-file /var/data/tracker/enrollment-code.json
```

The one-use ten-minute capability is only written to a new 0600 file. Retrieve it privately in the secure Shell and enter it in the password field at `https://jobs.sandkcampbell.com/auth/enroll`; never place it in URLs, logs, screenshots, chat or source control. The page sends it by same-origin POST. Apple verification has a five-minute browser-bound, one-use state/nonce flow. A verified identity becomes only a private candidate, never a session or approved owner.

Immediately write a local review file:

```
python -m job_intel_tracker.enrollment review --data-dir /var/data/tracker --review-file /var/data/tracker/enrollment-review.json
```

Privately inspect this 0600 candidate and verify that the Apple sign-in was performed by the intended owner. The candidate expires after five minutes. After explicit owner confirmation:

```
python -m job_intel_tracker.enrollment approve --data-dir /var/data/tracker --review-file /var/data/tracker/enrollment-review.json --confirm-owner
```

Approval atomically checks current candidate, configuration, expiration and empty board under a database writer lock, and creates a new 0600 allowlist without overwriting an existing file. It creates no session or agent token. Disable/remove `APPLE_ENROLLMENT_ENABLED`, restart, then use regular Apple sign-in. Delete the capability/review files privately after successful approval. The allowlist must remain private on the persistent disk, never in Git.

For an interrupted or mistaken flow, cancel explicitly, delete obsolete setup files privately, and begin again with new filenames:

```
python -m job_intel_tracker.enrollment cancel --data-dir /var/data/tracker
```

Cancellation invalidates in-flight verification and cannot undo approved ownership. Restart is mandatory to activate the new allowlist. Existing or malformed allowlist files fail closed. Restoring a backup cancels pending enrollment, removes sessions/login flows and revokes agent tokens. Ownership migration after data exists requires a separately reviewed operator procedure; public enrollment does not support it.

This helper supports the selected SQLite or PostgreSQL backend and refuses enrollment if a Google owner is already approved. Google uses deliberate operator approval of its independently verified subject; see [Google enrollment/linking model](GOOGLE_SETUP.md).
