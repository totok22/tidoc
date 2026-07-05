"""发票解析：优先 XML，其次 PDF 文本。移植并精简自 invoice2docx/engine.py。

对外只暴露两个入口：
- parse_xml(path)  解析电子发票 XML
- parse_pdf(path)  解析发票 PDF 文本
以及 parse_invoice_files(...) —— 给一组附件路径，自动选最优来源合并。
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from decimal import Decimal
from pathlib import Path

from pypdf import PdfReader

from .models import ParsedInvoice, ParsedItem
from .money import d


def clean_item_name(name: str) -> str:
    """去掉发票物资名称里的 *分类* 星号段。"""
    return re.sub(r"\*[^*]+\*", "", name).strip()


def _child_text(elem: ET.Element, tag: str) -> str:
    found = elem.find(".//" + tag)
    return found.text.strip() if found is not None and found.text else ""


# --------------------------------------------------------------------------- XML

def parse_xml(path: str | Path) -> ParsedInvoice:
    path = Path(path)
    root = ET.parse(path).getroot()

    invoice = ParsedInvoice(
        invoice_no=_child_text(root, "EIid"),
        invoice_date=_child_text(root, "IssueTime") or _child_text(root, "RequestTime")[:10],
        seller=_child_text(root, "SellerName"),
        buyer_name=_child_text(root, "BuyerName"),
        buyer_tax_id=_child_text(root, "BuyerIdNum"),
        total=d(_child_text(root, "TotalTax-includedAmount")),
        source="xml",
    )

    parents = [elem for elem in root.iter() if elem.find("ItemName") is not None]
    last: ParsedItem | None = None
    for elem in parents:
        raw_name = _child_text(elem, "ItemName")
        spec = _child_text(elem, "SpecMod")
        unit = _child_text(elem, "MeaUnits")
        quantity_text = _child_text(elem, "Quantity")
        line_total = d(_child_text(elem, "Amount")) + d(_child_text(elem, "ComTaxAm"))

        # 跨行拆分的同名条目：金额并入上一条
        if last and not quantity_text and raw_name == last.name:
            last.total += line_total
            continue

        quantity = d(quantity_text) if quantity_text else None
        item = ParsedItem(
            name=raw_name,
            actual_name=clean_item_name(raw_name),
            unit=unit,
            quantity=quantity,
            total=line_total,
            spec=spec,
        )
        invoice.items.append(item)
        last = item

    return invoice


# --------------------------------------------------------------------------- PDF

def _pdf_text(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _extract_pdf_buyer(lines: list[str]) -> tuple[str, str]:
    tax_id_pattern = re.compile(r"[0-9A-Z]{15,20}")
    for idx, line in enumerate(lines):
        if re.fullmatch(r"\d{4}年\d{2}月\d{2}日", line) and idx + 2 < len(lines):
            maybe_name = lines[idx + 1].strip()
            maybe_tax_id = lines[idx + 2].strip()
            if maybe_name and tax_id_pattern.fullmatch(maybe_tax_id):
                return maybe_name, maybe_tax_id
    for idx, line in enumerate(lines):
        if len(line) >= 30 and re.fullmatch(r"[0-9A-Z]+", line):
            buyer_tax_id = line[-18:]
            if tax_id_pattern.fullmatch(buyer_tax_id):
                name_line = lines[idx - 1].strip() if idx > 0 else ""
                for suffix in ["有限公司", "公司"]:
                    if suffix in name_line and not name_line.endswith(suffix):
                        buyer_name = name_line.split(suffix, 1)[1].strip()
                        if buyer_name:
                            return buyer_name, buyer_tax_id
    for idx, line in enumerate(lines):
        if tax_id_pattern.fullmatch(line):
            prev = lines[idx - 1].strip() if idx > 0 else ""
            if prev and "公司" not in prev and not re.fullmatch(r"[一-龥]{2,4}", prev):
                return prev, line
    return "", ""


def _split_combined_party_line(lines: list[str], buyer_name: str, buyer_tax_id: str) -> str:
    if not buyer_name or not buyer_tax_id:
        return ""
    for idx, line in enumerate(lines):
        if buyer_name in line and not line.startswith("*"):
            seller_name = line.replace(buyer_name, "", 1).strip()
            tax_line = lines[idx + 1].strip() if idx + 1 < len(lines) else ""
            if tax_line.endswith(buyer_tax_id):
                return seller_name
    return ""


def _extract_pdf_seller(lines: list[str], buyer_tax_id: str, buyer_name: str) -> str:
    seller = _split_combined_party_line(lines, buyer_name, buyer_tax_id)
    if seller:
        return seller
    for idx, line in enumerate(lines):
        if buyer_tax_id and line == buyer_tax_id and idx + 1 < len(lines):
            return lines[idx + 1]
    return ""


def _parse_amount_tax_line(line: str) -> tuple[str, Decimal | None, Decimal, Decimal, int] | None:
    match = re.search(r"(?:\d+(?:\.\d+)?%)\s*([一-龥A-Za-z]+)\s+(-?\d+\.\d{2})\s+(-?\d+\.\d{2})", line)
    quantity: Decimal | None = None
    if not match:
        match = re.search(
            r"\s([一-龥A-Za-z]+)\s+(-?\d+(?:\.\d+)?)\s+-?\d+(?:\.\d+)?\s+(-?\d+\.\d{2})\s+(-?\d+\.\d{2})\d+(?:\.\d+)?%$",
            line,
        )
        if not match:
            return None
        quantity = d(match.group(2))
        return match.group(1), quantity, d(match.group(3)), d(match.group(4)), match.start()
    return match.group(1), quantity, d(match.group(2)), d(match.group(3)), match.start()


def _normalize_name(parts: list[str]) -> str:
    return re.sub(r"\s+", "", "".join(parts)).strip()


def _parse_pdf_items(lines: list[str]) -> list[ParsedItem]:
    items: list[ParsedItem] = []
    current_name_parts: list[str] = []

    for line in lines:
        if line.startswith("*"):
            current_name_parts = [line]
            parsed = _parse_amount_tax_line(line)
            if parsed:
                unit, quantity, amount_wo_tax, tax_amount, name_end = parsed
                raw_name = _normalize_name([line[:name_end]])
                items.append(ParsedItem(
                    name=raw_name,
                    actual_name=clean_item_name(raw_name),
                    unit=unit,
                    quantity=quantity or Decimal("1"),
                    total=amount_wo_tax + tax_amount,
                ))
                current_name_parts = []
            continue

        if not current_name_parts:
            continue

        parsed = _parse_amount_tax_line(line)
        if parsed:
            unit, quantity, amount_wo_tax, tax_amount, _ = parsed
            raw_name = _normalize_name(current_name_parts)
            items.append(ParsedItem(
                name=raw_name,
                actual_name=clean_item_name(raw_name),
                unit=unit,
                quantity=quantity or Decimal("1"),
                total=amount_wo_tax + tax_amount,
            ))
            current_name_parts = []
        elif not re.search(r"¥|合\s*计|价税合计|订单|购买时间|收款人|复核人|开票人", line):
            current_name_parts.append(line)

    return items


def parse_pdf(path: str | Path) -> ParsedInvoice:
    path = Path(path)
    text = _pdf_text(path)
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    invoice_no_match = re.search(r"发票号码[:：]?\s*(\d{20})", text)
    if invoice_no_match:
        invoice_no = invoice_no_match.group(1)
    else:
        long_numbers = re.findall(r"\b\d{20}\b", text)
        invoice_no = long_numbers[0] if long_numbers else ""

    date_match = re.search(r"(\d{4})\s*年\s*(\d{2})\s*月\s*(\d{2})\s*日", text)
    invoice_date = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}" if date_match else ""

    buyer_name, buyer_tax_id = _extract_pdf_buyer(lines)
    seller = _extract_pdf_seller(lines, buyer_tax_id, buyer_name)

    amounts = [d(x) for x in re.findall(r"¥\s*([0-9]+(?:\.[0-9]{2})?)", text)]
    total = max(amounts) if amounts else Decimal("0")

    invoice = ParsedInvoice(
        invoice_no=invoice_no,
        invoice_date=invoice_date,
        seller=seller,
        buyer_name=buyer_name,
        buyer_tax_id=buyer_tax_id,
        total=total,
        source="pdf",
    )
    invoice.items.extend(_parse_pdf_items(lines))
    return invoice


# --------------------------------------------------------------------------- 合并入口

def parse_invoice_files(xml_path: str | Path | None = None, pdf_path: str | Path | None = None) -> ParsedInvoice:
    """给定 XML / PDF 路径（可只给其一），返回最优解析结果。

    XML 结构化最可靠——优先用它取字段与明细；PDF 仅在缺 XML 时用。
    """
    if xml_path:
        invoice = parse_xml(xml_path)
        if pdf_path:
            invoice.source = "xml+pdf"
        return invoice
    if pdf_path:
        return parse_pdf(pdf_path)
    raise ValueError("至少需要提供 XML 或 PDF 之一。")
