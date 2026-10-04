import base64
import ctypes
import json
import subprocess
import warnings
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.exceptions import InvalidTag

from job_intel_tracker import local_credentials as module

BASE = "https://tracker.example"
NAME = "Researcher-pilot"
PASSWORD = "inert-test-passphrase-only"
PAYLOAD = {"base_url": BASE, "name": NAME, "token": "x" * 43, "scopes": ["read", "jobs:write", "contribute"]}


def browser_capsule(payload=PAYLOAD, password=PASSWORD):
    script = """
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto').webcrypto;
const context = {crypto, TextEncoder, Uint8Array, btoa};
vm.createContext(context);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), context);
const fixture = JSON.parse(fs.readFileSync(0, 'utf8'));
(async () => {
 const prepared = await context.TrackerCredentialCapsule.prepare(fixture.password);
 const capsule = await context.TrackerCredentialCapsule.seal(prepared, fixture.payload);
 process.stdout.write(JSON.stringify(capsule));
})().catch(() => process.exit(1));
"""
    resource = Path(module.__file__).parent / "static" / "credential-capsule.js"
    result = subprocess.run(
        ["node", "-e", script, str(resource)],
        input=json.dumps({"payload": payload, "password": password}),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout)


def test_browser_handoff_import_roundtrip_and_binding(tmp_path):
    envelope = browser_capsule()
    path = tmp_path / "fixture.encrypted.json"
    path.write_text(json.dumps(envelope))
    assert PAYLOAD["token"] not in path.read_text() and PASSWORD not in path.read_text()
    assert module.decrypt_capsule(path, PASSWORD, BASE, NAME) == PAYLOAD
    with pytest.raises(InvalidTag):
        module.decrypt_capsule(path, "incorrect-inert-passphrase", BASE, NAME)
    with pytest.raises(ValueError):
        module.decrypt_capsule(path, PASSWORD, "https://other.example", NAME)
    with pytest.raises(ValueError):
        module.decrypt_capsule(path, PASSWORD, BASE, "Other-agent")
    another = browser_capsule()
    assert another["salt"] != envelope["salt"] and another["iv"] != envelope["iv"]
    changed = bytearray(base64.b64decode(envelope["ciphertext"]))
    changed[0] ^= 1
    envelope["ciphertext"] = base64.b64encode(changed).decode()
    path.write_text(json.dumps(envelope))
    with pytest.raises(InvalidTag):
        module.decrypt_capsule(path, PASSWORD, BASE, NAME)


def test_import_rejects_untrusted_files_and_parameters(tmp_path):
    envelope = browser_capsule()
    path = tmp_path / "fixture.encrypted.json"
    path.write_text(json.dumps(envelope))
    link = tmp_path / "link.json"
    link.symlink_to(path)
    with pytest.raises(OSError):
        module.decrypt_capsule(link, PASSWORD, BASE, NAME)
    envelope["iterations"] = 999999999
    path.write_text(json.dumps(envelope))
    with pytest.raises(ValueError):
        module.decrypt_capsule(path, PASSWORD, BASE, NAME)
    path.write_bytes(b"x" * 131073)
    with pytest.raises(ValueError):
        module.decrypt_capsule(path, PASSWORD, BASE, NAME)


def test_private_prompt_refuses_echoed_input_fallback(tmp_path, monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(module.sys, "platform", "darwin")
    monkeypatch.setattr(
        module.sys,
        "argv",
        [
            "import",
            str(tmp_path / "unused.json"),
            "--service",
            "job_intel_tracker.Researcher-pilot",
            "--agent",
            NAME,
            "--base-url",
            BASE,
            "--confirm-store",
        ],
    )

    def no_terminal(prompt):
        warnings.warn("inert-no-terminal-fixture", module.getpass.GetPassWarning)
        return "must-not-be-used"

    monkeypatch.setattr(module.getpass, "getpass", no_terminal)
    monkeypatch.setattr(module, "decrypt_capsule", lambda *args: calls.append(True))
    with pytest.raises(SystemExit):
        module.main()
    assert not calls
    output = capsys.readouterr()
    assert not output.out and "must-not-be-used" not in output.err


def test_unicode_passphrase_lengths_match_browser_and_importer(tmp_path):
    password = "😀" * 16
    path = tmp_path / "fixture.encrypted.json"
    path.write_text(json.dumps(browser_capsule(password=password)))
    assert module.decrypt_capsule(path, password, BASE, NAME) == PAYLOAD
    with pytest.raises(subprocess.CalledProcessError):
        browser_capsule(password="😀" * 8)


def test_keychain_handoff_uses_framework_not_command_arguments(monkeypatch, capsys):
    observed = []
    freed = []
    content = ctypes.create_string_buffer(json.dumps(PAYLOAD).encode())

    def find(*args):
        observed.append((args[2], args[4]))
        args[5]._obj.value = len(content.value)
        args[6]._obj.value = ctypes.addressof(content)
        return 0

    library = SimpleNamespace(
        SecKeychainAddGenericPassword=lambda *args: observed.append((args[2], args[4], args[6])) or 0,
        SecKeychainFindGenericPassword=find,
        SecKeychainItemFreeContent=lambda *args: freed.append(True) or 0,
    )
    monkeypatch.setattr(module, "keychain", lambda: library)
    service = "job_intel_tracker.Researcher-pilot"
    module.store_keychain(service, PAYLOAD)
    assert observed[0] == (service.encode(), NAME.encode(), json.dumps(PAYLOAD).encode())
    assert module.load_keychain(service, NAME, BASE) == PAYLOAD and freed
    assert not capsys.readouterr().out
    library.SecKeychainAddGenericPassword = lambda *args: -25299
    with pytest.raises(ValueError):
        module.store_keychain(service, PAYLOAD)
    with pytest.raises(ValueError):
        module.load_keychain("unrelated-service", NAME, BASE)


def test_mcp_keychain_mode_binds_identity_and_never_echoes_credential(monkeypatch, capsys):
    import io

    from job_intel_tracker import mcp

    requests = []

    class Client:
        def __init__(self, **kwargs):
            requests.append(kwargs)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

    monkeypatch.setattr(module, "load_keychain", lambda service, name, base: PAYLOAD)
    monkeypatch.setattr(mcp.httpx, "Client", Client)
    monkeypatch.setattr(
        mcp.sys,
        "argv",
        ["mcp", "--keychain-service", "job_intel_tracker.Researcher-pilot", "--agent", NAME, "--base-url", BASE],
    )
    monkeypatch.setattr(mcp.sys, "stdin", io.StringIO('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n'))
    monkeypatch.setenv("TRACKER_AGENT_TOKEN", "wrong-agent-environment-fixture")
    mcp.main()
    assert requests[0]["base_url"] == BASE
    assert requests[0]["headers"] == {"Authorization": "Bearer " + PAYLOAD["token"]}
    assert requests[0]["follow_redirects"] is False
    output = capsys.readouterr().out
    assert PAYLOAD["token"] not in output and "wrong-agent-environment-fixture" not in output
    assert json.loads(output)["result"]["serverInfo"]["name"] == "job_intel_tracker"
