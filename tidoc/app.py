"""理票 · Tidoc 应用入口。

双击即进主界面：PyWebView 原生窗口加载 web/index.html，后端 API 通过
window.pywebview.api 暴露给前端。不开本地 HTTP 端口（设计文档第 2、4 节）。
"""

from __future__ import annotations

import sys
from pathlib import Path

import webview

from .api import Api

WEB_DIR = Path(__file__).parent / "web"


def main() -> None:
    api = Api()
    index = WEB_DIR / "index.html"
    window = webview.create_window(
        "理票 · Tidoc",
        url=str(index),
        js_api=api,
        width=1160,
        height=780,
        min_size=(920, 640),
    )
    api.bind_window(window)
    debug = "--debug" in sys.argv
    webview.start(debug=debug)


if __name__ == "__main__":
    main()
