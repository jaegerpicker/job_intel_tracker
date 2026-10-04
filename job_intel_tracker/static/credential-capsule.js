'use strict';
// Block native submission even if the main UI script fails after enabling the form.
if (typeof document !== 'undefined') document.querySelector('#agent-create')?.addEventListener('submit', e => e.preventDefault());
globalThis.TrackerCredentialCapsule = (() => {
    const encoder = new TextEncoder();
    const aad = encoder.encode('job_intel_tracker.agent-credential.v1');
    const base64 = bytes => btoa(Array.from(new Uint8Array(bytes), byte => String.fromCharCode(byte)).join(''));
    async function prepare(password) {
        if ([...password].length < 16) throw Error('Use a handoff passphrase of at least 16 characters.');
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256'},
            material, {name: 'AES-GCM', length: 256}, false, ['encrypt']);
        return {key, salt, iv};
    }
    async function seal(prepared, payload) {
        const bytes = encoder.encode(JSON.stringify(payload));
        if (bytes.length > 65536) throw Error('Credential handoff is too large.');
        const ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv: prepared.iv, additionalData: aad}, prepared.key, bytes);
        return {schema: 1, kdf: 'PBKDF2-SHA256', iterations: 310000, cipher: 'AES-256-GCM',
            salt: base64(prepared.salt), iv: base64(prepared.iv), ciphertext: base64(ciphertext)};
    }
    return {prepare, seal};
})();
