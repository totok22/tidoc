"""数据根目录与附件仓库的路径管理（设计文档第 5 节存储布局）。

<数据根目录>/
├─ tidoc.sqlite            结构化数据
├─ attachments/<entry_id>/ 附件文件仓库
├─ exports/                导出的绑定包 / 汇总 / 打印件
└─ dropped/                拖拽文件临时中转区
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_DIR_NAME = "Tidoc"


def default_data_root() -> Path:
    """系统应用数据目录下的默认根目录。设置里可改到用户指定位置。"""
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif sys.platform.startswith("win"):
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / APP_DIR_NAME


class DataRoot:
    """封装一个数据根目录下的所有子路径，并保证目录存在。"""

    def __init__(self, root: str | Path | None = None):
        self.root = Path(root) if root else default_data_root()
        self.root.mkdir(parents=True, exist_ok=True)
        self.attachments_dir.mkdir(parents=True, exist_ok=True)
        self.exports_dir.mkdir(parents=True, exist_ok=True)
        self.dropped_dir.mkdir(parents=True, exist_ok=True)

    @property
    def db_path(self) -> Path:
        return self.root / "tidoc.sqlite"

    @property
    def attachments_dir(self) -> Path:
        return self.root / "attachments"

    @property
    def exports_dir(self) -> Path:
        return self.root / "exports"

    @property
    def dropped_dir(self) -> Path:
        return self.root / "dropped"

    def entry_dir(self, entry_id: str) -> Path:
        """某个条目的附件目录，按需创建。"""
        path = self.attachments_dir / entry_id
        path.mkdir(parents=True, exist_ok=True)
        return path
