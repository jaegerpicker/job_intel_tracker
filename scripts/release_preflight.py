#!/usr/bin/env python3
"""Bounded, read-only Git preflight. Never print matched content or contact a service."""

import argparse
import collections
import json
import os
import re
import subprocess
import time
from bisect import bisect_right
from pathlib import Path

# Candidates require local human review; detection is intentionally conservative.
PATTERNS = {
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "aws-access-key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "github-token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    "openai-key": re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b"),
    "credential-url": re.compile(rb"\b[a-z][a-z0-9+.-]{0,31}://[^\s/:]+:[^\s/@]+@", re.IGNORECASE),
    # Start only at the beginning of a local-part run. A word boundary retries
    # the same suffix after every dot/plus/etc. in large no-match inputs.
    "email-address": re.compile(rb"(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b", re.IGNORECASE),
}
PRIVATE_PATH = re.compile(
    r"(?:^|/)(?:\.env(?:\.(?!example$|sample$)[^/]*)?|credentials(?:\.[^/]+)?|"
    r"id_rsa|id_ed25519|[^/]*(?:resume|curriculum.?vitae)[^/]*|"
    r"[^/]*\.(?:sqlite3?(?:-(?:wal|shm|journal))?|db(?:-(?:wal|shm|journal))?|p8|p12|pfx|key|pem|jks|mobileprovision|pdf|docx))$",
    re.IGNORECASE,
)


def git(repo, *args, timeout=8):
    # Ambient Git overrides must not redirect inspection to another worktree/index.
    environment = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    environment.update(
        GIT_NO_LAZY_FETCH="1",
        GIT_TERMINAL_PROMPT="0",
        GIT_ALLOW_PROTOCOL="",
        GIT_CONFIG_NOSYSTEM="1",
        GIT_CONFIG_GLOBAL=os.devnull,
    )
    return subprocess.run(
        ["git", "--no-optional-locks", "-c", "core.hooksPath=/dev/null", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        timeout=timeout,
        env=environment,
    ).stdout


def audit(repo, *, max_objects=2000, max_bytes=2_000_000, max_seconds=45):
    start = time.monotonic()

    def bounded_git(*args):
        remaining = max_seconds - (time.monotonic() - start)
        if remaining <= 0:
            raise subprocess.TimeoutExpired("git", max_seconds)
        return git(repo, *args, timeout=min(8, remaining))

    # Snapshot the checkout identity without copying credentials from remote URLs.
    head = bounded_git("rev-parse", "HEAD").decode().strip()
    refs = bounded_git("for-each-ref", "--format=%(refname) %(objectname)").decode().splitlines()
    raw = bounded_git("rev-list", "--all", "--objects").decode("utf-8", "surrogateescape")
    objects = collections.OrderedDict()
    for line in raw.splitlines():
        oid, _, path = line.partition(" ")
        objects.setdefault(oid, set()).add(path)
    # Also include staged files even when they are not reachable from a commit.
    staged = bounded_git("ls-files", "--stage", "-z")
    for record in staged.split(b"\0"):
        if not record:
            continue
        metadata, path = record.split(b"\t", 1)
        mode, oid, _ = metadata.decode().split()
        if mode != "160000":  # Submodule contents need a separate repository audit.
            objects.setdefault(oid, set()).add(path.decode("utf-8", "surrogateescape"))
    report = {
        "schema": 1,
        "head": head,
        "refs": refs,
        "scope": "objects reachable from local refs plus index; no remote fetch",
        "limitations": [
            "Heuristic candidates, not proof of a secret or public-release clearance.",
            "No unstaged worktree contents, ignored/untracked files, reflogs, dangling objects, remote-only refs, submodules or LFS payloads.",
            "Git object enumeration may retain only one historical alias; index aliases are included.",
            "Binary/private documents require manual review. No dependency/license or vulnerability evaluation.",
            "Paths in this local report may be private; do not publish the report.",
        ],
        "incomplete": [],
        "findings": [],
        "objects_total": len(objects),
        "objects_scanned": 0,
        "blobs_scanned": 0,
        "binary_blobs": 0,
        "binary_objects": [],
    }
    if len(objects) > max_objects:
        report["incomplete"].append("object limit reached")
    for oid, paths in list(objects.items())[:max_objects]:
        path = min(paths)
        remaining = max_seconds - (time.monotonic() - start)
        if remaining <= 0:
            report["incomplete"].append("time limit reached")
            break
        try:
            kind = bounded_git("cat-file", "-t", oid).decode().strip()
            report["objects_scanned"] += 1
            if kind not in {"blob", "commit", "tag"}:
                continue
            for alias in sorted(paths):
                if alias and PRIVATE_PATH.search(alias):
                    report["findings"].append({"kind": "private-path", "object": oid, "path": alias})
            size = int(bounded_git("cat-file", "-s", oid))
            if size > max_bytes:
                report["incomplete"].append("oversized object " + oid)
                continue
            content = bounded_git("cat-file", kind, oid)
            if kind == "blob":
                report["blobs_scanned"] += 1
            if b"\0" in content:
                report["binary_blobs"] += 1
                report["binary_objects"].append({"object": oid, "paths": sorted(paths)})
                continue
            # Git identity headers are expected. Scan commit/tag messages, not authors.
            if kind in {"commit", "tag"}:
                content = content.partition(b"\n\n")[2]
            newlines = [m.start() for m in re.finditer(b"\n", content)]
            for name, pattern in PATTERNS.items():
                if time.monotonic() - start >= max_seconds:
                    report["incomplete"].append("time limit reached")
                    break
                lines = set()
                for match in pattern.finditer(content):
                    if time.monotonic() - start >= max_seconds:
                        report["incomplete"].append("time limit reached")
                        break
                    # Reserved example domains are safe synthetic samples.
                    if name == "email-address" and (
                        match.group(1).lower() in {b"example.com", b"example.net", b"example.org"}
                        or match.group(1).lower().endswith((b".invalid", b".test", b".example"))
                    ):
                        continue
                    lines.add(bisect_right(newlines, match.start()) + 1)
                if lines:
                    report["findings"].append(
                        {
                            "kind": name,
                            "object": oid,
                            "path": path,
                            "lines": sorted(lines),
                        }
                    )
        except (subprocess.SubprocessError, ValueError):
            report["incomplete"].append("unreadable object " + oid)
            break
    report["incomplete"] = list(dict.fromkeys(report["incomplete"]))
    report["elapsed_seconds"] = round(time.monotonic() - start, 2)
    return report


def positive(value):
    value = int(value)
    if value < 1:
        raise argparse.ArgumentTypeError("must be at least 1")
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path)
    parser.add_argument("--report", type=Path, required=True, help="new private local JSON file")
    parser.add_argument("--max-objects", type=positive, default=2000)
    parser.add_argument("--max-bytes", type=positive, default=2_000_000)
    parser.add_argument("--max-seconds", type=positive, default=45)
    args = parser.parse_args()
    if args.report.exists():
        parser.error("report already exists; choose a new path")
    try:
        report = audit(args.repo, max_objects=args.max_objects, max_bytes=args.max_bytes, max_seconds=args.max_seconds)
        # Exclusive creation preserves any existing records. Restrict local report access.
        fd = os.open(args.report, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as output:
            json.dump(report, output, indent=2, ensure_ascii=True)
            output.write("\n")
    except (OSError, subprocess.SubprocessError, ValueError):
        print("Audit failed; no source contents printed. Check local repository and report path.")
        return 2
    print(
        json.dumps(
            {
                "findings_by_kind": dict(collections.Counter(f["kind"] for f in report["findings"])),
                "objects_scanned": report["objects_scanned"],
                "objects_total": report["objects_total"],
                "incomplete_count": len(report["incomplete"]),
                "binary_blobs": report["binary_blobs"],
            }
        )
    )
    return 2 if report["incomplete"] else (1 if report["findings"] else 0)


if __name__ == "__main__":
    raise SystemExit(main())
