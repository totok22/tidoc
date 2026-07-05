"""PDF 拼接与付款截图转 PDF（设计文档第 9 节）。

- merge_pdfs：把多个 PDF（发票 / 查验单）拼成一份。
- images_to_pdf：把付款截图（jpg/png）逐张转成 PDF 页并拼接，可在每页叠加信息。
- 页面信息标注：在每页页脚叠加发票信息、姓名、实付金额、发票号等（字段可勾选）。
"""

from __future__ import annotations

import io
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from PIL import Image
from reportlab.lib.pagesizes import A4
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


def _annotation_overlay(text: str, pagesize=A4) -> PdfReader:
    """生成一张只含页脚标注文字的透明 PDF 页，供叠加。"""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=pagesize)
    width, _ = pagesize
    c.setFont(_CJK_FONT if _FONT_OK else "Helvetica", 9)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    # 页脚左下角，留 12mm 边距
    c.drawString(12 * mm, 8 * mm, text)
    c.save()
    buf.seek(0)
    return PdfReader(buf)


def merge_pdfs(pdf_paths: list[str | Path], out_path: str | Path,
               annotations: list[str] | None = None) -> Path:
    """把多个 PDF 拼成一份。annotations 若给出，逐文件在其每页页脚叠加对应文字。"""
    writer = PdfWriter()
    for idx, pdf_path in enumerate(pdf_paths):
        reader = PdfReader(str(pdf_path))
        note = annotations[idx] if annotations and idx < len(annotations) else ""
        for page in reader.pages:
            # 先把页加进 writer，再对 writer 内的页做叠加（pypdf 推荐做法，避免不可靠）
            added = writer.add_page(page)
            if note:
                box = added.mediabox
                overlay = _annotation_overlay(note, (float(box.width), float(box.height)))
                added.merge_page(overlay.pages[0])
    out_path = Path(out_path)
    with out_path.open("wb") as f:
        writer.write(f)
    return out_path


def images_to_pdf(image_paths: list[str | Path], out_path: str | Path,
                  annotations: list[str] | None = None) -> Path:
    """把付款截图逐张放到 A4 页并拼成 PDF，每页可在页脚叠加信息。"""
    writer = PdfWriter()
    page_w, page_h = A4
    for idx, img_path in enumerate(image_paths):
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=A4)
        with Image.open(img_path) as im:
            im = im.convert("RGB")
            iw, ih = im.size
            # 等比缩放，留边距
            margin = 15 * mm
            max_w, max_h = page_w - 2 * margin, page_h - 2 * margin - 10 * mm
            scale = min(max_w / iw, max_h / ih)
            draw_w, draw_h = iw * scale, ih * scale
            x = (page_w - draw_w) / 2
            y = (page_h - draw_h) / 2 + 5 * mm
            tmp = io.BytesIO()
            im.save(tmp, format="PNG")
            tmp.seek(0)
            from reportlab.lib.utils import ImageReader
            c.drawImage(ImageReader(tmp), x, y, width=draw_w, height=draw_h)
        note = annotations[idx] if annotations and idx < len(annotations) else ""
        if note:
            c.setFont(_CJK_FONT if _FONT_OK else "Helvetica", 9)
            c.drawString(12 * mm, 8 * mm, note)
        c.save()
        buf.seek(0)
        for page in PdfReader(buf).pages:
            writer.add_page(page)
    out_path = Path(out_path)
    with out_path.open("wb") as f:
        writer.write(f)
    return out_path
