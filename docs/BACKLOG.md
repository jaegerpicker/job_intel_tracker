# Deferred work

## Browser-independent authenticated API/MCP CRUD

Planning only; not part of the current source handoff. Provide a fuller Fieldnotes
interface for authorized clients to create, read, update and delete records
without depending on a signed-in browser. Build on the existing authenticated
REST API and stdio MCP bridge, which already support scoped reads and versioned
writes. Identify the missing operations and owner-only actions before choosing
an authentication design.

Preserve scope/job restrictions, actor attribution, audit history, version checks
and idempotent mutations. Define explicit owner approval, expiry and revocation
for any future browser-independent credential flow, with synthetic contract
tests for unauthorized access, stale writes and retries.

This backlog entry authorizes no implementation, credential issuance, browser
session reuse or expansion of persistent access. Authentication method and CRUD
authority require a separate owner-approved proposal.

Current contracts: [agent guide](../AGENT_GUIDE.md), [REST schema](openapi.json),
[security model](../SECURITY.md).
