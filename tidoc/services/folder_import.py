"""文件夹批量导入：扫描一个目录，按文件名启发式把发票 / 付款截图 / 查验单归组成条目。

设计取向（见 DESIGN.md 8.2 批量导入）：
- 只做「建议分组」，不强制用户重命名文件；前端拿到结果后可逐条调整归属再批量创建。
- 分组键优先用文件名里 ``<组号>+...`` 的前缀；其次尝试发票 PDF 解析出的发票号。
- 类型判定靠文件名关键词 + 扩展名；识别不了的归入 other，交由用户手动指认。
"""

from __future__ import annotations

import re
from pathlib import Path

# 各类型的文件名关键词（按优先级从具体到宽泛匹配）
_TYPE_KEYWORDS = [
    ("inspection_pdf", ("查验单", "查验")),
    ("payment_screenshot", ("付款截图", "付款", "截图", "支付")),
    ("invoice_pdf", ("发票",)),
]
_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
_PDF_EXT = {".pdf"}
_XML_EXT = {".xml"}
_SUPPORTED_EXT = _IMAGE_EXT | _PDF_EXT | _XML_EXT

# 组号前缀：文件名开头的数字，后接 + 或 ＋ 或 空格 或 _ 等分隔
_GROUP_PREFIX_RE = re.compile(r"^\s*(\d{1,6})\s*[+＋_\-\s]")


def _classify_type(name: str, suffix: str) -> str:
    """按文件名关键词 + 扩展名判定附件类型。"""
    if suffix in _XML_EXT:
        return "invoice_xml"
    for att_type, kws in _TYPE_KEYWORDS:
        if any(k in name for k in kws):
            # 「发票」关键词 + PDF → 发票 PDF；其余按关键词
            return att_type
    # 关键词命不中：图片默认当付款截图，PDF 无从判断归 other
    if suffix in _IMAGE_EXT:
        return "payment_screenshot"
    return "other"


def _group_key(name: str) -> str | None:
    """从文件名取分组键：开头的组号前缀。取不到返回 None。"""
    m = _GROUP_PREFIX_RE.match(name)
    if m:
        return m.group(1)
    return None


def scan_folder(folder: str | Path) -> dict:
    """扫描目录，返回建议分组。

    返回结构：
        {
          "groups": [
            {"key": "26", "label": "26",
             "files": [{"path", "name", "type", "type_label"}...]},
            ...
          ],
          "ungrouped": [{...file...}],   # 取不到组号的文件，交用户手动归属
          "total_files": int,
        }
    """
    folder = Path(folder)
    if not folder.is_dir():
        raise NotADirectoryError(f"不是有效目录：{folder}")

    groups: dict[str, list[dict]] = {}
    ungrouped: list[dict] = []
    total = 0

    for entry in sorted(folder.iterdir()):
        if not entry.is_file():
            continue
        suffix = entry.suffix.lower()
        if suffix not in _SUPPORTED_EXT:
            continue
        total += 1
        att_type = _classify_type(entry.name, suffix)
        file_info = {
            "path": str(entry),
            "name": entry.name,
            "type": att_type,
            "type_label": _TYPE_LABEL.get(att_type, att_type),
        }
        key = _group_key(entry.name)
        if key is None:
            ungrouped.append(file_info)
        else:
            groups.setdefault(key, []).append(file_info)

    group_list = [
        {"key": k, "label": k, "files": groups[k]}
        for k in sorted(groups, key=lambda s: (len(s), s))
    ]
    return {"groups": group_list, "ungrouped": ungrouped, "total_files": total}


_TYPE_LABEL = {
    "invoice_pdf": "发票 PDF",
    "invoice_xml": "发票 XML",
    "payment_screenshot": "付款截图",
    "inspection_pdf": "查验单",
    "other": "其他",
}
