# Aging and workload contract

Stages and record identities stay unchanged. Aging is a read-only projection: it never rejects, archives, applies or contacts an employer. Missing historical dates remain unknown; record update timestamps and stage timeline events are not evidence of an application or human contact.

## Read interface

`GET /api/workload` uses existing read scope or owner/native session. Counts and decisions include only authorized jobs. Response:

- `as_of` UTC timestamp, `local_date`, `timezone`, and effective `policy`.
- `counts`: `open_applications`, `passive_waiting`, `attention`, `parked`, `interviewing_companies`, `weekly_new`, `unknown_application_dates`.
- `warnings`: `{code,message}` for thresholds, pilot review or invalid legacy policy.
- `jobs`: map ID -> `{record_version,status,label,waiting_days,needs_decision,reasons,next_action,review_on,tracking}`.
- `decisions`: `{job_id,company,title,status,label,reasons,next_action}` entries requiring review.

Compare `record_version` with the job before editing. Refresh mismatched reads rather than combining versions. Statuses: `terminal`, `backlog`, `action_due`, `action_needed`, `parked`, `interview_scheduled`, `interview_review`, `promise_waiting`, `promise_review`, `dates_unknown`, `waiting`, `waiting_badge`, `review_due`, `offer_review`. Display supplied labels rather than duplicating calendar logic. `/api/schema` and the checked-in OpenAPI define typed `Tracking` and `WorkloadResponse` models.

## Write interface

Optional job `body.tracking` fields:

| Observation | Source |
| --- | --- |
| `applied_on` | `applied_source` |
| `shortlisted_on` | `shortlisted_source` |
| `interview_on` | `interview_source` |
| `promised_response_on` | `promise_source` |

Dates are `YYYY-MM-DD`; unknown is null/omitted. Populated dates require their paired source. `contacts` is a list of `{id,on,kind,source,summary?}` with unique IDs; kinds are `human`, `receipt`, `outbound`. Automated confirmations are receipts even if personalized. Actual application/shortlist/contact/review dates cannot be future-dated. Schedules, promises and task deadlines may be future. Never infer dates from record/timeline timestamps or invent a human response.

`next_action` is `{text,owner,assignee?,due_on?,source}`; owners are `owner`, `company`, `agent`. Assignment never grants authority. `review` is owner-only `{decision,on,source,note?}`; choices are `keep_waiting`, `prepare_follow_up`, `park`. Agents with `jobs:write` may record observations/next actions but must preserve owner reviews. Existing policy and owner decision protections remain; original authors stay intact and revisions/audit record editors.

Use existing complete-body `PUT /api/records/{id}` with current version and an idempotency key. Preserve other fields. Retry interrupted operations with identical payload/key; reconcile 409 against current records. Web planning forms hold the exact pending request in memory and freeze inputs while ambiguous. Refresh/close loses that pending request: inspect state before another edit. No pending data is put in browser storage.

```json
{"applied_on":null,"applied_source":"","contacts":[{"id":"synthetic-contact","on":"2026-09-01","kind":"receipt","source":"Synthetic receipt","summary":"Acknowledgement only"}],"next_action":{"text":"Prepare questions","owner":"owner","due_on":null,"source":"Synthetic task"},"review":null}
```

## Calendar rules

Ordinary aging starts at the later of explicit application date and latest meaningful human response. Receipts and outbound contact never reset it. Defaults: badge after seven local calendar days; suggest review after fourteen. Dates, rather than 24-hour blocks, handle midnight/DST boundaries consistently.

Owner/agent next actions take priority over company staleness. A task due today/earlier or without a due date asks for attention. Scheduled interviews override aging through the scheduled date. A passed interview asks to confirm the next step unless later human contact or owner review resolves it.

A promised response overrides ordinary aging until its grace date. Default: review starts on the second Mon–Fri business date after the promise, skipping configured holidays. Friday -> Tuesday, or Wednesday if Monday is a configured holiday. This is date-based, not 48 elapsed hours. Human response on/after the promise resolves it. Missed promises request review, never outreach.

Keep waiting delays ordinary review by the review interval without changing contact dates. When historical dates are unknown, it acknowledges the unknown and postpones the next owner review without inventing a waiting-days value. Prepare follow-up suggests preparation only. Park suppresses ordinary aging attention but keeps the application open; an explicitly owed owner/agent task still takes priority. Terminal states suppress aging; backlog has no application clock. An offer without a next action requests a decision.

## Policy and capacity

Owner-only versioned search-policy defaults: `open_application_limit=15`, `weekly_new_limit=2`, `interviewing_company_limit=3`, `waiting_days=7`, `review_days=14`, `promise_grace_business_days=2`, `timezone=America/New_York`, `business_holidays=[]`, `pilot_days=14`, `pilot_started_on=null`.

Count every open applied role (Applied/Screening/Interview/Offer), including alternatives. Parked applications remain open. Attention and passive waiting describe open applications separately from parked attention. Backlog actions can appear in Decisions needed without becoming applications. Interviewing companies are distinct case-insensitive employer names in Interview stage or with an upcoming explicit interview. Weekly additions count each job once when its explicit shortlist/application date falls in the local Mon–Sun week, including roles later closed that week.

Thresholds produce warnings, never write blocks. Legacy `active_cap` remains readable but is not enforced. Existing primary-employer/linked-alternative validation remains separate. The pilot starts only when the owner explicitly records a date. After start + pilot interval suggest policy review, without changing limits.

Older owner policy writes omitting new fields preserve their stored values. Reads fill defaults without rewriting records, revisions, tokens or settings. No startup migration invents dates or starts a pilot. Invalid legacy planning settings get safe defaults plus repair guidance; invalid tracking remains unknown. Packaged timezone data supports self-hosted containers without external calendar services. No credentials, automation schedules or third-party messages are created.
