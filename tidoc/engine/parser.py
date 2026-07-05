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
from .money import d, money


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


# 数电普通发票里购买方/销售方信息块通常以「名称:」开头，紧随其后是抬头与税号；
# 一张发票有两个这样的块：第一个是销售方，第二个是购买方（顺序随版面可变）。
# 这里用「名称:」标签 + 税号正则做到版面无关的稳定抽取。
_TAX_ID_RE = re.compile(r"[0-9A-Z]{15,20}")


def _normalize_party_lines(lines: list[str]) -> list[str]:
    """把竖排单字（销/售/方/信/息/购/买/备/注，每个单字独占一行）合并成一行的预处理。

    pypdf / Aspose 提取的发票 PDF 常把竖排标题拆成 N 个单字行，干扰后续识别。
    """
    out: list[str] = []
    buf = ""
    for line in lines:
        if len(line) == 1 and "\u4e00" <= line <= "\u9fff":
            buf += line
            continue
        if buf:
            out.append(buf); buf = ""
        out.append(line)
    if buf:
        out.append(buf)
    return out


def _extract_parties(lines: list[str]) -> tuple[str, str, str, str]:
    """从文本行里抽销售方与购买方：名称 + 税号。

    兼容三种版面：
    1) ``名称:抬头名税号`` 同行连写 —— 本行抓到抬头名 + 末尾税号。
    2) ``名称:抬头名`` 同行连写，税号隔几行在「统一社会信用代码: XXX」行末尾。
    3) ``名称:`` 单独成行、抬头名与税号都在下方几行 —— 数电普通发票的纵向标题块。
       此时连续两个 ``名称:`` 标签下方对应两个抬头/税号依次排列，例如：
           名称:
           名称:
           购买方抬头          （← 给「名称:」#0）
           销售方抬头          （← 给「名称:」#1）
           统一社会信用代码: 购买方税号
           统一社会信用代码: 销售方税号
    """
    parties: list[tuple[str, str]] = []  # (name, tax_id)
    n = len(lines)
    pending = 0          # 仍在等待抬头配对的「名称:」数量
    name_pending: list[int] = []  # 已收到的「名称:」标签在 parties 中的 slot 索引
    for idx, line in enumerate(lines):
        m = re.match(r"名称[:：]\s*(.*)", line)
        if m:
            tail_text = m.group(1).strip()
            if not tail_text:
                pending += 1
                continue
            tail_tax = _TAX_ID_RE.search(tail_text)
            if tail_tax:
                parties.append((tail_text[:tail_tax.start()].strip(), tail_tax.group(0)))
                continue
            parties.append((tail_text, ""))
            continue
        if pending > 0:
            # 抬头名候选：跳过空行、税号行（"统一社会信用..."）、竖排单字残留
            if ("识别号" in line) or ("代码" in line) or "购" in line or "销" in line:
                pass
            elif line:
                m2 = _TAX_ID_RE.search(line)
                if m2:
                    parties_name = (line[:m2.start()].strip(), m2.group(0))
                    pii = len(parties); parties.append(parties_name)
                else:
                    parties.append((line, ""))
                pending -= 1
                continue

    # 第二轮：上面收集到的条目可能税号还没补上，按出现顺序在文本后续「统一社会信用代码: 税号」补足
    tax_lines = [_TAX_ID_RE.search(l).group(0) for l in lines
                 if ("识别号" in l or "代码" in l) and _TAX_ID_RE.search(l)]
    for i, (nm, tid) in enumerate(parties):
        if not tid and i < len(tax_lines):
            parties[i] = (nm, tax_lines[i])

    seller_name = seller_tax_id = buyer_name = buyer_tax_id = ""
    if len(parties) >= 2:
        # 数电普通发票的两个抬头通常是「销售方」+「购买方」。版面排版有时销售方在前、
        # 有时购买方在前；用 SUPPORTED_TITLES 直接识别本校抬头作为购买方，更稳。
        first, second = parties[0], parties[1]
        from .validator import SUPPORTED_TITLES
        if any(t and t in first[0] for t in SUPPORTED_TITLES):
            buyer_name, buyer_tax_id = first
            seller_name, seller_tax_id = second
        elif any(t and t in second[0] for t in SUPPORTED_TITLES):
            buyer_name, buyer_tax_id = second
            seller_name, seller_tax_id = first
        else:
            # 都不是已知购买方抬头——按出现顺序保留原默认（销售在前）
            seller_name, seller_tax_id = first
            buyer_name, buyer_tax_id = second
    elif len(parties) == 1:
        from .validator import SUPPORTED_TITLES
        only_name, only_tax = parties[0]
        if any(t and t in only_name for t in SUPPORTED_TITLES):
            buyer_name, buyer_tax_id = only_name, only_tax
        else:
            seller_name, seller_tax_id = only_name, only_tax
    return seller_name, seller_tax_id, buyer_name, buyer_tax_id


def _extract_pdf_buyer(lines: list[str]) -> tuple[str, str]:
    # 旧路径兼容：只返回购买方
    _, _, buyer_name, buyer_tax_id = _extract_parties(lines)
    if buyer_name:
        return buyer_name, buyer_tax_id
    # 兜底：用日期行的下一两行
    tax_id_pattern = _TAX_ID_RE
    for idx, line in enumerate(lines):
        if re.fullmatch(r"\d{4}年\d{2}月\d{2}日", line) and idx + 2 < len(lines):
            maybe_name = lines[idx + 1].strip()
            maybe_tax_id = lines[idx + 2].strip()
            if maybe_name and tax_id_pattern.fullmatch(maybe_tax_id):
                return maybe_name, maybe_tax_id
    return "", ""


def _extract_pdf_seller(lines: list[str], buyer_tax_id: str, buyer_name: str) -> str:
    seller_name, *_ = _extract_parties(lines)
    if seller_name:
        return seller_name
    # 旧路径兜底
    if not buyer_name or not buyer_tax_id:
        return ""
    for idx, line in enumerate(lines):
        if buyer_name in line and not line.startswith("*"):
            seller_name = line.replace(buyer_name, "", 1).strip()
            tax_line = lines[idx + 1].strip() if idx + 1 < len(lines) else ""
            if tax_line.endswith(buyer_tax_id):
                return seller_name
    for idx, line in enumerate(lines):
        if buyer_tax_id and line == buyer_tax_id and idx + 1 < len(lines):
            return lines[idx + 1]
    return ""


def _parse_amount_tax_line(line: str) -> tuple[str, Decimal | None, Decimal, Decimal, int] | None:
    """从一行里抽出 (单位, 数量, 金额(不含税), 税额, 名称末尾位置)。

    数电普通发票明细行的常见版式（按列从左到右）：
        *分类*名称  规格型号  单位  数量  单价  金额  税率%  税额
    名称、规格都可能是多段；下面用「税率% 税额」锚定行末，
    再向前倒推各列，对版面不齐的兼容性更好。
    """
    # 1) 完整版式：行首带星号分类，到行末固定 7 列尾巴
    m = re.search(
        r"(\*.+?)\s+(\S+)\s+(\S+)\s+(-?\d+(?:\.\d+)?)\s+"
        r"(-?\d+(?:\.\d+)?)\s+(-?\d+\.\d{2})\s+"
        r"(-?\d+(?:\.\d+)?)%\s+(-?\d+\.\d{2})\s*$",
        line,
    )
    if m:
        raw_name = m.group(1)
        unit = m.group(3)
        quantity = d(m.group(4)) if m.group(4) else None
        amount_wo_tax = d(m.group(6))
        tax_amount = d(m.group(8))
        return unit, quantity, amount_wo_tax, tax_amount, m.start(1) + len(raw_name)

    # 2) 折行版式：行首带星号分类，尾部只带「金额 税率% 税额」3 段（同名折行修正）
    m = re.search(
        r"(\*.+?)\s+(?:\S+\s+)*?(-?\d+\.\d{2})\s+"
        r"(-?\d+(?:\.\d+)?)%\s+(-?\d+\.\d{2})\s*$",
        line,
    )
    if m:
        raw_name = m.group(1)
        return "", None, d(m.group(2)), d(m.group(4)), m.start(1) + len(raw_name)

    return None


def _normalize_name(parts: list[str]) -> str:
    return re.sub(r"\s+", "", "".join(parts)).strip()


def _parse_pdf_items(lines: list[str]) -> list[ParsedItem]:
    """从 PDF 文本行里抽物品明细。

    每条明细一行首部带 ``*分类*名称``，遇到统计行（合计 / 价税合计 / 收款人...）终止。
    """
    _SKIP = ("合", "价税合计", "购买时间", "收款人", "复核人", "开票人", "备注",
             "名称:", "统一社会信用", "电子发票")

    items: list[ParsedItem] = []
    last: ParsedItem | None = None

    def make_item(name: str, unit: str, quantity, amount, tax):
        item = ParsedItem(
            name=name,
            actual_name=clean_item_name(name),
            unit=unit,
            quantity=quantity if quantity is not None else Decimal("1"),
            total=money(amount + tax),
        )
        return item

    for line in lines:
        if any(k in line for k in _SKIP):
            continue
        if not line.startswith("*"):
            continue
        parsed = _parse_amount_tax_line(line)
        if not parsed:
            # 单独一行作为名称的延续 / 名称跨行——直接忽略，等下一行带数字的版式中合并
            continue
        unit, quantity, amount, tax, name_end = parsed
        # raw_name 从行首到「名称末尾位置」（正则1 给出）截取
        raw_name = line[:name_end].strip()
        if not raw_name and last:
            # 名称没拿到版面给空——把这个修正并入上一条
            last.total = money(last.total + amount + tax)
            continue
        if not unit and last and clean_item_name(raw_name) == last.actual_name:
            last.total = money(last.total + amount + tax)
            continue
        item = make_item(raw_name, unit, quantity, amount, tax)
        items.append(item)
        last = item

    return items


def parse_pdf(path: str | Path) -> ParsedInvoice:
    path = Path(path)
    text = _pdf_text(path)
    return _parse_invoice_text(text, source="pdf")


def _parse_invoice_text(text: str, source: str = "pdf") -> ParsedInvoice:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    lines = _normalize_party_lines(lines)

    invoice_no_match = re.search(r"发票号码[:：]?\s*(\d{20})", text)
    if invoice_no_match:
        invoice_no = invoice_no_match.group(1)
    else:
        long_numbers = re.findall(r"\b\d{20}\b", text)
        invoice_no = long_numbers[0] if long_numbers else ""

    date_match = re.search(r"(\d{4})\s*年\s*(\d{2})\s*月\s*(\d{2})\s*日", text)
    invoice_date = f"{date_match.group(1)}-{date_match.group(2)}-{date_match.group(3)}" if date_match else ""

    seller_name, seller_tax_id, buyer_name, buyer_tax_id = _extract_parties(lines)
    if not seller_name:
        # 兜底走旧的「日期行下两行就是购买方」启发式
        buyer_name, buyer_tax_id = _extract_pdf_buyer(lines)
        seller_name = _extract_pdf_seller(lines, buyer_tax_id, buyer_name)

    amounts = [d(x) for x in re.findall(r"¥\s*([0-9]+(?:\.[0-9]{2})?)", text)]
    total = max(amounts) if amounts else Decimal("0")

    invoice = ParsedInvoice(
        invoice_no=invoice_no,
        invoice_date=invoice_date,
        seller=seller_name,
        buyer_name=buyer_name,
        buyer_tax_id=buyer_tax_id,
        total=total,
        source=source,
    )
    invoice.items.extend(_parse_pdf_items(lines))
    return invoice


# --------------------------------------------------------------------------- 合并入口

def _is_electronic_invoice_xml(root: ET.Element) -> bool:
    """电子发票 XML 的根节点带 EIid / SellerName / BuyerName 等字段。"""
    for tag in ("EIid", "SellerName", "BuyerName"):
        if root.find(f".//{tag}") is not None:
            return True
    return False


def _aspose_text(path: Path) -> str:
    """把 Aspose PDF→XML 的版面 Glyphs 按行重建为 PDF 文本流形态。

    每个 Glyphs 的 RenderTransform 形如 ``a b c d x y``（x/y 为屏幕坐标系，页顶为 0，
    向下为正）。处理步骤：
    1. 按四舍五入整数 y 聚类成行（兼容 y 微小抖动）。
    2. 若一行内相邻 Glyphs 的 x 间距过大（> 200），视为双列布局（销售方/购买方
       信息块常见）——按该空隙拆成两行：左列紧接右列。
    """
    root = ET.parse(path).getroot()
    rows: dict[int, list[tuple[float, str]]] = {}
    for g in root.iter("Glyphs"):
        tx = g.find("Text")
        if tx is None or not tx.text:
            continue
        rt = (g.get("RenderTransform") or "").split()
        x, y = 0.0, 0.0
        if len(rt) >= 6:
            try:
                x, y = float(rt[4]), float(rt[5])
            except ValueError:
                pass
        else:
            origin = g.find("Origin")
            if origin is not None:
                x = float(origin.get("X") or 0)
        rows.setdefault(int(round(y)), []).append((x, tx.text))

    lines: list[str] = []
    for y in sorted(rows.keys()):
        sorted_row = sorted(rows[y], key=lambda p: p[0])
        # 双列检测：在排序后的 Glyphs 中找相邻 gap > 200 的位置，拆成左右两段
        groups: list[list[tuple[float, str]]] = [[sorted_row[0]]]
        for prev, cur in zip(sorted_row, sorted_row[1:]):
            if cur[0] - prev[0] > 200:
                groups.append([cur])
            else:
                groups[-1].append(cur)
        if len(groups) == 1:
            lines.append(" ".join(p[1] for p in groups[0]))
        else:
            lines.append(" ".join(p[1] for p in groups[0]))
            lines.append(" ".join(p[1] for p in groups[1]))
    return "\n".join(lines)


def parse_aspose_xml(path: str | Path) -> ParsedInvoice:
    """解析 Aspose PDF-转-XML 的版面 XML（Glyphs/Text 流）。

    把 Glyphs 按 PDF 坐标重排成行，再走与 PDF 相同的 `_parse_invoice_text` 启发式，
    用来兜底那些 pypdf 抽取破碎、但 Aspose 能拿到完整版面文字的发票。
    """
    path = Path(path)
    return _parse_invoice_text(_aspose_text(path), source="aspose-xml")


def parse_invoice_files(xml_path: str | Path | None = None, pdf_path: str | Path | None = None) -> ParsedInvoice:
    """给定 XML / PDF 路径（可只给其一），返回最优解析结果。

    两类 XML：
    - 电子发票 XML（根节点含 EIid/SellerName/...）走 parse_xml，结构化可靠。
    - Aspose 从 PDF 转出来的版面 XML（Glyphs/Text 流）走 parse_aspose_xml，是 PDF 文本流的替代。
    自动识别：检测根节点的标签名决定走哪条。
    """
    if xml_path:
        root = ET.parse(xml_path).getroot()
        if _is_electronic_invoice_xml(root):
            invoice = parse_xml(xml_path)
            if pdf_path:
                invoice.source = "xml+pdf"
            return invoice
        # 否则当作 Aspose 版面 XML
        invoice = parse_aspose_xml(xml_path)
        if pdf_path:
            invoice.source = "aspose-xml+pdf"
        return invoice
    if pdf_path:
        return parse_pdf(pdf_path)
    raise ValueError("至少需要提供 XML 或 PDF 之一。")
