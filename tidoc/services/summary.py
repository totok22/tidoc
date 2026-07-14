"""汇总信息文件（设计文档第 8.4 节）。

轻量但信息齐全的结构化 JSON，程序易识别。每条含：发票号码、发票日期、
来源 / 出货厂商、价税合计、总个数、所属抬头。可随时导出供他人导入。
"""

from __future__ import annotations

from decimal import Decimal

from ..db.entries import EntryRepo, paid_amount_differs

SUMMARY_VERSION = 1


def _item_count(entry: dict) -> int:
    from decimal import Decimal as D
    total = D("0")
    has_qty = False
    for it in entry.get("items", []):
        q = it.get("quantity")
        if q not in (None, ""):
            has_qty = True
            try:
                total += D(str(q))
            except Exception:
                pass
    if has_qty:
        return int(total) if total == total.to_integral_value() else float(total)
    return len(entry.get("items", []))


def build_entry_summary(entry: dict) -> dict:
    """把一个完整 entry（含 items/fields）压成汇总记录。"""
    fields = entry.get("fields", {})
    return {
        "invoice_no": entry.get("invoice_no", ""),
        "invoice_date": entry.get("invoice_date", ""),
        "seller": entry.get("seller", ""),          # 来源 / 出货厂商
        "total": entry.get("total", ""),            # 价税合计
        "item_count": _item_count(entry),
        "title": entry.get("title", ""),            # 所属抬头
        "status": entry.get("status", ""),
        "check_status": entry.get("check_status", ""),
        "paid_amount": fields.get("paid_amount", {}).get("current", ""),
        "actual_item_name": fields.get("actual_item_name", {}).get("current", ""),
        "notes": fields.get("notes", {}).get("current", ""),
        "modified_fields": (["paid_amount"] if paid_amount_differs(
            entry.get("total", ""), fields.get("paid_amount", {}).get("current", "")
        ) else []),
    }


def build_summary(entries_repo: EntryRepo, entry_ids: list[str]) -> dict:
    """给一组 entry_id，生成汇总文档。按抬头分组以体现强隔离（第 7 节）。"""
    records: list[dict] = []
    total = Decimal("0")
    for eid in entry_ids:
        entry = entries_repo.get(eid)
        if not entry:
            continue
        rec = build_entry_summary(entry)
        records.append(rec)
        try:
            total += Decimal(entry.get("total") or "0")
        except Exception:
            pass

    by_title: dict[str, list[dict]] = {}
    for rec in records:
        by_title.setdefault(rec["title"] or "(未标注抬头)", []).append(rec)

    return {
        "summary_version": SUMMARY_VERSION,
        "count": len(records),
        "total": str(total),
        "by_title": {t: len(v) for t, v in by_title.items()},
        "entries": records,
    }
