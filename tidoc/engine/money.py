"""金额处理：统一用 Decimal，避免浮点误差。移植自 invoice2docx/engine.py。"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

MONEY = Decimal("0.01")


def d(value: str | int | float | Decimal | None) -> Decimal:
    """把任意来源的金额文本安全转成 Decimal，无法解析时返回 0。"""
    if value is None:
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    text = str(value).replace(",", "").replace("¥", "").replace("￥", "").strip()
    if not text:
        return Decimal("0")
    try:
        return Decimal(text)
    except InvalidOperation:
        return Decimal("0")


def money(value: Decimal) -> Decimal:
    """四舍五入到分。"""
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


def fmt_money(value: Decimal, currency: bool = False) -> str:
    prefix = "¥" if currency else ""
    return f"{prefix}{money(value):.2f}"


def fmt_decimal(value: Decimal | None, places: int = 8) -> str:
    """格式化数量 / 单价，去掉多余的尾随 0。"""
    if value is None:
        return ""
    quant = Decimal("1." + "0" * places)
    text = f"{value.quantize(quant, rounding=ROUND_HALF_UP):f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text
