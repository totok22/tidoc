"""解析引擎与校验的回归测试（移植自 invoice2docx 的逻辑）。"""

from decimal import Decimal

from tidoc.engine import (
    CHECK_BLOCKED,
    CHECK_PASS,
    ParsedInvoice,
    ParsedItem,
    check_invoice,
    clean_item_name,
    money,
    parse_xml,
)
from tidoc.engine.money import d


def test_money_helpers():
    assert d("1,234.50") == Decimal("1234.50")
    assert d("¥99.99") == Decimal("99.99")
    assert d("") == Decimal("0")
    assert d(None) == Decimal("0")
    assert money(Decimal("1.005")) == Decimal("1.01")


def test_clean_item_name():
    assert clean_item_name("*电子元件*电阻") == "电阻"
    assert clean_item_name("无星号名称") == "无星号名称"


def test_parse_xml_fields(sample_xmls):
    inv = parse_xml(sample_xmls[0])
    assert inv.invoice_no
    assert inv.buyer_name
    assert inv.total > 0
    assert inv.items, "应识别出明细"
    assert inv.invoice_date  # IssueTime


def test_xml_amount_closure(sample_xmls):
    """所有 XML 样本：明细含税合计应等于价税合计（金额闭合）。"""
    checked = 0
    for path in sample_xmls:
        inv = parse_xml(path)
        if not inv.items:
            continue
        item_sum = sum((it.total for it in inv.items), Decimal("0"))
        assert money(inv.total - item_sum) == Decimal("0.00"), f"{path} 金额不闭合"
        checked += 1
    assert checked > 0


def test_check_pass():
    inv = ParsedInvoice(
        invoice_no="1", total=Decimal("100.00"), buyer_name="北京理工大学",
        items=[ParsedItem("*x*甲", "甲", "个", Decimal("1"), Decimal("100.00"))],
    )
    assert check_invoice(inv).status == CHECK_PASS


def test_check_blocked_on_mismatch():
    inv = ParsedInvoice(
        invoice_no="1", total=Decimal("100.00"), buyer_name="北京理工大学",
        items=[ParsedItem("*x*甲", "甲", "个", Decimal("1"), Decimal("90.00"))],
    )
    r = check_invoice(inv)
    assert r.status == CHECK_BLOCKED
    assert "相差" in r.message


def test_check_title_isolation():
    """抬头与所属分区不一致时 blocked（第 7 节强隔离）。"""
    inv = ParsedInvoice(
        invoice_no="1", total=Decimal("100.00"), buyer_name="北京理工大学教育基金会",
        items=[ParsedItem("*x*甲", "甲", "个", Decimal("1"), Decimal("100.00"))],
    )
    r = check_invoice(inv, expected_title="北京理工大学")
    assert r.status == CHECK_BLOCKED
    assert "不一致" in r.message
