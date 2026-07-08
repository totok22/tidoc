"""文件夹批量导入：扫描一个目录，把一批发票 PDF 快速拆成待创建条目。

设计取向：
- 批量只从发票 PDF 创建条目，可附带匹配到的 XML。
- 用户不需要提前重命名。XML 优先按发票号配对，其次按近似文件名配对。
- PDF 是必需材料；孤立 XML、付款截图、查验单只在预览里提示，不单独创建条目。
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from ..engine.parser import parse_invoice_files

_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
_PAYMENT_KEYWORDS = ("付款", "支付", "截图")
_INSPECTION_KEYWORDS = ("查验单", "查验", "验真", "查验平台", "查验次数", "查验时间")
_STEM_JUNK_RE = re.compile(r"[\s_\-+＋（）()\[\]【】{}.,，。]+")
_INVOICE_NO_RE = re.compile(r"\d{8,30}")
_LABELED_INVOICE_NO_RE = re.compile(r"发票号码[:：]?\s*(\d{20})")


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


def _is_informative_stem(stem: str) -> bool:
    """Only use fuzzy filename matching when the stem carries real identity.

    Short numeric names like "26.pdf" often come from browser downloads or
    screenshots and can accidentally match dates/invoice numbers in XML names.
    """
    if not stem:
        return False
    if stem.isdigit():
        return len(stem) >= 12
    return len(stem) >= 5


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
    probe = _pdf_probe_text(path)
    if any(k in probe for k in _INSPECTION_KEYWORDS) or "inv-veri.chinatax" in probe.lower():
        return "inspection_pdf"
    return "invoice_pdf"


def classify_pdf_attachment_type(path: str | Path) -> str:
    return _pdf_attachment_type(Path(path))


def extract_pdf_invoice_no(path: str | Path) -> str:
    path = Path(path)
    probe = _pdf_probe_text(Path(path))
    labeled = _LABELED_INVOICE_NO_RE.search(probe)
    if labeled:
        return labeled.group(1)
    for no in re.findall(r"\d{20}", probe):
        return no
    return _macos_ocr_tax_verification_invoice_no(path) or _windows_ocr_tax_verification_invoice_no(path)


def _macos_ocr_tax_verification_invoice_no(path: Path) -> str:
    if sys.platform != "darwin":
        return ""
    try:
        import objc
        from Foundation import NSURL
        from Quartz import (
            CGBitmapContextCreate,
            CGBitmapContextCreateImage,
            CGColorSpaceCreateDeviceRGB,
            CGContextDrawPDFPage,
            CGContextFillRect,
            CGContextScaleCTM,
            CGContextSetRGBFillColor,
            CGContextTranslateCTM,
            CGPDFDocumentCreateWithURL,
            CGPDFDocumentGetPage,
            CGPDFPageGetBoxRect,
            CGRectMake,
            kCGImageAlphaPremultipliedLast,
            kCGPDFMediaBox,
        )

        objc.loadBundle("Vision", globals(), bundle_path="/System/Library/Frameworks/Vision.framework")
        doc = CGPDFDocumentCreateWithURL(NSURL.fileURLWithPath_(str(path)))
        if not doc:
            return ""
        page = CGPDFDocumentGetPage(doc, 1)
        if not page:
            return ""
        rect = CGPDFPageGetBoxRect(page, kCGPDFMediaBox)
        candidates = [
            (rect.size.width * 0.08, rect.size.height * 0.17, rect.size.width * 0.34, rect.size.height * 0.12),
            (rect.size.width * 0.05, rect.size.height * 0.13, rect.size.width * 0.44, rect.size.height * 0.16),
        ]
        for crop_x, crop_top, crop_w, crop_h in candidates:
            text = _macos_ocr_pdf_crop(
                page, rect, crop_x, crop_top, crop_w, crop_h,
                scale=8.0,
                CGBitmapContextCreate=CGBitmapContextCreate,
                CGBitmapContextCreateImage=CGBitmapContextCreateImage,
                CGColorSpaceCreateDeviceRGB=CGColorSpaceCreateDeviceRGB,
                CGContextDrawPDFPage=CGContextDrawPDFPage,
                CGContextFillRect=CGContextFillRect,
                CGContextScaleCTM=CGContextScaleCTM,
                CGContextSetRGBFillColor=CGContextSetRGBFillColor,
                CGContextTranslateCTM=CGContextTranslateCTM,
                CGRectMake=CGRectMake,
                kCGImageAlphaPremultipliedLast=kCGImageAlphaPremultipliedLast,
            )
            match = re.search(r"\d{20}", text)
            if match:
                return match.group(0)
    except Exception:
        return ""
    return ""


def _windows_ocr_tax_verification_invoice_no(path: Path) -> str:
    if not sys.platform.startswith("win"):
        return ""
    script = r"""
param([string]$Path)
[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfPageRenderOptions, Windows.Data.Pdf, ContentType = WindowsRuntime]
function Await-Operation($Operation, [Type]$ResultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
    } | Select-Object -First 1
    $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
}
function Await-Action($Action) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and -not $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1
    } | Select-Object -First 1
    $task = $method.Invoke($null, @($Action))
    $task.Wait()
}
$file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$pdf = Await-Operation ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
$page = $pdf.GetPage(0)
$size = $page.Size
$opts = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
$opts.SourceRect = [Windows.Foundation.Rect]::new($size.Width * 0.08, $size.Height * 0.17, $size.Width * 0.34, $size.Height * 0.12)
$opts.DestinationWidth = [uint32]($opts.SourceRect.Width * 8)
$opts.DestinationHeight = [uint32]($opts.SourceRect.Height * 8)
$stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
Await-Action ($page.RenderToStreamAsync($stream, $opts))
$stream.Seek(0) | Out-Null
$decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('zh-Hans'))
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
$result = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$result.Text
"""
    try:
        with tempfile.TemporaryDirectory(prefix="tidoc-ocr-") as tmp:
            tmp_dir = Path(tmp)
            pdf_path = tmp_dir / "input.pdf"
            script_path = tmp_dir / "ocr.ps1"
            shutil.copy2(path, pdf_path)
            script_path.write_text(script, encoding="utf-8")
            proc = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(script_path),
                    "-Path",
                    str(pdf_path),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
                timeout=20,
                check=False,
            )
        match = re.search(r"\d{20}", (proc.stdout or "") + "\n" + (proc.stderr or ""))
        return match.group(0) if match else ""
    except Exception:
        return ""


def _macos_ocr_pdf_crop(page, rect, crop_x, crop_top, crop_w, crop_h, scale: float, **q) -> str:
    width, height = int(crop_w * scale), int(crop_h * scale)
    ctx = q["CGBitmapContextCreate"](
        None,
        width,
        height,
        8,
        width * 4,
        q["CGColorSpaceCreateDeviceRGB"](),
        q["kCGImageAlphaPremultipliedLast"],
    )
    q["CGContextSetRGBFillColor"](ctx, 1, 1, 1, 1)
    q["CGContextFillRect"](ctx, q["CGRectMake"](0, 0, width, height))
    q["CGContextScaleCTM"](ctx, scale, scale)
    q["CGContextTranslateCTM"](ctx, -crop_x, -(rect.size.height - crop_top - crop_h))
    q["CGContextDrawPDFPage"](ctx, page)
    image = q["CGBitmapContextCreateImage"](ctx)

    req = VNRecognizeTextRequest.alloc().init()  # type: ignore[name-defined]
    req.setRecognitionLevel_(1)
    if hasattr(req, "setUsesLanguageCorrection_"):
        req.setUsesLanguageCorrection_(False)
    req.setRecognitionLanguages_(["en-US", "zh-Hans"])
    handler = VNImageRequestHandler.alloc().initWithCGImage_options_(image, None)  # type: ignore[name-defined]
    handler.performRequests_error_([req], None)
    lines: list[str] = []
    for obs in req.results() or []:
        candidates = obs.topCandidates_(1)
        if candidates:
            lines.append(str(candidates[0].string()))
    return "\n".join(lines)


def _pdf_probe_text(path: Path) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(path)
        chunks: list[str] = []
        if reader.metadata:
            for value in reader.metadata.values():
                if isinstance(value, bytes):
                    for enc in ("utf-8", "gb18030"):
                        try:
                            chunks.append(value.decode(enc, errors="ignore"))
                            break
                        except Exception:
                            continue
                elif value:
                    chunks.append(str(value))
        for page in reader.pages[:1]:
            text = page.extract_text() or ""
            if text:
                chunks.append(text[:2000])
        return "\n".join(chunks)
    except Exception:
        return ""


def _match_xml(pdf: dict, xmls: list[dict], used: set[int]) -> int | None:
    pdf_no = pdf.get("invoice_no") or _invoice_no_from_name(Path(pdf["path"]))
    if pdf_no:
        for idx, xml in enumerate(xmls):
            if idx not in used and xml.get("invoice_no") == pdf_no:
                return idx
    pdf_stem = _normalize_stem(Path(pdf["path"]))
    if not _is_informative_stem(pdf_stem):
        return None
    for idx, xml in enumerate(xmls):
        if idx in used:
            continue
        xml_stem = _normalize_stem(Path(xml["path"]))
        if (
            _is_informative_stem(xml_stem)
            and (pdf_stem == xml_stem or pdf_stem in xml_stem or xml_stem in pdf_stem)
        ):
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
