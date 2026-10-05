'use strict';
globalThis.TrackerPlanningUI = (() => {
    const node = (tag, text) => {
        const e = document.createElement(tag);
        if (text !== undefined) e.textContent = text;
        return e;
    };
    function pendingWrite(send) {
        let pending = null;
        return {
            async commit(record) {
                pending ||= {record: structuredClone(record), key: crypto.randomUUID()};
                try {
                    const result = await send(pending.record, pending.key);
                    pending = null;return result;
                } catch (error) {
                    if ([400, 401, 403, 404, 409, 422].includes(error.status)) pending = null;
                    throw error;
                }
            },
            unresolved: () => pending !== null
        };
    }
    function editor(record, derived, context) {
        const root = node('details');
        root.append(node('summary', 'Dates, contacts & shared next action'));
        root.append(node('p', 'Unknown historical dates stay blank. Record a source for each date. Automated receipts do not reset waiting.'));
        if (derived?.reasons?.includes('Invalid legacy tracking; no dates inferred')) {
            root.append(node('p', 'Existing tracking needs an explicit repair. Review the stored observations before replacing them through the versioned API.'));
            return root;
        }
        const original = structuredClone(derived?.tracking || record.body.tracking || {});
        function field(parent, label, value = '', type = 'text') {
            const wrapper = node('label', label), input = node(type === 'textarea' ? 'textarea' : 'input');
            if (type !== 'textarea') input.type = type;
            input.value = value || '';input.setAttribute('aria-label', label);
            wrapper.append(input);parent.append(wrapper);return input;
        }
        function form(label, build) {
            const form = node('form'), fields = node('fieldset'), button = node('button', label), status = node('p');
            button.type = 'submit';status.setAttribute('role', 'status');
            form.append(fields, button, status);root.append(form);
            const pending = pendingWrite((r, key) => context.save(r, false, key));
            let busy = false;
            form.onsubmit = async event => {
                event.preventDefault();if (busy) return;
                busy = true;fields.disabled = true;button.disabled = true;
                try {
                    await pending.commit({id: record.id, kind: 'job', version: record.version,
                        body: {...record.body, tracking: build()}});
                    await context.refresh();context.message('Planning update saved with attribution and version history.');
                } catch (error) {
                    status.textContent = pending.unresolved() ?
                        'Response uncertain. Inputs are frozen; retry sends the identical operation and key. Refresh and compare before starting a different edit.' :
                        error.status === 409 ? 'Conflict: refresh the board and compare current changes before editing again.' : error.message;
                    button.textContent = pending.unresolved() ? 'Retry identical planning update' : label;
                    fields.disabled = pending.unresolved();
                } finally {busy = false;button.disabled = false;}
            };
            return fields;
        }
        let applied, appliedSource, shortlisted, shortlistSource, interview, interviewSource, promise, promiseSource;
        let actionText, actionOwner, assignee, due, actionSource;
        const fields = form('Save dates and next action', () => ({...original,
            applied_on: applied.value || null, applied_source: appliedSource.value,
            shortlisted_on: shortlisted.value || null, shortlisted_source: shortlistSource.value,
            interview_on: interview.value || null, interview_source: interviewSource.value,
            promised_response_on: promise.value || null, promise_source: promiseSource.value,
            next_action: actionText.value.trim() ? {text: actionText.value, owner: actionOwner.value,
                assignee: assignee.value, due_on: due.value || null, source: actionSource.value} : null
        }));
        fields.append(node('legend', 'Explicit observations and next action'));
        applied = field(fields, 'Application date (unknown if blank)', original.applied_on, 'date');
        appliedSource = field(fields, 'Application date source', original.applied_source);
        shortlisted = field(fields, 'Strong match shortlisted on (if known)', original.shortlisted_on, 'date');
        shortlistSource = field(fields, 'Shortlist source', original.shortlisted_source);
        interview = field(fields, 'Scheduled interview date', original.interview_on, 'date');
        interviewSource = field(fields, 'Interview date source', original.interview_source);
        promise = field(fields, 'Promised response date', original.promised_response_on, 'date');
        promiseSource = field(fields, 'Promise source', original.promise_source);
        actionText = field(fields, 'Next action (blank removes the action)', original.next_action?.text, 'textarea');
        const ownerLabel = node('label', 'Who owes the next action?');actionOwner = node('select');
        for (const [value, text] of [['owner', 'Owner'], ['company', 'Company'], ['agent', 'Assigned agent']]) {
            const option = node('option', text);option.value = value;actionOwner.append(option);
        }
        actionOwner.value = original.next_action?.owner || 'owner';
        actionOwner.setAttribute('aria-label', 'Who owes the next action?');ownerLabel.append(actionOwner);fields.append(ownerLabel);
        assignee = field(fields, 'Agent assignee (if applicable)', original.next_action?.assignee);
        due = field(fields, 'Next action due date', original.next_action?.due_on, 'date');
        actionSource = field(fields, 'Next action source', original.next_action?.source);
        const contacts = node('div');root.append(contacts);
        let editingContact = null, contactDate, contactKind, contactSource, contactSummary;
        const contactFields = form('Save contact observation', () => {
            const contact = {id: editingContact?.id || crypto.randomUUID(), on: contactDate.value,
                kind: contactKind.value, source: contactSource.value, summary: contactSummary.value};
            const list = [...(original.contacts || [])], index = list.findIndex(c => c.id === contact.id);
            if (index < 0) list.push(contact);else list[index] = contact;
            return {...original, contacts: list};
        });
        contactFields.append(node('legend', 'Log or correct a contact'));
        contactDate = field(contactFields, 'Contact date (enter only if known)', '', 'date');contactDate.required = true;
        contactKind = node('select');contactKind.setAttribute('aria-label', 'Contact kind');
        const placeholder = node('option', 'Choose contact type');placeholder.value = '';contactKind.append(placeholder);contactKind.required = true;
        for (const [value, text] of [['human', 'Meaningful human response'], ['receipt', 'Automated receipt'], ['outbound', 'Outgoing contact']]) {
            const option = node('option', text);option.value = value;contactKind.append(option);
        }
        const kindLabel = node('label', 'Contact kind');kindLabel.append(contactKind);contactFields.append(kindLabel);
        contactSource = field(contactFields, 'Contact evidence source');contactSource.required = true;
        contactSummary = field(contactFields, 'Contact summary', '', 'textarea');
        for (const contact of original.contacts || []) {
            const row = node('p', `${contact.on} · ${contact.kind} · ${contact.summary || ''} · ${contact.source}`);
            const edit = node('button', 'Correct contact');edit.type = 'button';
            edit.onclick = () => {
                editingContact = contact;contactDate.value = contact.on;contactKind.value = contact.kind;
                contactSource.value = contact.source;contactSummary.value = contact.summary || '';
            };
            row.append(edit);contacts.append(row);
        }
        if (context.owner && !['Prospect', 'Closed', 'Rejected', 'Withdrawn'].includes(record.body.stage)) {
            const review = node('div');review.className = 'planning-review';
            review.append(node('h4', 'Owner review: no stage change or message sent'));
            if (original.review) review.append(node('p', `Last decision: ${original.review.decision} · ${original.review.on} · ${original.review.source}`));
            for (const [decision, label] of [['keep_waiting', 'Keep waiting'], ['prepare_follow_up', 'Prepare follow-up'], ['park', 'Park attention; keep application open']]) {
                const button = node('button', label);button.type = 'button';review.append(button);
                const pending = pendingWrite((r, key) => context.save(r, false, key));let busy = false;
                button.onclick = async () => {
                    if (busy) return;busy = true;button.disabled = true;
                    try {
                        await pending.commit({id: record.id, kind: 'job', version: record.version,
                            body: {...record.body, tracking: {...original, review: {decision, on: context.today, source: 'Owner board review'}}}});
                        await context.refresh();context.message('Owner review recorded. No stage change or outreach.');
                    } catch (error) {
                        context.message(pending.unresolved() ? 'Review response uncertain; this same button retries the identical operation. Refresh and compare before choosing another decision.' : error.message);
                    } finally {busy = false;button.disabled = false;}
                };
            }
            root.append(review);
        }
        if (derived?.reasons?.length) root.append(node('p', derived.reasons.join(' ')));
        return root;
    }
    return {editor, pendingWrite};
})();
