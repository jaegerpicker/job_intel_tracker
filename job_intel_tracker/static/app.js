'use strict';
const $ = s => document.querySelector(s),
    $$ = s => [...document.querySelectorAll(s)];
let csrf = '',
    records = [],
    workloadState = null,
    ownerSession = false,
    selected = null,
    editing = null,
    stages = [],
    demo = false,
    detailGeneration = 0,
    credentialIssuing = false,
    credentialHandoffGeneration = 0;
const defaults = {
    active_cap: 10,
    open_application_limit: 15,
    base_floor: 220000,
    lanes: ['Principal / Staff AI technical IC', 'Engineering Manager', 'Senior+ mobile', 'Flexible strongest fit'],
    priorities: 'Maximize base salary boost. Give Engineering Manager opportunities serious weight. Preserve actual employer titles. One primary opportunity per employer; link alternatives. Verify compensation and deadlines.'
};
const policy = () => ({...defaults, ...(records.find(r => r.kind === 'filters')?.body || {}), ...(workloadState?.policy || {})});

function el(tag, text, cls) {
    const x = document.createElement(tag);
    if (text !== undefined) x.textContent = text;
    if (cls) x.className = cls;
    return x;
}

function message(t) {
    $('#message').textContent = t;
    $('#editor-message').textContent = t;
}
async function api(path, opts = {}) {
    const headers = {
        'X-CSRF-Token': csrf,
        ...opts.headers
    };
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const r = await fetch(path, {
        ...opts,
        headers
    });
    if (!r.ok) {
        const e = await r.json().catch(() => ({
            detail: r.statusText
        }));
        const error = Error(typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail));
        error.status = r.status;
        throw error;
    }
    return r.json();
}
async function save(r, override = false, key = crypto.randomUUID()) {
    return api('/api/records/' + r.id, {
        method: 'PUT',
        headers: {
            'Idempotency-Key': key,
            ...(override ? {
                'X-Owner-Cap-Override': 'true'
            } : {})
        },
        body: JSON.stringify({
            kind: r.kind,
            job: r.job || null,
            version: r.version || 0,
            body: r.body
        })
    });
}
async function refresh() {
    [records, workloadState] = await Promise.all([api('/api/records'), api('/api/workload')]);
    render();
}
const active = r => !['Prospect', 'Closed', 'Rejected', 'Withdrawn'].includes(r.body.stage) && !r.body.primary_id;
const money = n => n ? new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
}).format(n) : 'Unknown';

function qualification(b) {
    if (b.grandfathered) return 'Grandfathered exception';
    if (!b.base_min || b.comp_status !== 'Verified' || !b.comp_source || !b.comp_checked) return 'Base salary needs qualification';
    if (b.base_min < policy().base_floor) return 'Below floor / spanning range — qualify';
    return 'Verified base meets floor';
}

function option(s, value, text = value) {
    const o = el('option', text);
    o.value = value;
    s.append(o);
}

function render() {
    const jobs = records.filter(r => r.kind === 'job'),
        act = jobs.filter(active);
    $('#stats').replaceChildren();
    [
        ['Open applications', (workloadState?.counts.open_applications ?? act.length) + ' / ' + policy().open_application_limit, TrackerPlanningUI.capacityNote(workloadState)],
        ['Backlog', jobs.filter(r => r.body.stage === 'Prospect').length, 'Promising, unapplied'],
        ['Attention workload', workloadState?.counts.attention ?? 0, 'Open applications with actions, interviews or decisions'],
        ['Passive waiting', workloadState?.counts.passive_waiting ?? 0, 'Separate from parked attention']
    ].forEach(([t, n, d]) => {
        const x = el('div', undefined, 'stat');
        x.append(el('span', t), el('strong', String(n)), el('span', d));
        $('#stats').append(x);
    });
    $('#active-count').textContent = workloadState?.warnings.map(w => w.message).join(' ') || '';
    $('#planning-summary').textContent = `${workloadState?.counts.interviewing_companies || 0} companies interviewing · ${workloadState?.counts.weekly_new || 0} new matches / applications this week · ${workloadState?.counts.parked || 0} parked · ${workloadState?.counts.unknown_application_dates || 0} application dates unknown. As of ${workloadState?.local_date || ''} in ${workloadState?.timezone || ''}. ${policy().pilot_started_on ? 'Pilot started ' + policy().pilot_started_on : 'Pilot start not recorded; set it explicitly in Search policy.'}`;
    $('#decisions-list').replaceChildren(...(workloadState?.decisions || []).map(decision => {
        const button = el('button', `${decision.company} · ${decision.label}`, 'decision-row');
        button.onclick = () => { selected = decision.job_id;render(); };return button;
    }));
    if (!workloadState?.decisions.length) $('#decisions-list').append(el('p', 'No decisions needed from known observations.', 'muted'));
    const lane = $('#lane'),
        old = lane.value;
    lane.replaceChildren();
    option(lane, '', 'All search lanes');
    policy().lanes.forEach(l => option(lane, l));
    lane.value = old;
    ['active', 'backlog', 'closed'].forEach(k => $('#' + k).replaceChildren());
    const q = $('#search').value.toLowerCase();
    let shown = 0;
    jobs.filter(r => (!$('#stage').value || r.body.stage === $('#stage').value) && (!lane.value || r.body.lane === lane.value) && JSON.stringify(r.body).toLowerCase().includes(q)).forEach(r => {
        shown++;
        const b = r.body,
            x = el('button', undefined, 'card' + (r.id === selected ? ' selected' : ''));
        const top = el('div', undefined, 'card-top');
        top.append(el('span', b.company, 'company'), el('span', b.stage, 'pill'));
        x.append(top, el('h3', b.title), el('div', (b.lane || 'Unassigned') + ' · ' + (b.route || 'Discovered'), 'card-meta'), el('div', money(b.base_min) + (b.base_max ? ' – ' + money(b.base_max) : '') + ' base', 'card-meta'), el('div', qualification(b), 'card-meta warn'));
        if (b.primary_id) x.append(el('div', 'Alternative to ' + b.primary_id, 'card-meta'));
        const derived = workloadState?.jobs[r.id];
        if (derived) x.append(el('div', derived.label, 'card-meta ' + (derived.needs_decision ? 'warn' : '')));
        x.onclick = () => {
            selected = r.id;
            render();
        };
        $('#' + (['Closed', 'Rejected', 'Withdrawn'].includes(b.stage) ? 'closed' : b.stage === 'Prospect' ? 'backlog' : 'active')).append(x);
    });
    ['active', 'backlog'].forEach(k => {
        if (!$('#' + k).children.length) $('#' + k).append(el('p', shown ? 'No matching opportunities here.' : 'Start with an opportunity or import your private board.', 'muted'));
    });
    if (selected) showDetail();
}

function safeLink(url, text) {
    try {
        const u = new URL(url);
        if (!['http:', 'https:'].includes(u.protocol)) return el('span', text);
        const a = el('a', text);
        a.href = u.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        return a;
    } catch {
        return el('span', text);
    }
}
async function showDetail() {
    const generation = ++detailGeneration;
    let contribution = null;
    const r = records.find(r => r.id === selected);
    if (!r) {
        $('#detail').replaceChildren(el('p', 'Choose an opportunity.'));
        return;
    }
    const b = r.body,
        d = $('#detail');
    d.replaceChildren();
    const head = el('div', undefined, 'row'),
        edit = el('button', 'Edit', 'quiet');
    edit.onclick = () => editJob(r);
    head.append(el('span', b.company, 'company'), edit);
    d.append(head, el('h2', b.title), el('p', b.lane + ' · ' + b.stage, 'muted'), safeLink(b.url, 'Employer listing'), el('p', qualification(b), 'warn'), el('p', 'Base: ' + money(b.base_min) + (b.base_max ? ' – ' + money(b.base_max) : '') + ' · ' + b.comp_status + ' · checked ' + (b.comp_checked || 'not yet'), 'muted'), el('p', 'Source: ' + (b.comp_source || 'Missing') + ' · Claim author: ' + (b.claim_author || r.author), 'muted'));
    if (b.deadline) d.append(el('p', 'Deadline: ' + b.deadline + ' (' + b.deadline_status + ')', 'warn'));
    if (b.owner_assessment) d.append(el('div', 'Owner assessment: ' + b.owner_assessment, 'evidence'));
    const derived = workloadState?.jobs[r.id];
    if (derived) d.append(el('p', derived.label, 'planning-badge'));
    if (derived && derived.record_version !== r.version) d.append(el('p', 'Planning changed while loading. Refresh planning before editing dates or actions.', 'warn'));
    else d.append(TrackerPlanningUI.editor(r, derived, {save, refresh, message, owner: ownerSession, today: workloadState.local_date}));
    d.append(el('h3', 'Stage timeline'));
    (b.timeline || []).forEach(t => d.append(el('div', t.stage + ' · ' + new Date(t.at * 1000).toLocaleDateString() + ' · ' + t.author, 'timeline')));
    ['rating', 'research', 'note', 'interview'].forEach(kind => {
        d.append(el('h3', {
            rating: 'Independent fit assessments',
            research: 'Research & provenance',
            note: 'Notes',
            interview: 'Interview talking points & questions'
        } [kind]));
        const rs = records.filter(x => x.job === r.id && x.kind === kind);
        if (kind === 'rating' && rs.length > 1) {
            const scores = rs.map(x => x.body.score);
            d.append(el('p', 'Rating spread: ' + Math.min(...scores) + '–' + Math.max(...scores) + ' / 100. Compare evidence before deciding.', 'warn'));
        }
        if (!rs.length) d.append(el('p', 'No ' + kind + ' yet.', 'muted'));
        rs.forEach(x => {
            const e = el('div', undefined, 'evidence');
            e.append(el('small', x.author + ' · v' + x.version + ' · ' + new Date(x.updated * 1000).toLocaleDateString()));
            if (kind === 'rating') e.append(el('strong', x.body.score + ' / 100 — ' + x.body.rationale), el('p', 'Rubric: ' + x.body.rubric), el('p', 'Evidence: ' + x.body.evidence));
            else e.append(el('div', x.body.text || JSON.stringify(x.body)));
            if (x.body.source) e.append(safeLink(x.body.source, 'Source'), el('small', 'Observed ' + x.body.observed_at));
            const editEntry = el('button', 'Edit entry', 'quiet');
            editEntry.onclick = () => {
                contribution = x;
                type.value = x.kind;
                text.value = x.body.text || x.body.rationale || '';
                source.value = x.body.source || x.body.evidence || '';
                rubric.value = x.body.rubric || '';
                score.value = x.body.score ?? '';
                submit.textContent = 'Save entry changes';
            };
            e.append(editEntry);
            const btn = el('button', 'Delete', 'quiet');
            btn.onclick = async () => {
                if (confirm('Delete this entry?')) await guarded(async () => {
                    await api('/api/records/' + x.id + '?version=' + x.version, {
                        method: 'DELETE'
                    });
                    await refresh();
                });
            };
            e.append(btn);
            d.append(e);
        });
    });
    d.append(el('h3', 'Versioned resumes & cover letters'));
    const files = el('div');
    d.append(files);
    try {
        const list = await api('/api/jobs/' + r.id + '/attachments');
        if (selected !== r.id || generation !== detailGeneration) return;
        list.forEach(f => {
            const row = el('div', undefined, 'row');
            const a = el('a', f.filename + ' · v' + f.version + ' · ' + f.author);
            a.href = '/api/attachments/' + f.id;
            const del = el('button', 'Remove', 'quiet');
            del.onclick = () => guarded(async () => {
                await api('/api/attachments/' + f.id, {
                    method: 'DELETE'
                });
                showDetail();
            });
            row.append(a, del);
            files.append(row);
        });
    } catch (e) {
        message(e.message);
    }
    const upload = el('input');
    upload.type = 'file';
    upload.accept = '.pdf,.txt,.docx';
    upload.setAttribute('aria-label', 'Upload resume or cover letter');
    upload.onchange = () => guarded(async () => {
        const fd = new FormData();
        fd.append('file', upload.files[0]);
        await api('/api/jobs/' + r.id + '/attachments', {
            method: 'POST',
            headers: {
                'Idempotency-Key': crypto.randomUUID()
            },
            body: fd
        });
        showDetail();
    });
    d.append(upload);
    const form = el('form'),
        type = el('select');
    ['note', 'research', 'rating', 'interview'].forEach(k => option(type, k));
    type.setAttribute('aria-label', 'Contribution type');
    const text = el('textarea');
    text.rows = 4;
    text.placeholder = 'Notes, research summary, rationale or interview preparation';
    text.required = true;
    text.setAttribute('aria-label', 'Contribution text');
    const source = el('input');
    source.placeholder = 'Source URL / evidence (required for research and rating)';
    source.setAttribute('aria-label', 'Evidence source');
    const rubric = el('input');
    rubric.placeholder = 'Rating rubric';
    rubric.setAttribute('aria-label', 'Rating rubric');
    const score = el('input');
    score.type = 'number';
    score.min = 0;
    score.max = 100;
    score.placeholder = 'Fit score 0–100';
    score.setAttribute('aria-label', 'Fit score');
    const submit = el('button', 'Add attributed entry');
    form.append(type, text, source, rubric, score, submit);
    form.onsubmit = e => {
        e.preventDefault();
        guarded(async () => {
            const body = {
                text: text.value
            };
            if (type.value === 'research') {
                body.source = source.value;
                body.observed_at = new Date().toISOString();
            }
            if (type.value === 'rating') Object.assign(body, {
                score: Number(score.value),
                rationale: text.value,
                evidence: source.value,
                rubric: rubric.value
            });
            await save({
                id: contribution?.id || crypto.randomUUID(),
                kind: type.value,
                job: r.id,
                version: contribution?.version || 0,
                body: {
                    ...(contribution?.body || {}),
                    ...body
                }
            });
            await refresh();
        });
    };
    d.append(form);
    const del = el('button', 'Delete opportunity', 'quiet');
    del.onclick = () => {
        if (confirm('Delete this opportunity, all entries and attachments?')) guarded(async () => {
            await api('/api/records/' + r.id + '?version=' + r.version, {
                method: 'DELETE'
            });
            selected = null;
            await refresh();
            showDetail();
        });
    };
    d.append(del, el('p', 'Record ID: ' + r.id + ' · v' + r.version, 'muted'));
}
async function guarded(fn) {
    try {
        message('');
        await fn();
    } catch (e) {
        message(e.message);
    }
}

function editJob(r = null) {
    editing = r;
    const f = $('#job-form');
    f.reset();
    ['lane', 'stage'].forEach(n => {
        f.elements[n].replaceChildren();
        (n === 'lane' ? policy().lanes : stages).forEach(v => option(f.elements[n], v));
    });
    if (r) Object.entries(r.body).forEach(([k, v]) => {
        if (f.elements[k]) {
            if (f.elements[k].type === 'checkbox') f.elements[k].checked = !!v;
            else f.elements[k].value = v ?? '';
        }
    });
    $('#edit-title').textContent = r ? 'Edit opportunity' : 'Add opportunity';
    $('#editor').showModal();
}
$('#job-form').onsubmit = e => {
    e.preventDefault();
    guarded(async () => {
        const f = e.target,
            b = {...(editing?.body || {}), ...Object.fromEntries(new FormData(f))};
        b.grandfathered = f.elements.grandfathered.checked;
        ['base_min', 'base_max'].forEach(k => b[k] = b[k] ? Number(b[k]) : null);
        if (b.grandfathered && !b.exception_reason) throw Error('Explain the grandfathered exception.');
        const same = records.find(r => r.kind === 'job' && r.body.company.toLowerCase() === b.company.toLowerCase() && !r.body.primary_id && !['Closed', 'Rejected', 'Withdrawn'].includes(r.body.stage) && r.id !== editing?.id);
        if (same && !b.primary_id) throw Error('This employer already has a primary role. Link alternative to ' + same.id);
        const r = await save({
            id: editing?.id || crypto.randomUUID(),
            kind: 'job',
            version: editing?.version || 0,
            body: b
        });
        selected = r.id;
        $('#editor').close();
        await refresh();
    });
};
$('#cancel').onclick = () => $('#editor').close();
$('#new').onclick = () => editJob();
$('#refresh-board').onclick = () => guarded(async () => { await refresh();message('Planning refreshed. Unsaved form changes were discarded.'); });
$('#search').oninput = render;
$('#stage').onchange = render;
$('#lane').onchange = render;
$$('nav button').forEach(btn => btn.onclick = () => guarded(async () => {
    credentialHandoffGeneration++;
    TrackerSecureHandoff.clear();
    const view = btn.dataset.view;
    ['board', 'filters', 'audit', 'agents'].forEach(v => $('#' + v).hidden = v !== view);
    $$('nav button').forEach(b => b.classList.toggle('selected', b === btn));
    if (view === 'filters') {
        const p = policy(),
            f = $('#policy');
        f.elements.active_cap.value = p.active_cap;
        f.elements.base_floor.value = p.base_floor;
        f.elements.lanes.value = p.lanes.join('\n');
        f.elements.priorities.value = p.priorities || '';
        for (const name of ['open_application_limit', 'weekly_new_limit', 'interviewing_company_limit', 'waiting_days', 'review_days', 'promise_grace_business_days', 'timezone', 'pilot_days', 'pilot_started_on']) f.elements[name].value = p[name] ?? '';
        f.elements.business_holidays.value = (p.business_holidays || []).join('\n');
    }
    if (view === 'audit') {
        const a = await api('/api/audit');
        $('#activity').replaceChildren(...a.map(x => el('div', x.actor + ' · ' + x.action + ' · ' + x.resource + ' · ' + new Date(x.timestamp * 1000).toLocaleString(), 'evidence')));
    }
    if (view === 'agents') {
        $('#agent-create-fields').disabled = demo || credentialIssuing;
        $('#agent-jobs').replaceChildren(...records.filter(r => r.kind === 'job').map(r => {
            const option = el('option', r.body.company + ' · ' + r.body.title);
            option.value = r.id;
            return option;
        }));
        renderAgentList(await api('/api/agents'));
    }
}));
function renderAgentList(entries) {
    $('#agent-list').replaceChildren(...entries.map(x => {
        const row = el('div', undefined, 'evidence');
        const state = x.revoked ? 'Revoked' : x.expires * 1000 <= Date.now() ? 'Expired' : 'Active';
        const jobs = JSON.parse(x.jobs);
        row.append(el('p', x.name + ' · ' + JSON.parse(x.scopes).join(', ') + ' · ' + state));
        row.append(el('p', (jobs.length ? jobs.length + ' assigned jobs' : 'All jobs, including future jobs') +
            ' · Expires ' + new Date(x.expires * 1000).toLocaleString(), 'muted'));
        const button = el('button', 'Revoke', 'quiet');
        button.disabled = !!x.revoked;
        button.onclick = () => guarded(async () => {
            TrackerSecureHandoff.clearFor(x.name);
            await api('/api/agents/' + x.name, {method: 'DELETE'});
            renderAgentList(await api('/api/agents'));
        });
        row.append(button);
        return row;
    }));
}
function updateHandoffMode() {
    const f = $('#agent-create'), direct = f.elements.handoff.value === 'secure-entry';
    TrackerSecureHandoff.clear();
    $('#agent-encrypted-options').hidden = direct;
    $('#agent-secure-options').hidden = !direct;
    for (const name of ['passphrase', 'confirmation']) {
        f.elements[name].disabled = direct;
        f.elements[name].required = !direct;
        f.elements[name].value = '';
    }
    f.elements.secure_approved.disabled = !direct;
    f.elements.secure_approved.required = direct;
    f.elements.secure_approved.checked = false;
    $('#agent-create-button').textContent = direct ? 'Create one-time token for manual entry' : 'Create encrypted credential download';
}
$('#agent-create').elements.handoff.onchange = updateHandoffMode;
addEventListener('pagehide', () => { credentialHandoffGeneration++; });
$('#agent-create').onsubmit = async e => {
    e.preventDefault();
    const f = e.currentTarget, fields = $('#agent-create-fields'), status = $('#agent-create-status');
    if (fields.disabled || demo || credentialIssuing) return;
    const direct = f.elements.handoff.value === 'secure-entry';
    if (direct && !f.elements.secure_approved.checked) {
        status.textContent = 'Confirm the one-time token display for your own manual transfer before creating a credential.';
        return;
    }
    const p = {
        name: f.elements.name.value,
        days: Number(f.elements.days.value),
        scopes: ['read', ...[...f.querySelectorAll('[name="scope"]:checked')].map(x => x.value)],
        jobs: f.elements.all_jobs.checked ? [] : [...f.elements.jobs.selectedOptions].map(x => x.value)
    };
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(p.name) || p.name === 'owner') {
        status.textContent = 'Use a unique credential name: 1–40 letters, numbers, underscores or hyphens, starting with a letter. The name owner is reserved.';
        return;
    }
    if (!f.elements.approved.checked || !f.checkValidity()) return;
    if (!f.elements.all_jobs.checked && !p.jobs.length) {
        status.textContent = 'Select assigned jobs or explicitly allow all jobs.';
        return;
    }
    if (!direct && f.elements.passphrase.value !== f.elements.confirmation.value) {
        status.textContent = 'The handoff passphrases do not match.';
        return;
    }
    fields.disabled = true;
    TrackerSecureHandoff.clear();
    const generation = credentialHandoffGeneration;
    credentialIssuing = true;
    let attempted = false;
    let created = false;
    try {
        status.textContent = direct ? 'Preparing one-time token…' : 'Preparing encrypted handoff…';
        const prepared = direct ? null : await TrackerCredentialCapsule.prepare(f.elements.passphrase.value);
        attempted = true;
        const issued = await api('/api/agents', {method: 'POST', body: JSON.stringify(p)});
        created = true;
        try {
            if (generation !== credentialHandoffGeneration) throw Error('Handoff view dismissed');
            if (direct) TrackerSecureHandoff.show(issued.token, p.name);
            else {
                const capsule = await TrackerCredentialCapsule.seal(prepared, {...p, token: issued.token, base_url: location.origin});
                const url = URL.createObjectURL(new Blob([JSON.stringify(capsule)], {type: 'application/json'}));
                const link = el('a');
                link.href = url;
                link.download = 'job-intel-agent-' + p.name + '.encrypted.json';
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 30000);
            }
        } finally { issued.token = ''; }
        f.reset();
        // Reset controls without clearing the just-created direct handoff.
        $('#agent-encrypted-options').hidden = false;
        $('#agent-secure-options').hidden = true;
        for (const name of ['passphrase', 'confirmation']) {
            f.elements[name].disabled = false;
            f.elements[name].required = true;
        }
        f.elements.secure_approved.disabled = true;
        f.elements.secure_approved.required = false;
        $('#agent-create-button').textContent = 'Create encrypted credential download';
        status.textContent = direct ?
            'New token is available below for five minutes. Transfer it yourself into your trusted connector, then dismiss. If transfer is cancelled, revoke the credential.' :
            'Encrypted download created. Import it privately before testing the client. If the download was blocked, revoke this credential and create a new name.';
        renderAgentList(await api('/api/agents'));
    } catch (error) {
        TrackerSecureHandoff.clear();
        if (attempted && !created && error.status === 409) {
            status.textContent = 'That credential name already exists, including if revoked. Choose a new name. No new credential was created.';
        } else if (attempted && !created && error.status === 422) {
            status.textContent = 'The credential settings were rejected. Check the name, lifetime and permissions. No credential was created.';
        } else if (attempted && !created && (error.status === 401 || error.status === 403)) {
            status.textContent = 'Credential creation was not authorized. Sign in again and confirm owner access. No credential was created.';
        } else status.textContent = attempted ?
            'Handoff interrupted. Check the agent list and revoke any newly created credential before retrying with a new name. No automatic retry was made.' :
            'Handoff could not be prepared. Check the passphrase and browser support; no credential was requested.';
    } finally {
        f.elements.passphrase.value = '';
        f.elements.confirmation.value = '';
        f.elements.approved.checked = false;
        f.elements.secure_approved.checked = false;
        credentialIssuing = false;
        fields.disabled = demo;
    }
};
$('#policy').onsubmit = e => {
    e.preventDefault();
    guarded(async () => {
        const f = e.target,
            old = records.find(r => r.kind === 'filters');
        await save({
            id: old?.id || 'search-policy',
            kind: 'filters',
            version: old?.version || 0,
            body: {
                ...(old?.body || {}),
                active_cap: Number(f.elements.active_cap.value),
                base_floor: Number(f.elements.base_floor.value),
                lanes: f.elements.lanes.value.split('\n').map(x => x.trim()).filter(Boolean),
                priorities: f.elements.priorities.value,
                ...Object.fromEntries(['open_application_limit', 'weekly_new_limit', 'interviewing_company_limit', 'waiting_days', 'review_days', 'promise_grace_business_days', 'pilot_days'].map(name => [name, Number(f.elements[name].value)])),
                timezone: f.elements.timezone.value,
                pilot_started_on: f.elements.pilot_started_on.value || null,
                business_holidays: f.elements.business_holidays.value.split('\n').map(x => x.trim()).filter(Boolean)
            }
        });
        await refresh();
        message('Search policy saved.');
    });
};
$('#export').onclick = () => {
    const a = el('a');
    a.href = '/api/export';
    a.download = 'private-job-intel-export.json';
    document.body.append(a);
    a.click();
    a.remove();
};
$('#import').onchange = () => guarded(async () => {
    const file = $('#import').files[0];
    if (file.size > 2000000) throw Error('Import limit is 2 MB.');
    const input = JSON.parse(await file.text());
    if (input.schema !== 1 || !Array.isArray(input.records)) throw Error('Expected schema 1 and records array.');
    if (!confirm('Import ' + input.records.length + ' private records? Existing IDs are skipped; source claims remain content.')) return;
    let count = 0;
    for (const r of [...input.records].sort((a, b) => (a.kind === 'job' ? 0 : 1) - (b.kind === 'job' ? 0 : 1))) {
        if (records.some(x => x.id === r.id)) continue;
        await save({
            ...r,
            version: 0,
            body: {
                ...r.body,
                imported_claim_provenance: {
                    author: r.author || 'Unspecified source',
                    updated: r.updated || null
                }
            }
        });
        count++;
        await refresh();
    }
    message('Imported ' + count + ' records. Interrupted imports can be retried; existing IDs are skipped.');
    $('#import').value = '';
});
$('#seed').onclick = () => guarded(async () => {
    for (const [i, company, title, lane, stage] of [
            [1, 'Example Orbit', 'Staff AI Platform Engineer', defaults.lanes[0], 'Interview'],
            [2, 'Example Cedar', 'Engineering Manager', defaults.lanes[1], 'Screening'],
            [3, 'Example Harbor', 'Senior Mobile Engineer', defaults.lanes[2], 'Prospect']
        ]) {
        if (records.some(r => r.id === 'demo-' + i)) continue;
        await save({
            id: 'demo-' + i,
            kind: 'job',
            body: {
                company,
                title,
                lane,
                stage,
                route: i === 2 ? 'Recruiter introduction' : 'Direct application',
                base_min: i === 1 ? 240000 : null,
                base_max: i === 1 ? 290000 : null,
                comp_status: i === 1 ? 'Verified' : 'Unknown',
                comp_source: 'Synthetic fixture — not a real employer',
                comp_checked: '2026-01-01',
                claim_author: 'Synthetic example',
                url: 'https://example.com',
                location: 'Remote'
            }
        });
    }
    await refresh();
});
async function enter() {
    const me = await api('/api/me');
    ownerSession = me.actor === 'owner';
    csrf = me.csrf;
    stages = me.stages;
    stages.forEach(s => option($('#stage'), s));
    $('#login').hidden = true;
    $('#workspace').hidden = false;
    $('#logout').hidden = false;
    await refresh();
}
$('#demo').onclick = () => guarded(async () => {
    await api('/auth/demo', {
        method: 'POST'
    });
    await enter();
});
$('#logout').onclick = () => guarded(async () => {
    credentialHandoffGeneration++;
    TrackerSecureHandoff.clear();
    await api('/auth/logout', {
        method: 'POST'
    });
    location.reload();
});
(async () => {
    const info = await api('/auth/info');
    demo = info.demo;
    $('#demo').hidden = !demo;
    $('#seed').hidden = !demo;
    $('#mode').textContent = demo ? 'ISOLATED LOCAL DEMO' : 'Private by design';
    $('#auth-status').textContent = info.configured ? '' : 'Live Apple login is not configured. See setup documentation.';
    try {
        await enter();
    } catch (e) {
        if (e.message !== 'Sign in required') message(e.message);
    }
})();
