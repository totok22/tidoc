#!/usr/bin/env python3
"""Generate manifest notes and GitHub release notes from the newest changelog section."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def newest_changelog_section(text: str) -> str:
    match = re.search(r"^##\s+.+$", text, flags=re.MULTILINE)
    if not match:
        return ""
    start = match.end()
    next_match = re.search(r"^##\s+.+$", text[start:], flags=re.MULTILINE)
    end = start + next_match.start() if next_match else len(text)
    return text[start:end].strip()


def bullet_notes(section: str) -> list[str]:
    return [
        match.group(1).strip()
        for line in section.splitlines()
        if (match := re.match(r"^\s*-\s+(.+?)\s*$", line))
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", required=True)
    parser.add_argument("--changelog", default="CHANGELOG.md")
    parser.add_argument("--output", required=True)
    parser.add_argument("--json-output", required=True)
    args = parser.parse_args()

    section = newest_changelog_section(Path(args.changelog).read_text("utf-8"))
    notes = bullet_notes(section) or [f"Tidoc {args.version} 稳定性与体验改进。"]
    markdown = f"# Tidoc {args.version}\n\n## What's changed\n\n{section or '- 稳定性与体验改进。'}\n"
    markdown += (
        "\n## 安装包\n\n"
        f"- macOS：`tidoc-core-macos-v{args.version}.dmg`\n"
        f"- Windows：`tidoc-core-windows-v{args.version}.exe`\n"
        "\n打印导出组件为可选安装。软件内下载会校验文件完整性。\n"
    )
    Path(args.output).write_text(markdown, "utf-8")
    Path(args.json_output).write_text(json.dumps(notes, ensure_ascii=False, indent=2) + "\n", "utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
