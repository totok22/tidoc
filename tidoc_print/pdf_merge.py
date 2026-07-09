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


def _draw_label(c, text: str, anchor_x: float, baseline_y: float,
                font_size: float = 11, align: str = "right") -> None:
    """在锚点处画标注：先铺白色不透明底框盖住底层内容，再写字。
    align="right" 时 anchor_x 为右边界；align="center" 时 anchor_x 为水平中心。"""
    font = _CJK_FONT if _FONT_OK else "Helvetica"
    text_w = pdfmetrics.stringWidth(text, font, font_size)
    pad_x, pad_y = 2.2 * mm, 1.4 * mm
    box_x = anchor_x - text_w / 2 - pad_x if align == "center" else anchor_x - text_w - pad_x
    box_y = baseline_y - pad_y
    box_w = text_w + 2 * pad_x
    box_h = font_size + 2 * pad_y
    # 白底框：遮住底层单据原有内容，避免叠字重影
    c.setFillColorRGB(1, 1, 1)
    c.rect(box_x, box_y, box_w, box_h, stroke=0, fill=1)
    c.setFont(font, font_size)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    if align == "center":
        c.drawCentredString(anchor_x, baseline_y, text)
    else:
        c.drawRightString(anchor_x, baseline_y, text)


def _annotation_overlay(text: str, pagesize=A4) -> PdfReader:
    """生成一张只含标注文字的叠加页：右下角带白底框。"""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=pagesize)
    width, _ = pagesize
    _draw_label(c, text, width - 10 * mm, 7 * mm)
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
            label = _footer_text(batch_note, f"No.{idx + 1}-{page_idx}/{total_pages}") if numbered else note
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
                _draw_label(c, note, slot_x + slot_w / 2, margin + 3 * mm,
                            font_size=10, align="center")
        _draw_label(c, _footer_text(batch_note, f"第{page_index}页"),
                    page_w - margin, 6 * mm, font_size=10)
        c.save()
        buf.seek(0)
        for page in PdfReader(buf).pages:
            writer.add_page(page)
    out_path = Path(out_path)
    with out_path.open("wb") as f:
        writer.write(f)
    return out_path
