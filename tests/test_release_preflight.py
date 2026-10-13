"""Synthetic fixtures only; tests never read the live tracker or use network access."""

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.release_preflight import audit, git, main


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / "fixture"
        self.repo.mkdir()
        self.git("init", "-q")
        self.git("config", "user.name", "Synthetic Test")
        self.git("config", "user.email", "fixture@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.write("README.md", "Synthetic release fixture\n")
        self.commit()

    def git(self, *args):
        return git(self.repo, *args)

    def write(self, name, content):
        (self.repo / name).write_text(content)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "Synthetic fixture")

    def test_history_and_staged_candidates_do_not_expose_values(self):
        synthetic_key = "AKIA" + "Z" * 16
        self.write(".env", "TEST_ONLY=" + synthetic_key + "\n")
        self.commit()
        self.git("rm", ".env")
        self.git("commit", "-qm", "Remove synthetic credential")
        self.write("notes.txt", "invented@synthetic-fixture.local\n")
        self.git("add", "notes.txt")
        before = self.git("status", "--porcelain=v1")
        report = audit(self.repo)
        kinds = {f["kind"] for f in report["findings"]}
        self.assertTrue({"private-path", "aws-access-key", "email-address"} <= kinds)
        self.assertNotIn(synthetic_key, json.dumps(report))
        self.assertNotIn("invented@synthetic-fixture.local", json.dumps(report))
        self.assertEqual(before, self.git("status", "--porcelain=v1"))
        self.assertFalse(report["incomplete"])

    def test_examples_and_git_identity_are_excluded(self):
        self.write(".env.example", "EMAIL=person@example.com\n")
        self.commit()
        self.assertEqual([], audit(self.repo)["findings"])

    def test_limits_cannot_return_clearance(self):
        self.assertTrue(audit(self.repo, max_objects=1)["incomplete"])
        self.assertTrue(audit(self.repo, max_bytes=1)["incomplete"])

    def test_private_index_alias_is_found_for_an_existing_blob(self):
        self.write(".env", (self.repo / "README.md").read_text())
        self.git("add", ".env")
        report = audit(self.repo)
        self.assertTrue(any(f["kind"] == "private-path" and f["path"] == ".env" for f in report["findings"]))

    def test_ambient_git_paths_cannot_redirect_the_audit(self):
        head = self.git("rev-parse", "HEAD").decode().strip()
        with patch.dict(
            os.environ, {"GIT_DIR": str(self.repo / "missing"), "GIT_INDEX_FILE": str(self.repo / "missing-index")}
        ):
            self.assertEqual(head, audit(self.repo)["head"])

    def test_long_synthetic_text_cannot_make_the_regex_pass_unbounded(self):
        self.write("large.txt", "A" * 800_000 + "\n" + "user@example.com\n" * 30_000)
        self.commit()
        output = Path(self.temp.name) / "bounded.json"
        script = Path(__file__).resolve().parents[1] / "scripts" / "release_preflight.py"
        result = subprocess.run(
            [sys.executable, str(script), str(self.repo), "--report", str(output), "--max-seconds", "4"],
            timeout=5,
            check=True,
            capture_output=True,
        )
        self.assertEqual(0, result.returncode)
        self.assertFalse(json.loads(output.read_text())["incomplete"])

    def test_transports_are_disabled_even_for_implicit_fetch(self):
        # An invalid host must fail at transport permission before network access.
        with self.assertRaises(subprocess.CalledProcessError) as result:
            git(self.repo, "fetch", "https://synthetic.example.invalid/repo.git")
        self.assertIn(b"transport 'https' not allowed", result.exception.stderr)

    def test_no_match_email_runs_cannot_retry_overlapping_suffixes(self):
        self.write("large-no-match.txt", ".A" * 400_000 + "\n")
        self.commit()
        output = Path(self.temp.name) / "no-match.json"
        script = Path(__file__).resolve().parents[1] / "scripts" / "release_preflight.py"
        result = subprocess.run(
            [sys.executable, str(script), str(self.repo), "--report", str(output), "--max-seconds", "4"],
            timeout=5,
            check=True,
            capture_output=True,
        )
        self.assertEqual(0, result.returncode)
        report = json.loads(output.read_text())
        self.assertFalse(report["incomplete"])
        self.assertEqual([], report["findings"])

    def test_binary_document_requires_manual_review(self):
        (self.repo / "synthetic-resume.pdf").write_bytes(b"%PDF\x00synthetic fixture")
        self.commit()
        report = audit(self.repo)
        self.assertEqual(1, report["binary_blobs"])
        self.assertIn("private-path", {f["kind"] for f in report["findings"]})

    def test_cli_counts_only_and_private_report(self):
        self.write("data.txt", "-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n")
        self.commit()
        output = Path(self.temp.name) / "report.json"
        stdout = io.StringIO()
        with patch("sys.argv", ["audit", str(self.repo), "--report", str(output)]), contextlib.redirect_stdout(stdout):
            self.assertEqual(1, main())
        self.assertNotIn("SYNTHETIC", stdout.getvalue())
        self.assertNotIn("data.txt", stdout.getvalue())
        self.assertEqual(0o600, os.stat(output).st_mode & 0o777)
        original = output.read_bytes()
        with (
            patch("sys.argv", ["audit", str(self.repo), "--report", str(output)]),
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit),
        ):
            main()
        self.assertEqual(original, output.read_bytes())


if __name__ == "__main__":
    unittest.main()
