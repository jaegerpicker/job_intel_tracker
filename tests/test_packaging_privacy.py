"""Build an isolated synthetic source tree; never touch a live tracker or network."""

import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path


def test_source_and_wheel_exclude_private_assets_and_retain_public_ui(tmp_path):
    root = Path(__file__).resolve().parents[1]
    source = tmp_path / "synthetic-source"
    source.mkdir()
    for name in [
        "pyproject.toml",
        "LICENSE",
        "MANIFEST.in",
        "THIRD_PARTY_NOTICES.md",
        "CONTRIBUTING.md",
        ".env.example",
    ]:
        shutil.copy2(root / name, source / name)
    shutil.copytree(
        root / "job_intel_tracker", source / "job_intel_tracker", ignore=shutil.ignore_patterns("__pycache__")
    )
    # Only fixture copies receive these files; the actual checkout is untouched.
    static = source / "job_intel_tracker" / "static"
    marker = b"SYNTHETIC_PRIVATE_ASSET_DO_NOT_PACKAGE"
    private_names = ["private-note.js", "private-records.json", "synthetic-resume.pdf", ".env.local", "signing.p8"]
    for name in private_names:
        (static / name).write_bytes(marker)
    subprocess.run(
        [sys.executable, "-m", "build", "--no-isolation", str(source)],
        check=True,
        capture_output=True,
        timeout=20,
    )
    public_names = {"app.js", "credential-capsule.js", "secure-handoff.js", "index.html", "enroll.html", "style.css"}
    with zipfile.ZipFile(next((source / "dist").glob("*.whl"))) as archive:
        names = archive.namelist()
        assert public_names <= {Path(name).name for name in names}
        assert any(name.endswith("/licenses/LICENSE") for name in names)
        for name in names:
            assert Path(name).name not in private_names
            assert marker not in archive.read(name)
    with tarfile.open(next((source / "dist").glob("*.tar.gz"))) as archive:
        names = archive.getnames()
        assert public_names <= {Path(name).name for name in names}
        assert all(Path(name).name not in private_names for name in names)
        assert any(name.endswith("/.env.example") for name in names)
