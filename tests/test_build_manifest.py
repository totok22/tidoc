import json
import subprocess
import sys
from pathlib import Path


def test_build_manifest_script(tmp_path):
    release = tmp_path / "release"
    release.mkdir()
    (release / "tidoc-core-windows-v0.3.0.exe").write_bytes(b"core-win")
    (release / "tidoc-core-macos-v0.3.0.dmg").write_bytes(b"core-mac")
    (release / "tidoc-print-windows-v0.3.0.exe").write_bytes(b"print-win")

    script = Path(__file__).resolve().parents[1] / "scripts" / "build_manifest.py"
    subprocess.run(
        [sys.executable, str(script), "--release-dir", str(release), "--version", "0.3.0"],
        check=True,
    )

    manifest = json.loads((release / "manifest.json").read_text("utf-8"))
    assert manifest["components"]["core"]["latest"] == "0.3.0"
    assert "windows" in manifest["components"]["core"]["platforms"]
    assert "macos" in manifest["components"]["core"]["platforms"]
    assert manifest["components"]["print"]["platforms"]["windows"]["key"].startswith("tidoc/print/windows/")
    assert (release / "upload_plan.tsv").read_text("utf-8").count("\n") == 3


def test_build_manifest_uses_structured_release_notes(tmp_path):
    release = tmp_path / "release"
    release.mkdir()
    (release / "tidoc-core-windows-v0.4.0.exe").write_bytes(b"core")
    notes = tmp_path / "notes.json"
    notes.write_text(json.dumps(["更新界面", "减少启动检查频率"], ensure_ascii=False), "utf-8")

    script = Path(__file__).resolve().parents[1] / "scripts" / "build_manifest.py"
    subprocess.run(
        [
            sys.executable,
            str(script),
            "--release-dir",
            str(release),
            "--version",
            "0.4.0",
            "--notes-file",
            str(notes),
        ],
        check=True,
    )

    manifest = json.loads((release / "manifest.json").read_text("utf-8"))
    assert manifest["components"]["core"]["notes"] == ["更新界面", "减少启动检查频率"]
