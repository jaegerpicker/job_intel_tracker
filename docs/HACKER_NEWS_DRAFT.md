# Hacker News working draft

Status: preparation only; not submitted. The owner chooses whether and when to
announce the project.

HN's [submission guidelines](https://news.ycombinator.com/newsguidelines.html)
ask authors to write their own text and avoid generated posts. Use the facts and
working copy below as preparation, then compose the final submission yourself.
The [Show HN guidelines](https://news.ycombinator.com/showhn.html) favor something
readers can try; this repository provides a local synthetic demo.

## Suggested title

Show HN: Job Intel Tracker — a self-hosted job application board

## Submission URL

https://github.com/jaegerpicker/job_intel_tracker

## Working opening comment

Job Intel Tracker is a self-hosted board for one owner and explicitly authorized
research agents. The MIT-licensed repository contains a FastAPI server, a browser
UI and an Expo/React Native companion called Fieldnotes.

The web board keeps opportunities, application stages, research, notes,
interview preparation and private supporting materials together. Contributions
retain authorship and source/date provenance. Version checks, immutable record
revisions and idempotent writes help keep separate contributors from silently
overwriting each other's work.

Agent access is explicit: each agent gets a revocable, expiring credential with
scopes and optional job restrictions. There is a REST API, a small stdio MCP
bridge and a leased queue for requested research or material preparation. The
queue tracks claims and missing deliverables; it does not automatically wake an
agent or make model calls. Workers and their connections remain the operator's
choice. No model API, scraper or paid hosted service is required by the tracker.

SQLite is the default, with private uploads on local storage. Optional PostgreSQL
support and migration are documented separately. The source release focuses on
the default SQLite setup; target-specific native-library redistribution still
needs its documented notices and rights review.

To try the web UI, follow the README's local demo command and load the synthetic
examples. That demo runs on loopback in a separate data directory and needs no
account or API key. The mobile companion also has an in-memory synthetic demo.

This is an early source release for a single owner and one application instance.
Live use requires HTTPS and an independently approved Apple or Google owner
identity. Signed mobile login, device acceptance and each installation's provider
configuration need separate verification. Native private-file transfer remains
gated. The repository documents two remaining mobile-tooling advisories and the
limits of its tests; it does not claim a clean dependency audit or production
acceptance for every installation.

## Facts and preparation links

- [Project capabilities and local demo](../README.md)
- [Contributor setup](../CONTRIBUTING.md)
- [Synthetic import example](sample-import.json)
- [Mobile companion and its limits](../mobile/README.md)
- [Research queue and disabled live wake transport](RESEARCH_QUEUE.md)
- [Security model](../SECURITY.md)
- [Release scope and verification](RELEASE_READINESS.md)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)
- [Remaining tooling findings](../mobile/qa/DEPENDENCIES.md)

## Possible discussion topics

- Whether a single-owner board with separate contributor identities is useful.
- Whether the local demo and contributor setup are clear enough to reproduce.
- How research provenance, conflicting assessments and missing deliverables
  should be presented to the owner.

Keep examples synthetic. Do not add private records, application histories,
resumes, account identifiers, credentials or deployment details to the post,
screenshots or repository discussion.
