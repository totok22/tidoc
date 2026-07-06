"""文件夹批量导入：扫描一个目录，把一批发票 PDF 快速拆成待创建条目。

设计取向：
- 批量只从发票 PDF 创建条目，可附带匹配到的 XML。
- 用户不需要提前重命名。XML 优先按发票号配对，其次按近似文件名配对。
- PDF 是必需材料；孤立 XML、付款截图、查验单只在预览里提示，不单独创建条目。
"""

from __future__ import annotations

import re
from pathlib import Path

from ..engine.parser import parse_invoice_files

_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
_PAYMENT_KEYWORDS = ("付款", "支付", "截图")
_INSPECTION_KEYWORDS = ("查验单", "查验", "验真")
_STEM_JUNK_RE = re.compile(r"[\s_\-+＋（）()\[\]【】{}.,，。]+")
_INVOICE_NO_RE = re.compile(r"\d{8,30}")


def _file_info(path: Path, att_type: str, invoice_no: str = "", warning: str = "") -> dict:
    return {
        "path": str(path),
        "name": path.name,
        "type": att_type,
        "type_label": _TYPE_LABEL.get(att_type, att_type),
        "invoice_no": invoice_no,
        "warning": warning,
    }


def _normalize_stem(path: Path) -> str:
    stem = path.stem.lower()
    for token in ("发票", "电子", "数电", "invoice", "pdf", "xml"):
        stem = stem.replace(token, "")
    return _STEM_JUNK_RE.sub("", stem)


def _invoice_no_from_name(path: Path) -> str:
    m = _INVOICE_NO_RE.search(path.stem)
    return m.group(0) if m else ""


def _parse_invoice_no(path: Path, att_type: str) -> tuple[str, str]:
    try:
        if att_type == "invoice_pdf":
            parsed = parse_invoice_files(pdf_path=path)
        else:
            parsed = parse_invoice_files(xml_path=path)
        return parsed.invoice_no or "", ""
    except Exception as exc:  # noqa: BLE001 - 扫描阶段只提示，不阻断导入预览
        guessed = _invoice_no_from_name(path)
        return guessed, f"未能预解析：{exc}"


def _pdf_attachment_type(path: Path) -> str:
    if any(k in path.name for k in _INSPECTION_KEYWORDS):
        return "inspection_pdf"
    if any(k in path.name for k in _PAYMENT_KEYWORDS):
        return "payment_screenshot"
    return "invoice_pdf"


def _match_xml(pdf: dict, xmls: list[dict], used: set[int]) -> int | None:
    pdf_no = pdf.get("invoice_no") or _invoice_no_from_name(Path(pdf["path"]))
    if pdf_no:
        for idx, xml in enumerate(xmls):
            if idx not in used and xml.get("invoice_no") == pdf_no:
                return idx
    pdf_stem = _normalize_stem(Path(pdf["path"]))
    for idx, xml in enumerate(xmls):
        if idx in used:
            continue
        xml_stem = _normalize_stem(Path(xml["path"]))
        if pdf_stem and xml_stem and (pdf_stem == xml_stem or pdf_stem in xml_stem or xml_stem in pdf_stem):
            return idx
    return None


def _scan_file_paths(file_paths: list[Path]) -> dict:
    """扫描一组文件，返回发票 PDF 导入预览。

    返回结构：
        {
          "groups": [
            {"key": "...", "label": "...", "selected": true,
             "invoice_no": "...",
             "files": [{"path", "name", "type", "type_label", "warning"}...],
             "warnings": [...]},
            ...
          ],
          "ungrouped": [{...file...}],   # 未匹配到 PDF 的 XML
          "ignored": [{...file...}],     # 付款截图 / 查验单不参与批量的文件
          "total_files": int,
        }
    """
    pdfs: list[dict] = []
    xmls: list[dict] = []
    ungrouped: list[dict] = []
    ignored: list[dict] = []
    total = 0

    for entry in sorted((Path(p) for p in file_paths if Path(p).is_file()), key=lambda p: str(p)):
        if not entry.is_file():
            continue
        suffix = entry.suffix.lower()
        if suffix == ".pdf":
            total += 1
            att_type = _pdf_attachment_type(entry)
            if att_type != "invoice_pdf":
                ignored.append(_file_info(entry, att_type, warning="这类材料请在条目里添加，或拖到界面后选择绑定条目"))
                continue
            invoice_no, warning = _parse_invoice_no(entry, "invoice_pdf")
            pdfs.append(_file_info(entry, "invoice_pdf", invoice_no, warning))
        elif suffix == ".xml":
            total += 1
            invoice_no, warning = _parse_invoice_no(entry, "invoice_xml")
            xmls.append(_file_info(entry, "invoice_xml", invoice_no, warning))
        elif suffix in _IMAGE_EXT:
            total += 1
            ignored.append(_file_info(entry, "payment_screenshot", warning="付款截图请在条目里添加，或拖到界面后选择绑定条目"))
        else:
            continue

    used_xml: set[int] = set()
    groups: list[dict] = []
    for idx, pdf in enumerate(pdfs, start=1):
        files = [pdf]
        warnings = [pdf["warning"]] if pdf.get("warning") else []
        xml_idx = _match_xml(pdf, xmls, used_xml)
        if xml_idx is not None:
            used_xml.add(xml_idx)
            xml = xmls[xml_idx]
            files.append(xml)
            if xml.get("warning"):
                warnings.append(f"{xml['name']}：{xml['warning']}")
        label = pdf.get("invoice_no") or Path(pdf["path"]).stem
        groups.append({
            "key": f"pdf-{idx}",
            "label": label,
            "invoice_no": pdf.get("invoice_no") or "",
            "selected": True,
            "files": files,
            "warnings": warnings,
        })

    for idx, xml in enumerate(xmls):
        if idx not in used_xml:
            if not pdfs:
                ungrouped.append({**xml, "warning": xml.get("warning") or "没有发票 PDF，不能单独批量导入"})
            else:
                ungrouped.append({**xml, "warning": xml.get("warning") or "未匹配到对应发票 PDF"})

    return {
        "groups": groups,
        "ungrouped": ungrouped,
        "ignored": ignored,
        "total_files": total,
        "invoice_pdf_count": len(pdfs),
        "matched_xml_count": len(used_xml),
    }


def scan_folder(folder: str | Path) -> dict:
    """扫描目录，返回发票 PDF 导入预览。"""
    folder = Path(folder)
    if not folder.is_dir():
        raise NotADirectoryError(f"不是有效目录：{folder}")
    return _scan_file_paths([p for p in folder.rglob("*") if p.is_file()])


def scan_files(paths: list[str | Path]) -> dict:
    """扫描用户多选或拖入的发票文件，返回批量导入预览。"""
    file_paths = [Path(p) for p in (paths or [])]
    if not file_paths:
        raise ValueError("没有选择文件")
    return _scan_file_paths(file_paths)


_TYPE_LABEL = {
    "invoice_pdf": "发票 PDF",
    "invoice_xml": "发票 XML",
    "payment_screenshot": "付款截图",
    "inspection_pdf": "查验单 PDF",
    "other": "未导入",
}
