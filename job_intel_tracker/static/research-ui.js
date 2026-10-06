'use strict';
globalThis.TrackerResearchUI = (() => {
    const node = (tag, text) => {
        const e = document.createElement(tag);
        if (text !== undefined) e.textContent = text;
        return e;
    };
    function panel(job, context) {
        const root = node('section');root.className = 'research-queue';
        root.append(node('h3', 'Requested research & materials'));
        root.append(node('p', 'Requests wait for an authorized agent to pick them up. Delivery is not completion. No agent runs automatically.'));
        const list = node('div');root.append(list);
        let clearFormFeedback = () => {};
        async function load() {
            const rows = await context.api('/api/research-requests?job=' + encodeURIComponent(job.id));
            list.replaceChildren();
            if (!rows.length) list.append(node('p', 'No requests yet. Missing materials can be requested below.'));
            for (const request of rows) {
                const item = node('article');item.className = 'evidence';
                item.append(node('strong', request.package.replaceAll('_', ' ') + ' · ' + request.status),
                    node('p', 'Requested by ' + request.created_by + ' · ' + new Date(request.created_at * 1000).toLocaleString()),
                    node('p', request.note));
                if (request.claimed_by) item.append(node('p', 'Agent: ' + request.claimed_by + (request.lease_until ? ' · lease until ' + new Date(request.lease_until * 1000).toLocaleString() : '')));
                if (request.claim_expired) item.append(node('p', 'Claim expired; available for another authorized pickup.'));
                item.append(node('p', request.missing_deliverables.length ? 'Missing deliverables: ' + request.missing_deliverables.join(', ') : 'All referenced deliverables are available at their recorded versions.'));
                if (request.reason) item.append(node('p', 'Reason: ' + request.reason));
                if (request.completion_note) item.append(node('p', 'Agent completion note: ' + request.completion_note));
                for (const artifact of request.artifacts) item.append(node('p', artifact.deliverable + ' · ' + artifact.availability + ' · ' + artifact.type + ' ' + artifact.id + ' v' + artifact.version + ' · ' + artifact.source + ' · observed ' + artifact.observed_on));
                const history = node('details');history.append(node('summary', 'Request history'));
                for (const event of request.events) {
                    history.append(node('p', event.actor + ' · ' + event.action + ' · v' + event.version + ' · ' + new Date(event.timestamp * 1000).toLocaleString() + (event.reason ? ' · ' + event.reason : '')));
                    if (event.completion_note) history.append(node('p', event.completion_note));
                    for (const artifact of event.artifacts || []) history.append(node('p', artifact.deliverable + ' · ' + artifact.id + ' v' + artifact.version + ' · ' + artifact.source + ' · observed ' + artifact.observed_on));
                }
                item.append(history);
                if (context.owner && request.status !== 'cancelled') {
                    for (const action of request.status === 'queued' ? ['cancel'] : ['requeue', 'cancel']) {
                        const button = node('button', action === 'requeue' ? 'Requeue for agent pickup' : 'Cancel request');
                        const pending = TrackerPlanningUI.pendingWrite((p, key) => context.api('/api/research-requests/' + encodeURIComponent(request.id) + '/' + action,
                            {method: 'POST', headers: {'Idempotency-Key': key}, body: JSON.stringify(p)}));
                        let busy = false;
                        button.onclick = async () => {
                            if (busy) return;
                            busy = true;button.disabled = true;
                            try {
                                await pending.commit({version: request.version});clearFormFeedback();await load();context.message('Request ' + action + ' recorded.');
                            } catch (error) {
                                context.message(pending.unresolved() ? 'Response uncertain. Retry this same button to send the identical operation; refresh and compare before another action.' : error.status === 409 ? 'Request changed. Refresh and compare before acting again.' : error.message);
                            } finally {busy = false;button.disabled = false;}
                        };
                        item.append(button);
                    }
                }
                list.append(item);
            }
        }
        if (context.owner) {
            const form = node('form'), fields = node('fieldset'), legend = node('legend', 'Request research'),
                label = node('label', 'Requested package'), select = node('select');
            select.setAttribute('aria-label', 'Requested research package');
            for (const [value, text] of [['research','Job & company research'],['application_documents','Tailored resume & cover letter'],['interview_prep','Interview prep packet'],['full_package','Full package']]) {
                const option = node('option', text);option.value = value;select.append(option);
            }
            select.value = 'full_package';label.append(select);
            const noteLabel = node('label', 'Instructions or gaps (optional)'), note = node('textarea');
            note.maxLength = 4000;note.setAttribute('aria-label', 'Research request instructions');noteLabel.append(note);
            fields.append(legend, label, noteLabel);
            const button = node('button', 'Request research'), status = node('p');button.type = 'submit';status.setAttribute('role','status');
            form.append(fields,button,status);root.append(form);
            const pending = TrackerPlanningUI.pendingWrite((p,key) => context.api('/api/jobs/' + encodeURIComponent(job.id) + '/research-requests',
                {method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(p)}));
            let busy = false;
            clearFormFeedback = () => {
                if (!busy && !pending.unresolved()) status.textContent = '';
            };
            form.onsubmit = async event => {
                event.preventDefault();if (busy) return;
                busy = true;fields.disabled = true;button.disabled = true;
                try {
                    await pending.commit({package:select.value,note:note.value});
                    status.textContent = 'Request queued or existing open request retained. No automatic agent execution.';
                    fields.disabled = false;button.textContent = 'Request research';await load();
                } catch (error) {
                    fields.disabled = pending.unresolved();
                    button.textContent = pending.unresolved() ? 'Retry identical research request' : 'Request research';
                    status.textContent = pending.unresolved() ? 'Response uncertain. Inputs are frozen; retry sends the identical operation and key. Refresh and compare before starting a different request.' : error.status === 409 ? 'An open request exists. Review or cancel it before changing the package.' : error.message;
                } finally {busy = false;button.disabled = false;}
            };
        }
        load().catch(error => {list.replaceChildren(node('p', 'Requests unavailable: ' + error.message));});
        return root;
    }
    return {panel};
})();
