"""解析引擎：发票 XML/PDF 解析、金额闭合校验。移植自 invoice2docx/engine.py。"""

from .models import (
    CHECK_BLOCKED,
    CHECK_PASS,
    CHECK_WARNING,
    CheckResult,
    ParsedInvoice,
    ParsedItem,
)
from .money import d, fmt_decimal, fmt_money, money
from .parser import clean_item_name, parse_invoice_files, parse_pdf, parse_xml
from .validator import (
    SUPPORTED_TITLES,
    TITLE_FOUNDATION,
    TITLE_UNIVERSITY,
    check_invoice,
)

__all__ = [
    "CHECK_BLOCKED",
    "CHECK_PASS",
    "CHECK_WARNING",
    "CheckResult",
    "ParsedInvoice",
    "ParsedItem",
    "d",
    "money",
    "fmt_money",
    "fmt_decimal",
    "clean_item_name",
    "parse_xml",
    "parse_pdf",
    "parse_invoice_files",
    "check_invoice",
    "SUPPORTED_TITLES",
    "TITLE_UNIVERSITY",
    "TITLE_FOUNDATION",
]
