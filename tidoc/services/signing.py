"""HMAC 签名（设计文档第 6.1 节）。

检测级防篡改：密钥内置于软件，对绑定包内每个文件与汇总文本算 HMAC-SHA256，
生成签名清单。导入时逐项校验，不符即判定"已被外部修改"，醒目标红，不静默接受。
这是检测而非加密；已确认不上非对称签名。
"""

from __future__ import annotations

import hashlib
import hmac
from pathlib import Path

# 内置密钥。注意：这是检测级方案，密钥随软件分发，能识别手工乱改即达标。
_BUILTIN_KEY = b"tidoc-v1-builtin-hmac-key-do-not-rely-for-secrecy"

MANIFEST_NAME = "signatures.json"


def sign_bytes(data: bytes, key: bytes = _BUILTIN_KEY) -> str:
    return hmac.new(key, data, hashlib.sha256).hexdigest()


def sign_file(path: str | Path, key: bytes = _BUILTIN_KEY) -> str:
    h = hmac.new(key, digestmod=hashlib.sha256)
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def verify(data: bytes, signature: str, key: bytes = _BUILTIN_KEY) -> bool:
    """常数时间比较，防时序侧信道。"""
    return hmac.compare_digest(sign_bytes(data, key), signature)
