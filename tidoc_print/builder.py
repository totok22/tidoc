"""打印导出编排（设计文档第 9 节）。

对外主入口 build_print_package：
- 输入一组 PrintEntry（可跨人）+ 选项。
- 按抬头强隔离分组，每个抬头单独出一套文件，绝不混合（第 7 节）。
- 默认按条目连续生成材料拼接 PDF；也可按材料类型分别生成旧式拼接 PDF。
- 拼接页只叠加份数 / 页码编号。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory

from .models import PersonProfile, PrintEntry
from .pdf_merge import images_to_pdf, merge_pdf_groups, merge_pdfs
from .word_docs import generate_acceptance_doc, generate_reimburse_doc

# 旧配置保留兼容；当前打印件只使用固定编号，不再展示发票号/姓名/金额。
ANNOTATION_FIELDS = ("invoice_no", "invoice_date", "seller", "person_name", "paid_amount", "total")
_ANNOTATION_LABEL = {
    "invoice_no": "发票号", "invoice_date": "日期", "seller": "销售方",
    "person_name": "报账人", "paid_amount": "实付", "total": "价税合计",
}


@dataclass
class PrintOptions:
    document_date: str = ""                       # 默认取今天
    storage_location: str = "工训楼"
    annotate: bool = True                         # 拼接页是否叠加信息
    annotation_fields: tuple[str, ...] = ("invoice_no", "person_name", "paid_amount")
    batch_note: str = ""
    make_entry_bundle_pdf: bool = True
    make_invoice_pdf: bool = False
    make_payment_pdf: bool = False
    make_inspection_pdf: bool = False
    make_reimburse_doc: bool = True
    make_acceptance_doc: bool = True

    def __post_init__(self):
        if not self.document_date:
            now = datetime.now()
            self.document_date = f"{now.year}年{now.month}月{now.day}日"


@dataclass
class PrintResult:
    title: str
    files: dict[str, str] = field(default_factory=dict)   # 文件类型 -> 路径


def _annotation_for(entry: PrintEntry, fields: tuple[str, ...]) -> str:
    """按勾选字段拼出一条页脚标注文字。"""
    parts = []
    for f in fields:
        if f == "person_name":
            val = entry.profile_name
        elif f == "total":
            val = f"¥{entry.total}"
        else:
            val = getattr(entry, f, "")
        if val:
            parts.append(f"{_ANNOTATION_LABEL.get(f, f)}：{val}")
    return "   ".join(parts)


def _safe_name(text: str) -> str:
    import re
    cleaned = re.sub(r'[\\/:*?"<>|]+', "_", text).strip()
    return cleaned or "未命名"


def build_print_package(
    entries: list[PrintEntry],
    out_dir: str | Path,
    options: PrintOptions | None = None,
    profiles: dict[str, PersonProfile] | None = None,
) -> list[PrintResult]:
    """按抬头强隔离，为每个抬头生成一套打印件。返回每个抬头的结果。"""
    options = options or PrintOptions()
    profiles = profiles or {}
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # 按抬头分组——强隔离的核心：两个抬头永不进同一份文件
    by_title: dict[str, list[PrintEntry]] = {}
    for e in entries:
        by_title.setdefault(e.title or "未标注抬头", []).append(e)

    results: list[PrintResult] = []
    for title, group in by_title.items():
        title_dir = out_dir / _safe_name(title)
        title_dir.mkdir(parents=True, exist_ok=True)
        res = PrintResult(title=title)

        # 1. 默认打印件：每个条目的发票、付款截图、查验单连续排列。
        if options.make_entry_bundle_pdf:
            with TemporaryDirectory(prefix="tidoc-entry-materials-") as tmp:
                groups: list[list[str | Path]] = []
                for entry_idx, e in enumerate(group, start=1):
                    parts: list[str | Path] = list(e.invoice_pdfs)
                    if e.payment_images:
                        payment_pdf = Path(tmp) / f"payment-{entry_idx}.pdf"
                        images_to_pdf(
                            e.payment_images,
                            payment_pdf,
                            show_page_footer=False,
                        )
                        parts.append(payment_pdf)
                    parts.extend(e.inspection_pdfs)
                    if parts:
                        groups.append(parts)
                if groups:
                    out = merge_pdf_groups(
                        groups,
                        title_dir / "按条目材料拼接.pdf",
                        numbered=options.annotate,
                        batch_note=options.batch_note,
                    )
                    res.files["entry_bundle_pdf"] = str(out)

        # 2. 兼容导出：按材料类型分别拼接。
        if options.make_invoice_pdf:
            paths, annos = [], []
            for e in group:
                for pdf in e.invoice_pdfs:
                    paths.append(pdf)
                    annos.append(_annotation_for(e, options.annotation_fields) if options.annotate else "")
            if paths:
                out = merge_pdfs(
                    paths,
                    title_dir / "发票拼接.pdf",
                    annos if options.annotate else None,
                    numbered=options.annotate,
                    batch_note=options.batch_note,
                )
                res.files["invoice_pdf"] = str(out)

        # 3. 付款截图拼接 PDF
        if options.make_payment_pdf:
            imgs, annos = [], []
            for entry_idx, e in enumerate(group, start=1):
                total_images = len(e.payment_images)
                for img_idx, img in enumerate(e.payment_images, start=1):
                    imgs.append(img)
                    annos.append(f"No.{entry_idx}-{img_idx}/{total_images}" if options.annotate else "")
            if imgs:
                out = images_to_pdf(
                    imgs,
                    title_dir / "付款截图拼接.pdf",
                    annos if options.annotate else None,
                    batch_note=options.batch_note,
                    show_page_footer=options.annotate,
                )
                res.files["payment_pdf"] = str(out)

        # 4. 查验单拼接 PDF
        if options.make_inspection_pdf:
            paths = [p for e in group for p in e.inspection_pdfs]
            if paths:
                out = merge_pdfs(
                    paths,
                    title_dir / "查验单拼接.pdf",
                    numbered=options.annotate,
                    batch_note=options.batch_note,
                )
                res.files["inspection_pdf"] = str(out)

        # 5. 报账说明 Word（按报账人分别出，因抬头段是个人信息）
        if options.make_reimburse_doc:
            # 同一抬头下可能跨人；报账说明抬头段取该组第一个报账人
            first = group[0]
            profile = profiles.get(first.entry_id) or profiles.get(first.profile_name) or PersonProfile(person_name=first.profile_name)
            out = generate_reimburse_doc(group, title_dir / "报账说明.docx", options.document_date, profile)
            res.files["reimburse_doc"] = str(out)

        # 6. 验收单 Word
        if options.make_acceptance_doc:
            out = generate_acceptance_doc(group, title_dir / "验收单.docx", options.document_date, options.storage_location)
            res.files["acceptance_doc"] = str(out)

        results.append(res)

    return results
