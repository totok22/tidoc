"""PDF 拼接与付款截图转 PDF（设计文档第 9 节）。

- merge_pdfs：把多个 PDF（发票 / 查验单）拼成一份。
- images_to_pdf：把付款截图（jpg/png）按横版 A4、每页两张拼接。
- 页面信息标注：只保留份数 / 页码编号，减少遮挡。
"""

from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from PIL import Image
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

# 注册一个内置 CJK 字体，保证中文标注不乱码（无需外部字体文件）
_CJK_FONT = "STSong-Light"
try:
    pdfmetrics.registerFont(UnicodeCIDFont(_CJK_FONT))
    _FONT_OK = True
except Exception:
    _FONT_OK = False


def _footer_text(batch_note: str, text: str) -> str:
    batch_note = (batch_note or "").strip()
    return f"{batch_note}  {text}" if batch_note else text


def _annotation_overlay(text: str, pagesize=A4) -> PdfReader:
    """生成一张只含页脚标注文字的透明 PDF 页，供叠加。"""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=pagesize)
    width, _ = pagesize
    c.setFont(_CJK_FONT if _FONT_OK else "Helvetica", 8)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.drawRightString(width - 10 * mm, 7 * mm, text)
    c.save()
    buf.seek(0)
    return PdfReader(buf)


def merge_pdfs(pdf_paths: list[str | Path], out_path: str | Path,
               annotations: list[str] | None = None,
               numbered: bool = False,
               batch_note: str = "") -> Path:
    """把多个 PDF 拼成一份。numbered=True 时每页右下角标「第 N 份-P/T」。"""
    writer = PdfWriter()
    for idx, pdf_path in enumerate(pdf_paths):
        reader = PdfReader(str(pdf_path))
        note = annotations[idx] if annotations and idx < len(annotations) else ""
        total_pages = len(reader.pages)
        for page_idx, page in enumerate(reader.pages, start=1):
            # 先把页加进 writer，再对 writer 内的页做叠加（pypdf 推荐做法，避免不可靠）
            added = writer.add_page(page)
            label = _footer_text(batch_note, f"第{idx + 1}份-{page_idx}/{total_pages}") if numbered else note
            if label:
                box = added.mediabox
                overlay = _annotation_overlay(label, (float(box.width), float(box.height)))
                added.merge_page(overlay.pages[0])
    out_path = Path(out_path)
    with out_path.open("wb") as f:
        writer.write(f)
    return out_path


def images_to_pdf(image_paths: list[str | Path], out_path: str | Path,
                  annotations: list[str] | None = None,
                  batch_note: str = "") -> Path:
    """把付款截图按横版 A4、每页两张拼成 PDF。"""
    writer = PdfWriter()
    page_w, page_h = landscape(A4)
    margin = 10 * mm
    gap = 8 * mm
    footer_h = 10 * mm
    slot_w = (page_w - 2 * margin - gap) / 2
    slot_h = page_h - 2 * margin - footer_h
    from reportlab.lib.utils import ImageReader

    for page_index, start in enumerate(range(0, len(image_paths), 2), start=1):
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(page_w, page_h))
        for offset, img_path in enumerate(image_paths[start:start + 2]):
            idx = start + offset
            with Image.open(img_path) as im:
                im = im.convert("RGB")
                iw, ih = im.size
                scale = min(slot_w / iw, slot_h / ih)
                draw_w, draw_h = iw * scale, ih * scale
                slot_x = margin + offset * (slot_w + gap)
                x = slot_x + (slot_w - draw_w) / 2
                y = margin + footer_h + (slot_h - draw_h) / 2
                tmp = io.BytesIO()
                im.save(tmp, format="PNG")
                tmp.seek(0)
                c.drawImage(ImageReader(tmp), x, y, width=draw_w, height=draw_h)
            note = annotations[idx] if annotations and idx < len(annotations) else ""
            if note:
                c.setFont(_CJK_FONT if _FONT_OK else "Helvetica", 8)
                c.setFillColorRGB(0.1, 0.1, 0.1)
                c.drawRightString(slot_x + slot_w, margin + 3 * mm, note)
        c.setFont(_CJK_FONT if _FONT_OK else "Helvetica", 8)
        c.setFillColorRGB(0.1, 0.1, 0.1)
        c.drawRightString(page_w - margin, 6 * mm, _footer_text(batch_note, f"第{page_index}页"))
        c.save()
        buf.seek(0)
        for page in PdfReader(buf).pages:
            writer.add_page(page)
    out_path = Path(out_path)
    with out_path.open("wb") as f:
        writer.write(f)
    return out_path
