"""发票校验：金额闭合 + 抬头一致性。移植自 invoice2docx/engine.py 的 validate_invoices。

设计文档第 7 节：两个抬头强隔离。这里的抬头一致性校验用于提示"这张发票的抬头
和它所属分区不符"。
"""

from __future__ import annotations

from decimal import Decimal

from .models import CHECK_BLOCKED, CHECK_PASS, CHECK_WARNING, CheckResult, ParsedInvoice
from .money import fmt_money, money

# 设计文档第 7 节：两个受支持的抬头
TITLE_UNIVERSITY = "北京理工大学"
TITLE_FOUNDATION = "北京理工大学教育基金会"
SUPPORTED_TITLES = (TITLE_UNIVERSITY, TITLE_FOUNDATION)


def check_invoice(invoice: ParsedInvoice, expected_title: str = "") -> CheckResult:
    """对单张发票做金额闭合与抬头校验，返回 pass / warning / blocked。

    - blocked：抬头与所属分区不一致（会造成串账）。
    - warning：明细识别合计与发票总额不一致、缺明细、抬头无法识别等；
      这些通常是识别完整性问题，不阻断材料齐备。
    - pass：全部通过。
    """
    problems_blocked: list[str] = []
    problems_warning: list[str] = []

    # 明细金额仅用于提示识别完整性。发票总额取自票面关键信息，明细漏识别
    # 不应阻断后续材料整理、导出和打印。
    if invoice.items:
        item_sum = sum((item.total for item in invoice.items), Decimal("0"))
        diff = money(invoice.total - item_sum)
        if diff != Decimal("0.00"):
            problems_warning.append(
                f"明细识别合计与发票总额相差 {fmt_money(diff)}，"
                "可能是明细识别不完整，请以发票总额为准。"
            )
    else:
        problems_warning.append("未能自动识别物品明细，请确认或补充。")

    # 抬头识别
    if not invoice.buyer_name:
        problems_warning.append("未能识别购买方抬头。")
    elif invoice.buyer_name not in SUPPORTED_TITLES:
        problems_warning.append(
            f"购买方抬头「{invoice.buyer_name}」不在受支持的两个抬头内。"
        )

    # 抬头与所属分区一致性（强隔离）
    if expected_title and invoice.buyer_name and invoice.buyer_name != expected_title:
        problems_blocked.append(
            f"发票抬头为「{invoice.buyer_name}」，与当前分区「{expected_title}」不一致，禁止混入。"
        )

    if problems_blocked:
        return CheckResult(CHECK_BLOCKED, "；".join(problems_blocked + problems_warning))
    if problems_warning:
        return CheckResult(CHECK_WARNING, "；".join(problems_warning))
    return CheckResult(CHECK_PASS, "")
