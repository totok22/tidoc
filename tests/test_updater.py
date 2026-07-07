import json
from pathlib import Path

from tidoc.services.updater import (
    check_updates,
    parse_version,
    sha256_file,
    version_gt,
)


def test_version_compare():
    assert parse_version("v1.2.3") == (1, 2, 3)
    assert version_gt("0.1.1", "0.1.0")
    assert version_gt("0.2.0", "0.1.9")
    assert not version_gt("0.1.0", "0.1.0")


def test_check_updates_from_file_manifest(tmp_path):
    artifact = tmp_path / "tidoc-print-windows-v0.2.0.exe"
    artifact.write_bytes(b"print")
    manifest = {
        "components": {
            "core": {
                "name": "tidoc 核心",
                "latest": "0.1.0",
                "platforms": {
                    "windows": {
                        "url": "https://example.com/core.exe",
                        "sha256": "0" * 64,
                        "filename": "core.exe",
                    }
                },
            },
            "print": {
                "name": "打印导出组件",
                "latest": "0.2.0",
                "platforms": {
                    "windows": {
                        "url": artifact.as_uri(),
                        "sha256": sha256_file(artifact),
                        "filename": artifact.name,
                    }
                },
            },
        }
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), "utf-8")

    status = check_updates(tmp_path / "components", manifest_path.as_uri(), plat="windows")
    updates = {item["component"]: item for item in status["updates"]}
    assert updates["core"]["available"] is False
    assert updates["print"]["available"] is True
