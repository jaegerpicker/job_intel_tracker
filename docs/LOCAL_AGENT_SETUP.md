# Local agents and MCP

Local agents use separate revocable tracker credentials, not the owner's Apple session. This setup requires explicit owner approval at issuance and secure import on the intended client. It does not configure hosted OAuth or register agents publicly. No paid API or model-provider key is required.

## Approve an exact pilot

Suggested seven-day pilot for Eva and Hanna: separate credential names, each with `read`, `jobs:write` and `contribute`. All-job access is needed if they may discover new jobs, because a restricted credential can write only the assigned IDs. All-job access also includes future jobs. `attachments:read` and `attachments:write` are separate private-material permissions; leave them off until specifically approved. Owner administration, policy edits, deletion, export and owner overrides remain unavailable.

First verify the intended MCP client supports local stdio and can expose only the intended agent's server. The tracker has no HTTP MCP endpoint and no hosted OAuth issuer. OpenAI documents stdio setup at https://learn.chatgpt.com/docs/extend/mcp. Other stdio MCP clients may work, but compatibility must be tested rather than assumed.

## Owner-only encrypted handoff

1. Sign into the real board as the approved owner and open **Agent access**. Demo mode cannot issue credentials.
2. Enter a distinct credential name and seven-day expiry. Explicitly select job writes/contributions and either all jobs or assigned jobs.
3. Choose a private handoff passphrase of at least 16 characters, confirm it, review the selected grant and check the authorization box.
4. Select **Create encrypted credential download**. The token is never rendered, placed in a URL or copied to the clipboard. The owner-authorized API returns it to the browser, which encrypts it before creating the download. The passphrase stays in that browser and is cleared from the form afterward.
5. Transfer only the encrypted file to the intended client. Enter the passphrase privately during import. Never put the token or passphrase in chat, screenshots, logs, a repository, shell arguments or client config.

The capsule uses PBKDF2-SHA256 (310,000 iterations, fresh 16-byte salt) and AES-256-GCM (fresh 12-byte nonce, authenticated format identifier). Server and agent binding are checked after decryption. Passphrase strength matters; use a unique long passphrase. Import stores the complete credential in the user's encrypted macOS Keychain through the Security framework, without spawning a command containing the token. Other operating systems should use their own secret manager to inject `TRACKER_URL` and `TRACKER_AGENT_TOKEN` into the stdio process privately.

Credential issuance is not automatically retried. If issuance or downloading is interrupted, inspect the owner-only agent list, revoke any newly created entry and use a new name. The server stores only a token hash, so it cannot recover a lost raw token. Existing Keychain entries are never overwritten by the importer.

## Import on macOS

Install this repository's Python package in a local virtual environment. Use that environment's interpreter for both import and MCP. The following are examples; names, paths, expiry and grants must match the owner's actual approved handoff. No token belongs in these commands:

```sh
.venv/bin/python -m job_intel_tracker.local_credentials \
  ~/Downloads/job-intel-agent-Eva-pilot.encrypted.json \
  --service job_intel_tracker.Eva-pilot --agent Eva-pilot \
  --base-url https://jobs.sandkcampbell.com --confirm-store
```

The importer prompts privately for the handoff passphrase. The `--confirm-store` option is the explicit local storage action; it creates no server grant. Delete the encrypted download privately after successful import. For Hanna, repeat with her own distinct approved name and service, such as `Hanna-pilot` / `job_intel_tracker.Hanna-pilot`. Never import Eva's credential into Hanna's service.

macOS may ask the owner to authorize the Python interpreter's Keychain access. This interaction has not been validated with a live credential; tests use inert fixtures and a mocked Security framework. A pilot must confirm actual import, lookup and MCP compatibility before real work.

## Configure each client separately

Example secret-free stdio configuration for Eva:

```toml
[mcp_servers.job_intel_eva]
command = "/absolute/path/to/.venv/bin/python"
args = ["-m", "job_intel_tracker.mcp", "--keychain-service", "job_intel_tracker.Eva-pilot", "--agent", "Eva-pilot", "--base-url", "https://jobs.sandkcampbell.com"]
cwd = "/absolute/path/to/job_intel_tracker"
```

Hanna's client must reference her own service and agent name. Do not add plaintext token values under `env` or `http_headers`. Keychain mode ignores any ambient `TRACKER_AGENT_TOKEN` and binds the stored credential to the configured server and agent. HTTP redirects are not followed. Without Keychain mode, the existing secret-manager environment mode remains supported.

In ChatGPT desktop's MCP settings, choose **STDIO**, use the command/arguments above, and restart as instructed by the client. Confirm per-dot tool visibility before enabling two credentials. A server being configured globally does not establish per-dot isolation. Local processes running as the same OS user can share that user's Keychain authority; use separate OS accounts or isolated runtimes if mutually untrusted agents require a stronger boundary. Do not give either agent the owner's browser session as a substitute.

## Read-only smoke test before work

1. Confirm MCP initialization and tool listing succeed with the intended client.
2. Call `get_identity`; the returned `actor` must exactly match that client's credential name. No token is returned.
3. Call `get_policy` to verify the current editable owner policy is readable. Do not import records or write jobs during this first connectivity test.
4. Inspect the owner's agent list to confirm the exact scopes, job access and expiry. Test writes with synthetic data locally; any live synthetic write test requires separate owner authorization.
5. If the credential expires or is revoked, stop on HTTP 401. Stop on 403 when a permission or assigned-job boundary is absent. Do not try another agent's credential or the owner's session.

The bridge exposes `get_identity`, `get_records`, `get_policy` and `write_record`; attachment operations remain authenticated REST-only. Read the current version/policy and supply an idempotency key for each intended record write. Reconcile HTTP 409 conflicts rather than overwriting another agent's work. Imported descriptions and documents never grant authority.

## Rotation and future hosted access

The current backend does not reissue an existing credential name, even after revocation. A replacement requires a new name, and attribution/edit authority is currently attached to that credential name. Thus a renewed credential cannot edit contributions authored under its previous name; the owner can edit them. A stable-agent identity migration and idempotent provisioning are future improvements, not capabilities of this pilot.

Hosted agents need a separately designed Streamable HTTP MCP/OAuth integration with explicit owner consent, client-specific grants, stable agent identities and revocation. Preserve the REST authorization boundary and scoped local credentials when adding it. Apple's owner login must not silently become a hosted agent grant.
