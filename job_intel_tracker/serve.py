"""Container initialization: prepare the private directory, then permanently drop root."""

import os
import stat
import tempfile
from pathlib import Path

SECRETS_ROOT = Path("/etc/secrets")
RUNTIME_TEMP_ROOT = Path("/tmp")
TRUSTED_MOUNT_UID = 0


def prepare_apple_key(uid=10001, gid=10001):
    """Stage only the configured mounted key in a private ephemeral runtime directory."""
    configured = os.getenv("APPLE_PRIVATE_KEY_FILE")
    if not configured or Path(configured).parent != SECRETS_ROOT:
        return
    # Render projects secret files through symlinks. Follow only links confined
    # to its root-controlled mount; open the resolved regular file without following.
    mount = SECRETS_ROOT.resolve(strict=True)
    resolved = Path(configured).resolve(strict=True)
    if not resolved.parent.is_relative_to(mount):
        raise ValueError("Mounted Apple key must stay within its trusted mount")
    parent = resolved.parent
    while True:
        metadata = parent.stat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != TRUSTED_MOUNT_UID or metadata.st_mode & 0o022:
            raise ValueError("Untrusted Apple secret mount directory")
        if parent == mount:
            break
        parent = parent.parent
    source = os.open(resolved, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(source)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid not in (0, uid)
            or metadata.st_mode & 0o022
            or not 0 < metadata.st_size <= 8192
        ):
            raise ValueError("Invalid mounted Apple key metadata")
        with os.fdopen(source, "rb") as stream:
            source = -1
            content = stream.read(8193)
        if not 0 < len(content) <= 8192:
            raise ValueError("Invalid mounted Apple key size")
        directory = Path(tempfile.mkdtemp(prefix="job-intel-apple-", dir=RUNTIME_TEMP_ROOT))
        target = directory / "key.p8"
        try:
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fchown(stream.fileno(), uid, gid)
                os.fchmod(stream.fileno(), 0o600)
            os.chown(directory, uid, gid)
            os.chmod(directory, 0o700)
        except Exception:
            target.unlink(missing_ok=True)
            directory.rmdir()
            raise
        os.environ["APPLE_PRIVATE_KEY_FILE"] = str(target)
    finally:
        if source >= 0:
            os.close(source)


def main():
    port = int(os.getenv("PORT", "8000"))
    if not 1 <= port <= 65535:
        raise ValueError("Invalid PORT")
    root = Path(os.getenv("DATA_DIR", "/data"))
    if str(root) not in ("/data", "/var/data/tracker") or root.resolve() != root or root.is_symlink():
        raise ValueError("Container DATA_DIR must be /data or /var/data/tracker with no symlink ancestors")
    if os.getuid() == 0:
        root.mkdir(mode=0o700, parents=False, exist_ok=True)
        metadata = root.stat()
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid not in (0, 10001):
            raise ValueError("Unexpected data directory ownership")
        os.chown(root, 10001, 10001)
        os.chmod(root, 0o700)
        prepare_apple_key()
        os.setgroups([])
        os.setgid(10001)
        os.setuid(10001)
    os.execvp(
        "uvicorn",
        ["uvicorn", "job_intel_tracker.app:app", "--host", "0.0.0.0", "--port", str(port), "--no-access-log"],
    )


if __name__ == "__main__":
    main()
