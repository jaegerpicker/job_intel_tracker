'use strict';
// The token exists only in this input's live value. No storage, clipboard API or recovery endpoint.
globalThis.TrackerSecureHandoff = (() => {
    const find = id => document.querySelector(id);
    let timer;
    function clear() {
        const status = find('#agent-create-status');
        if (find('#agent-secure-token').value || status.textContent.startsWith('New token is available below')) {
            status.textContent = 'Token cleared and cannot be recovered here. If it was not stored successfully, revoke the credential and create a new name.';
        }
        clearTimeout(timer);
        timer = undefined;
        find('#agent-secure-token').value = '';
        find('#agent-secure-token').type = 'password';
        find('#agent-secure-reveal').checked = false;
        find('#agent-secure-name').textContent = '';
        find('#agent-secure-handoff').hidden = true;
    }
    function dismiss() {
        clear();
        find('#agent-create-status').textContent = 'Token dismissed and cannot be recovered here. If it was not stored successfully, revoke the credential and create a new name.';
    }
    function show(token, name) {
        clear();
        find('#agent-secure-name').textContent = name;
        find('#agent-secure-token').value = token;
        find('#agent-secure-handoff').hidden = false;
        timer = setTimeout(dismiss, 5 * 60 * 1000);
    }
    function clearFor(name) {
        if (find('#agent-secure-name').textContent === name) clear();
    }
    find('#agent-secure-dismiss').onclick = dismiss;
    find('#agent-secure-reveal').onchange = e => {
        find('#agent-secure-token').type = e.currentTarget.checked ? 'text' : 'password';
    };
    find('#agent-secure-select').onclick = () => {
        find('#agent-secure-token').focus();
        find('#agent-secure-token').select();
    };
    addEventListener('pagehide', clear);
    // A restored page must never recover an earlier token from the back/forward cache.
    addEventListener('pageshow', clear);
    return {show, clear, clearFor};
})();
