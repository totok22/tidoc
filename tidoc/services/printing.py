"""核心 ↔ 打印导出组件的适配层（设计文档第 9 节）。

打印组件（tidoc_print）是可选安装件，重依赖不进核心。这里：
- 探测组件是否可用。
- 把核心的条目 dict + 附件 + profile 转成组件的 PrintEntry。
- 调组件生成打印件；组件未装时给出清晰提示，不让核心崩。
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from ..db.attachments import (
    TYPE_INSPECTION,
    TYPE_INVOICE_PDF,
    TYPE_PAYMENT,
)
from ..db.entries import EntryRepo
from ..db.profiles import ProfileRepo


def component_status() -> dict:
    """打印组件是否可用 + 缺哪些依赖。核心据此决定入口是否置灰。"""
    try:
        import tidoc_print
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "missing": ["tidoc_print"], "error": str(exc)}
    return {"available": tidoc_print.is_available(), "missing": tidoc_print.missing_dependencies()}


def _to_decimal(v) -> Decimal:
    try:
        return Decimal(str(v)) if v not in (None, "") else Decimal("0")
    except Exception:
        return Decimal("0")


def _entry_to_print(entry: dict, attachments_dir: Path, profile: dict):
    """把核心条目 dict 转成组件的 PrintEntry。"""
    from tidoc_print import PrintEntry, PrintItem

    def abs_paths(att_type):
        return [str(attachments_dir / a["stored_path"])
                for a in entry.get("attachments", []) if a["type"] == att_type]

    items = [
        PrintItem(
            actual_name=it.get("actual_name") or it.get("name", ""),
            product_name=it.get("actual_name") or it.get("name", ""),
            unit=it.get("unit", ""),
            quantity=_to_decimal(it.get("quantity")) if it.get("quantity") else None,
            total=_to_decimal(it.get("total")),
            seller=entry.get("seller", ""),
            invoice_no=entry.get("invoice_no", ""),
        )
        for it in entry.get("items", [])
    ]
    fields = entry.get("fields", {})
    return PrintEntry(
        entry_id=entry["id"],
        title=entry.get("title", ""),
        invoice_no=entry.get("invoice_no", ""),
        invoice_date=entry.get("invoice_date", ""),
        seller=entry.get("seller", ""),
        total=_to_decimal(entry.get("total")),
        paid_amount=fields.get("paid_amount", {}).get("current", ""),
        profile_name=profile.get("name", ""),
        reviewer=profile.get("reviewer", ""),
        items=items,
        invoice_pdfs=abs_paths(TYPE_INVOICE_PDF),
        payment_images=abs_paths(TYPE_PAYMENT),
        inspection_pdfs=abs_paths(TYPE_INSPECTION),
    )


def build_prints(
    entries_repo: EntryRepo,
    profiles_repo: ProfileRepo,
    attachments_dir: Path,
    entry_ids: list[str],
    out_dir: str | Path,
    options: dict | None = None,
) -> dict:
    """核心调用入口：生成打印件。返回按抬头分组的结果。"""
    status = component_status()
    if not status["available"]:
        raise RuntimeError(
            f"打印导出组件未安装或缺少依赖：{', '.join(status['missing'])}。"
        )

    from tidoc_print import PersonProfile, PrintOptions, build_print_package

    profiles = {p["id"]: p for p in profiles_repo.list()}
    print_entries = []
    person_profiles: dict[str, PersonProfile] = {}
    for eid in entry_ids:
        entry = entries_repo.get(eid)
        if not entry:
            continue
        prof = profiles.get(entry.get("profile_id"), {})
        pe = _entry_to_print(entry, Path(attachments_dir), prof)
        print_entries.append(pe)
        person_profiles[pe.entry_id] = PersonProfile(
            person_name=prof.get("name", ""),
            student_id=prof.get("student_id", ""),
            contact=prof.get("contact", ""),
            bank_name=prof.get("bank_name", ""),
            bank_card=prof.get("bank_card", ""),
        )

    if not print_entries:
        raise RuntimeError("没有可打印的条目。")

    opts = PrintOptions(**(options or {}))
    results = build_print_package(print_entries, out_dir, opts, person_profiles)
    return {"results": [{"title": r.title, "files": r.files} for r in results]}
