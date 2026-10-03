"""Container initialization: prepare the private directory, then permanently drop root."""

import os
import stat
from pathlib import Path


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
        os.setgroups([])
        os.setgid(10001)
        os.setuid(10001)
    os.execvp(
        "uvicorn",
        ["uvicorn", "job_intel_tracker.app:app", "--host", "0.0.0.0", "--port", str(port), "--no-access-log"],
    )


if __name__ == "__main__":
    main()
