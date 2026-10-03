"""Local operator-controlled owner enrollment; never creates a board session."""

import argparse
import hashlib
import json
import os
import secrets
import sqlite3
import stat
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

ISSUER = "https://appleid.apple.com"
TABLE = """CREATE TABLE IF NOT EXISTS owner_enrollment(
 id INTEGER PRIMARY KEY CHECK(id=1), instance TEXT NOT NULL, phase TEXT NOT NULL,
 code_hash TEXT, state_hash TEXT, nonce TEXT, candidate_sub TEXT,
 client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, issuer TEXT NOT NULL, expires REAL NOT NULL
)"""


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def apple_binding() -> tuple[str, str, str]:
    client = os.getenv("APPLE_CLIENT_ID", "")
    redirect = os.getenv("APPLE_REDIRECT_URI", "")
    url = urlparse(redirect)
    if (
        not client
        or url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or url.path != "/auth/callback"
    ):
        raise ValueError("Configure the exact HTTPS /auth/callback and Apple client ID first")
    return client, redirect, ISSUER


def read_private(path: Path) -> dict:
    """Read an operator-owned regular 0600 file without following symlinks."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(fd)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or stat.S_IMODE(metadata.st_mode) != 0o600
            or metadata.st_size > 8192
        ):
            raise ValueError("Private setup file must be a regular operator-owned 0600 file")
        with os.fdopen(fd, "r") as stream:
            fd = -1
            result = json.load(stream)
        if not isinstance(result, dict):
            raise TypeError("Invalid private setup file")
        return result
    finally:
        if fd >= 0:
            os.close(fd)


def owner_subject() -> str | None:
    """Snapshot at service startup. Invalid files never fall back to open enrollment."""
    configured = os.getenv("APPLE_OWNER_SUB") or None
    file_name = os.getenv("APPLE_OWNER_SUB_FILE")
    if file_name:
        path = Path(file_name)
        # Missing files are expected before explicit enrollment approval. Dangling symlinks are not.
        if path.exists() or path.is_symlink():
            payload = read_private(path)
            client, redirect, issuer = apple_binding()
            if (
                payload.get("issuer") != issuer
                or payload.get("client_id") != client
                or payload.get("redirect_uri") != redirect
                or payload.get("approved") is not True
                or not isinstance(payload.get("sub"), str)
                or not payload["sub"]
                or len(payload["sub"]) > 512
            ):
                raise ValueError("Invalid or mismatched approved owner file")
            if configured and configured != payload["sub"]:
                raise ValueError("Conflicting owner configuration")
            configured = payload["sub"]
    return configured


def has_owner_file() -> bool:
    name = os.getenv("APPLE_OWNER_SUB_FILE")
    return bool(name and (Path(name).exists() or Path(name).is_symlink()))


def private_root(root: Path) -> Path:
    if root.is_symlink():
        raise ValueError("Private data directory cannot be a symlink")
    metadata = root.stat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError("Use an operator-owned private data directory (0700)")
    path = root / "tracker.sqlite3"
    if path.is_symlink() or not path.is_file():
        raise ValueError("Initialize the locked app database first; no symlink databases")
    return root.resolve()


def write_private(root: Path, target: Path, payload: dict) -> None:
    if target.parent.resolve() != root.resolve():
        raise ValueError("Setup files must be direct children of the private data directory")
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w") as stream:
            fd = -1
            json.dump(payload, stream)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    finally:
        if fd >= 0:
            os.close(fd)


def connection(root: Path):
    root = private_root(root)
    c = sqlite3.connect(root / "tracker.sqlite3", timeout=20)
    c.row_factory = sqlite3.Row
    c.execute(TABLE)
    return c


def fresh(c) -> None:
    for table in ("records", "attachments", "tokens", "sessions", "revisions", "idem", "audit", "flows"):
        if c.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]:
            raise ValueError("Enrollment requires a fresh empty board with no credentials or sessions")
    prior = c.execute("SELECT phase FROM owner_enrollment WHERE id=1").fetchone()
    if prior and prior["phase"] == "approved":
        raise ValueError("Previously approved ownership cannot be reenrolled")


def require_unowned() -> None:
    if owner_subject() or has_owner_file():
        raise ValueError("Owner already configured; enrollment cannot replace ownership")
    if not os.getenv("APPLE_OWNER_SUB_FILE"):
        raise ValueError("Set an explicit private APPLE_OWNER_SUB_FILE destination first")


def begin(root: Path, code_file: Path) -> None:
    """Explicit future operator action; code tests patch randomness with inert fixtures."""
    require_unowned()
    client, redirect, issuer = apple_binding()
    if os.getenv("TRACKER_DEMO") == "1":
        raise ValueError("Enrollment is unavailable in demo")
    root = private_root(root)
    if Path(os.environ["APPLE_OWNER_SUB_FILE"]).parent.resolve() != root:
        raise ValueError("Approved owner file must be within the private data directory")
    with connection(root) as c:
        c.execute("BEGIN IMMEDIATE")
        fresh(c)
        existing = c.execute("SELECT phase,expires FROM owner_enrollment WHERE id=1").fetchone()
        if existing and existing["phase"] not in ("cancelled", "failed") and existing["expires"] > time.time():
            raise ValueError("Cancel the existing enrollment before beginning another")
        code = secrets.token_urlsafe(32)
        write_private(root, code_file, {"code": code, "expires": time.time() + 600})
        try:
            c.execute(
                "INSERT OR REPLACE INTO owner_enrollment VALUES(1,?,?,?,?,?,?,?,?,?,?)",
                (
                    uuid.uuid4().hex,
                    "pending",
                    digest(code),
                    None,
                    None,
                    None,
                    client,
                    redirect,
                    issuer,
                    time.time() + 600,
                ),
            )
        except sqlite3.Error:
            code_file.unlink(missing_ok=True)
            raise


def bound(ticket) -> bool:
    return (ticket["client_id"], ticket["redirect_uri"], ticket["issuer"]) == apple_binding()


def candidate(ticket) -> dict:
    return {
        "instance": ticket["instance"],
        "issuer": ticket["issuer"],
        "client_id": ticket["client_id"],
        "redirect_uri": ticket["redirect_uri"],
        "sub": ticket["candidate_sub"],
        "expires": ticket["expires"],
    }


def review(root: Path, review_file: Path) -> None:
    require_unowned()
    with connection(root) as c:
        fresh(c)
        ticket = c.execute("SELECT * FROM owner_enrollment WHERE id=1 AND phase='candidate'", ()).fetchone()
        if not ticket or ticket["expires"] <= time.time() or not bound(ticket):
            raise ValueError("No current verified candidate; restart enrollment")
        write_private(root, review_file, candidate(ticket))


def approve(root: Path, review_file: Path, confirmed: bool = False) -> None:
    if not confirmed:
        raise ValueError("Explicit local owner confirmation is required")
    require_unowned()
    root = private_root(root)
    reviewed = read_private(review_file)
    with connection(root) as c:
        c.execute("BEGIN IMMEDIATE")
        fresh(c)
        ticket = c.execute("SELECT * FROM owner_enrollment WHERE id=1 AND phase='candidate'").fetchone()
        if not ticket or ticket["expires"] <= time.time() or not bound(ticket) or candidate(ticket) != reviewed:
            raise ValueError("Candidate expired, cancelled, changed, or not reviewed")
        target = Path(os.environ["APPLE_OWNER_SUB_FILE"])
        # O_EXCL plus the writer lock prevents approval races or overwriting any prior allowlist.
        write_private(root, target, {**reviewed, "approved": True})
        c.execute(
            "UPDATE owner_enrollment SET phase='approved',code_hash=NULL,state_hash=NULL,nonce=NULL,candidate_sub=NULL WHERE id=1"
        )
        c.execute("DELETE FROM flows")
        c.execute(
            "INSERT INTO audit(actor,action,resource,timestamp) VALUES('local-operator','approve-owner','owner-enrollment',?)",
            (time.time(),),
        )


def cancel(root: Path) -> None:
    with connection(root) as c:
        c.execute("BEGIN IMMEDIATE")
        ticket = c.execute("SELECT phase FROM owner_enrollment WHERE id=1").fetchone()
        if ticket and ticket["phase"] == "approved":
            raise ValueError("Approved ownership cannot be cancelled through enrollment")
        c.execute(
            "UPDATE owner_enrollment SET phase='cancelled',code_hash=NULL,state_hash=NULL,nonce=NULL,candidate_sub=NULL,expires=0 WHERE id=1"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("begin", "review", "approve", "cancel"))
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--code-file", type=Path)
    parser.add_argument("--review-file", type=Path)
    parser.add_argument("--confirm-owner", action="store_true")
    args = parser.parse_args()
    try:
        if args.action == "begin":
            if not args.code_file:
                parser.error("--code-file is required")
            begin(args.data_dir, args.code_file)
        elif args.action == "review":
            if not args.review_file:
                parser.error("--review-file is required")
            review(args.data_dir, args.review_file)
        elif args.action == "approve":
            if not args.review_file:
                parser.error("--review-file is required")
            approve(args.data_dir, args.review_file, args.confirm_owner)
        else:
            cancel(args.data_dir)
        print("Local enrollment action completed. No board session or agent credential was created.")
    except (ValueError, TypeError, OSError, sqlite3.Error):
        parser.exit(
            1, "Enrollment refused; check private paths, configuration, current state and local confirmation.\n"
        )


if __name__ == "__main__":
    main()
