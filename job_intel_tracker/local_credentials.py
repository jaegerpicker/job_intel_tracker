"""Owner-operated encrypted handoff import and macOS Keychain access. Never prints tokens."""

import argparse
import base64
import ctypes
import getpass
import json
import os
import re
import stat
import sys
import warnings
from pathlib import Path
from urllib.parse import urlparse

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

AAD = b"job_intel_tracker.agent-credential.v1"
SCOPES = {"read", "jobs:write", "contribute", "attachments:read", "attachments:write"}


def validate(payload, expected_url, expected_name):
    u = urlparse(expected_url)
    if u.scheme != "https" or not u.hostname or u.username or u.password or u.query or u.fragment or u.path:
        raise ValueError("Use the exact HTTPS origin without a path")
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,39}", expected_name) or expected_name == "owner":
        raise ValueError("Invalid agent credential name")
    if not isinstance(payload, dict) or payload.get("base_url") != expected_url or payload.get("name") != expected_name:
        raise ValueError("Credential does not match the intended server and agent")
    if not isinstance(payload.get("token"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", payload["token"]):
        raise ValueError("Invalid credential format")
    scopes = payload.get("scopes")
    if not isinstance(scopes, list) or not all(isinstance(s, str) and s in SCOPES for s in scopes):
        raise ValueError("Invalid credential permissions")
    return payload


def decrypt_capsule(path, password, expected_url, expected_name):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_size > 131072:
            raise ValueError("Use an owner-owned regular encrypted handoff file")
        with os.fdopen(fd, "r") as stream:
            fd = -1
            envelope = json.load(stream)
    finally:
        if fd >= 0:
            os.close(fd)
    if not isinstance(envelope, dict) or any(
        envelope.get(k) != v
        for k, v in {"schema": 1, "kdf": "PBKDF2-SHA256", "iterations": 310000, "cipher": "AES-256-GCM"}.items()
    ):
        raise ValueError("Unsupported encrypted handoff")
    salt, iv, ciphertext = [base64.b64decode(envelope[k], validate=True) for k in ("salt", "iv", "ciphertext")]
    if len(salt) != 16 or len(iv) != 12 or not 16 <= len(ciphertext) <= 65552 or len(password) < 16:
        raise ValueError("Invalid encrypted handoff")
    key = PBKDF2HMAC(algorithm=SHA256(), length=32, salt=salt, iterations=310000).derive(password.encode())
    payload = json.loads(AESGCM(key).decrypt(iv, ciphertext, AAD))
    return validate(payload, expected_url, expected_name)


def keychain():
    if sys.platform != "darwin":
        raise ValueError("Keychain mode is available only on macOS; use private runtime environment on other systems")
    library = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
    library.SecKeychainAddGenericPassword.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_char_p,
        ctypes.c_uint32,
        ctypes.c_char_p,
        ctypes.c_uint32,
        ctypes.c_char_p,
        ctypes.c_void_p,
    ]
    library.SecKeychainAddGenericPassword.restype = ctypes.c_int32
    library.SecKeychainFindGenericPassword.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_char_p,
        ctypes.c_uint32,
        ctypes.c_char_p,
        ctypes.POINTER(ctypes.c_uint32),
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_void_p,
    ]
    library.SecKeychainFindGenericPassword.restype = ctypes.c_int32
    library.SecKeychainItemFreeContent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
    library.SecKeychainItemFreeContent.restype = ctypes.c_int32
    return library


def validate_service(service):
    if not re.fullmatch(r"job_intel_tracker\.[A-Za-z][A-Za-z0-9_.-]{0,79}", service):
        raise ValueError("Use a dedicated job_intel_tracker Keychain service")


def store_keychain(service, payload):
    validate_service(service)
    library = keychain()
    service_bytes, account, content = service.encode(), payload["name"].encode(), json.dumps(payload).encode()
    result = library.SecKeychainAddGenericPassword(
        None, len(service_bytes), service_bytes, len(account), account, len(content), content, None
    )
    if result:
        raise ValueError("Keychain refused storage; existing entries are never overwritten")


def load_keychain(service, name, base_url):
    validate_service(service)
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,39}", name) or name == "owner":
        raise ValueError("Invalid agent credential name")
    library = keychain()
    service_bytes, account = service.encode(), name.encode()
    length, content = ctypes.c_uint32(), ctypes.c_void_p()
    result = library.SecKeychainFindGenericPassword(
        None,
        len(service_bytes),
        service_bytes,
        len(account),
        account,
        ctypes.byref(length),
        ctypes.byref(content),
        None,
    )
    if result:
        raise ValueError("Approved Keychain credential unavailable")
    try:
        if not 0 < length.value <= 65536:
            raise ValueError("Invalid Keychain credential")
        return validate(json.loads(ctypes.string_at(content, length.value)), base_url, name)
    finally:
        library.SecKeychainItemFreeContent(None, content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capsule", type=Path)
    parser.add_argument("--service", required=True)
    parser.add_argument("--agent", required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--confirm-store", action="store_true")
    args = parser.parse_args()
    try:
        if not args.confirm_store:
            raise ValueError("Explicit owner confirmation is required to store a credential")
        # Fail before prompting/decrypting on unsupported hosts.
        if sys.platform != "darwin":
            raise ValueError("Keychain storage requires macOS")
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            password = getpass.getpass("Handoff passphrase: ")
        payload = decrypt_capsule(args.capsule, password, args.base_url, args.agent)
        store_keychain(args.service, payload)
        print(
            "Approved credential stored in Keychain. No token was displayed. The encrypted handoff can be deleted privately."
        )
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        AttributeError,
        EOFError,
        InvalidTag,
        ctypes.ArgumentError,
        getpass.GetPassWarning,
    ):
        parser.exit(
            1, "Credential import refused; check handoff, passphrase, expected server/agent and Keychain access.\n"
        )


if __name__ == "__main__":
    main()
