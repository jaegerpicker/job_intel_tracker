"""Offline private backup/restore. Never place archives in a public repository."""

import argparse
import shutil
import sqlite3
from pathlib import Path


def backup(source: Path, destination: Path):
    if destination.exists():
        raise ValueError("Backup destination must be new")
    if destination.resolve().is_relative_to(source.resolve()):
        raise ValueError("Backup must be outside the data directory")
    destination.mkdir(mode=0o700, parents=True)
    with sqlite3.connect(source / "tracker.sqlite3", timeout=30) as lock:
        lock.execute("BEGIN IMMEDIATE")
        # A second read connection snapshots the committed DB while writer lock keeps files stable.
        with (
            sqlite3.connect(source / "tracker.sqlite3") as src,
            sqlite3.connect(destination / "tracker.sqlite3") as dst,
        ):
            src.backup(dst)
        shutil.copytree(source / "uploads", destination / "uploads")
        lock.rollback()
    return destination


def restore(source: Path, destination: Path):
    if destination.exists():
        raise ValueError("Restore only to a new destination with service stopped")
    with sqlite3.connect(source / "tracker.sqlite3") as c:
        if c.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Invalid backup database")
    shutil.copytree(source, destination)
    destination.chmod(0o700)
    # Sessions and OAuth login flows must not be restored; agent credentials are revoked.
    with sqlite3.connect(destination / "tracker.sqlite3") as c:
        c.execute("DELETE FROM sessions")
        c.execute("DELETE FROM flows")
        c.execute("UPDATE tokens SET revoked=1")
    return destination


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=["backup", "restore"])
    p.add_argument("source", type=Path)
    p.add_argument("destination", type=Path)
    a = p.parse_args()
    (backup if a.action == "backup" else restore)(a.source, a.destination)


if __name__ == "__main__":
    main()
