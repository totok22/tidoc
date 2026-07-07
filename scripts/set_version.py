#!/usr/bin/env python3
"""Set package versions for release builds."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("version")
    args = parser.parse_args()
    for file in (Path("tidoc/__init__.py"), Path("tidoc_print/__init__.py")):
        text = file.read_text("utf-8")
        text = re.sub(r'__version__ = "[^"]+"', f'__version__ = "{args.version}"', text)
        file.write_text(text, "utf-8")
        print(f"set {file} to {args.version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
