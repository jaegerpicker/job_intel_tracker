import os
from pathlib import Path

import pytest

from job_intel_tracker import serve


def test_mounted_key_is_staged_privately_without_changing_source(tmp_path, monkeypatch):
    source = tmp_path / "mounted" / "fixture.p8"
    source.parent.mkdir()
    source.write_bytes(b"inert-ci-key-fixture")
    source.chmod(0o600)
    monkeypatch.setattr(serve, "SECRETS_ROOT", source.parent)
    monkeypatch.setattr(serve, "TRUSTED_MOUNT_UID", os.getuid())
    monkeypatch.setattr(serve, "RUNTIME_TEMP_ROOT", tmp_path)
    monkeypatch.setenv("TMPDIR", str(tmp_path / "must-not-be-used"))
    monkeypatch.setenv("APPLE_PRIVATE_KEY_FILE", str(source))
    before = source.stat()
    serve.prepare_apple_key(os.getuid(), os.getgid())
    target = Path(os.environ["APPLE_PRIVATE_KEY_FILE"])
    assert target != source and target.parent.parent == tmp_path
    assert target.read_bytes() == b"inert-ci-key-fixture"
    assert target.stat().st_mode & 0o777 == 0o600
    assert target.parent.stat().st_mode & 0o777 == 0o700
    assert target.stat().st_uid == target.parent.stat().st_uid == os.getuid()
    assert source.stat().st_mode == before.st_mode and source.stat().st_uid == before.st_uid
    assert source.read_bytes() == b"inert-ci-key-fixture"


@pytest.mark.parametrize("invalid", ["symlink", "writable", "empty", "oversize", "directory", "mount"])
def test_unsafe_mounted_key_fails_closed(tmp_path, monkeypatch, invalid):
    source = tmp_path / "fixture.p8"
    if invalid == "mount":
        source.symlink_to(tmp_path, target_is_directory=True)
    elif invalid == "directory":
        source.mkdir()
    else:
        source.write_bytes(b"x" * (8193 if invalid == "oversize" else 1))
        source.chmod(0o600)
        if invalid == "symlink":
            original = source.rename(tmp_path.parent / (tmp_path.name + "-outside-key"))
            source.symlink_to(original)
        elif invalid == "writable":
            source.chmod(0o666)
        elif invalid == "empty":
            source.write_bytes(b"")
    monkeypatch.setattr(serve, "SECRETS_ROOT", tmp_path)
    monkeypatch.setattr(serve, "TRUSTED_MOUNT_UID", os.getuid())
    monkeypatch.setenv("APPLE_PRIVATE_KEY_FILE", str(source))
    with pytest.raises((OSError, ValueError)):
        serve.prepare_apple_key(os.getuid(), os.getgid())
    assert os.environ["APPLE_PRIVATE_KEY_FILE"] == str(source)


def test_projected_mount_symlinks_are_confined_to_trusted_directories(tmp_path, monkeypatch):
    projected = tmp_path / "projection"
    projected.mkdir()
    target = projected / "fixture.p8"
    target.write_bytes(b"inert-ci-key-fixture")
    target.chmod(0o600)
    (tmp_path / "current").symlink_to(projected, target_is_directory=True)
    source = tmp_path / "fixture.p8"
    source.symlink_to(tmp_path / "current" / "fixture.p8")
    monkeypatch.setattr(serve, "SECRETS_ROOT", tmp_path)
    monkeypatch.setattr(serve, "RUNTIME_TEMP_ROOT", tmp_path)
    monkeypatch.setattr(serve, "TRUSTED_MOUNT_UID", os.getuid())
    monkeypatch.setenv("APPLE_PRIVATE_KEY_FILE", str(source))
    serve.prepare_apple_key(os.getuid(), os.getgid())
    assert Path(os.environ["APPLE_PRIVATE_KEY_FILE"]).read_bytes() == b"inert-ci-key-fixture"
    monkeypatch.setenv("APPLE_PRIVATE_KEY_FILE", str(source))
    projected.chmod(0o777)
    with pytest.raises(ValueError):
        serve.prepare_apple_key(os.getuid(), os.getgid())


def test_other_key_locations_are_not_staged(tmp_path, monkeypatch):
    source = tmp_path / "unopened.p8"
    monkeypatch.setenv("APPLE_PRIVATE_KEY_FILE", str(source))
    serve.prepare_apple_key()
    assert os.environ["APPLE_PRIVATE_KEY_FILE"] == str(source)
    monkeypatch.delenv("APPLE_PRIVATE_KEY_FILE")
    serve.prepare_apple_key()
    assert "APPLE_PRIVATE_KEY_FILE" not in os.environ
