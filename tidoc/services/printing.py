"""核心 ↔ 打印导出组件的适配层（设计文档第 9 节）。

打印组件（tidoc_print）是可选安装件，重依赖不进核心。这里：
- 探测组件是否可用。
- 把核心的条目 dict + 附件 + profile 转成组件的 PrintEntry。
- 调组件生成打印件；组件未装时给出清晰提示，不让核心崩。
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from dataclasses import asdict, is_dataclass
from decimal import Decimal
from pathlib import Path

from ..db.attachments import (
    TYPE_INSPECTION,
    TYPE_INVOICE_PDF,
    TYPE_PAYMENT,
)
from ..db.entries import EntryRepo
from ..db.profiles import ProfileRepo
from .updater import print_component_executable


def component_status(components_dir: str | Path | None = None) -> dict:
    """打印组件是否可用 + 缺哪些依赖。核心据此决定入口是否置灰。"""
    external = print_component_executable(components_dir) if components_dir else None
    try:
        import tidoc_print
    except Exception as exc:  # noqa: BLE001
        if external:
            return {"available": True, "mode": "external", "path": str(external), "missing": []}
        return {"available": False, "mode": "missing", "missing": ["tidoc_print"], "error": str(exc)}
    available = tidoc_print.is_available()
    if available:
        return {"available": True, "mode": "python", "missing": []}
    if external:
        return {
            "available": True,
            "mode": "external",
            "path": str(external),
            "missing": [],
            "python_missing": tidoc_print.missing_dependencies(),
        }
    return {"available": False, "mode": "python", "missing": tidoc_print.missing_dependencies()}


def _to_decimal(v) -> Decimal:
    try:
        return Decimal(str(v)) if v not in (None, "") else Decimal("0")
    except Exception:
        return Decimal("0")


def _entry_to_print(entry: dict, attachments_dir: Path, profile: dict):
    """把核心条目 dict 转成组件的 PrintEntry。"""
    from tidoc_print import PrintEntry, PrintItem

    payload = _entry_to_print_payload(entry, attachments_dir, profile)
    items = [PrintItem(
        actual_name=it["actual_name"],
        product_name=it["product_name"],
        unit=it["unit"],
        quantity=_to_decimal(it["quantity"]) if it["quantity"] else None,
        total=_to_decimal(it["total"]),
        seller=it["seller"],
        invoice_no=it["invoice_no"],
    ) for it in payload["items"]]
    payload["items"] = items
    payload["total"] = _to_decimal(payload["total"])
    return PrintEntry(**payload)


def _entry_to_print_payload(entry: dict, attachments_dir: Path, profile: dict) -> dict:
    """把核心条目 dict 转成外部组件可读的 JSON payload。"""
    def abs_paths(att_type):
        return [str(attachments_dir / a["stored_path"])
                for a in entry.get("attachments", []) if a["type"] == att_type]

    items = [
        {
            "actual_name": it.get("actual_name") or it.get("name", ""),
            "product_name": it.get("actual_name") or it.get("name", ""),
            "unit": it.get("unit", ""),
            "quantity": it.get("quantity") or "",
            "total": it.get("total") or "0",
            "seller": entry.get("seller", ""),
            "invoice_no": entry.get("invoice_no", ""),
        }
        for it in entry.get("items", [])
    ]
    fields = entry.get("fields", {})
    return {
        "entry_id": entry["id"],
        "title": entry.get("title", ""),
        "invoice_no": entry.get("invoice_no", ""),
        "invoice_date": entry.get("invoice_date", ""),
        "seller": entry.get("seller", ""),
        "total": entry.get("total") or "0",
        "paid_amount": fields.get("paid_amount", {}).get("current", ""),
        "profile_name": profile.get("name", ""),
        "reviewer": profile.get("reviewer", ""),
        "items": items,
        "invoice_pdfs": abs_paths(TYPE_INVOICE_PDF),
        "payment_images": abs_paths(TYPE_PAYMENT),
        "inspection_pdfs": abs_paths(TYPE_INSPECTION),
    }


def build_prints(
    entries_repo: EntryRepo,
    profiles_repo: ProfileRepo,
    attachments_dir: Path,
    entry_ids: list[str],
    out_dir: str | Path,
    options: dict | None = None,
    components_dir: str | Path | None = None,
) -> dict:
    """核心调用入口：生成打印件。返回按抬头分组的结果。"""
    status = component_status(components_dir)
    if not status["available"]:
        raise RuntimeError(
            f"打印导出组件未安装或缺少依赖：{', '.join(status['missing'])}。"
        )

    profiles = {p["id"]: p for p in profiles_repo.list()}
    print_entries = []
    person_profiles: dict[str, dict] = {}
    for eid in entry_ids:
        entry = entries_repo.get(eid)
        if not entry:
            continue
        prof = profiles.get(entry.get("profile_id"), {})
        pe = (
            _entry_to_print_payload(entry, Path(attachments_dir), prof)
            if status.get("mode") == "external"
            else _entry_to_print(entry, Path(attachments_dir), prof)
        )
        print_entries.append(pe)
        entry_key = pe["entry_id"] if isinstance(pe, dict) else pe.entry_id
        person_profiles[entry_key] = {
            "person_name": prof.get("name", ""),
            "student_id": prof.get("student_id", ""),
            "contact": prof.get("contact", ""),
            "bank_name": prof.get("bank_name", ""),
            "bank_card": prof.get("bank_card", ""),
        }

    if not print_entries:
        raise RuntimeError("没有可打印的条目。")

    if status.get("mode") == "external":
        return _build_prints_external(status["path"], print_entries, out_dir, options, person_profiles)

    from tidoc_print import PersonProfile, PrintOptions, build_print_package

    opts = PrintOptions(**(options or {}))
    typed_profiles = {k: PersonProfile(**v) for k, v in person_profiles.items()}
    results = build_print_package(print_entries, out_dir, opts, typed_profiles)
    return {"results": [{"title": r.title, "files": r.files} for r in results]}


def _build_prints_external(executable: str, entries: list, out_dir: str | Path,
                           options: dict | None, profiles: dict) -> dict:
    payload = {
        "entries": [_jsonable(e) for e in entries],
        "out_dir": str(out_dir),
        "options": options or {},
        "profiles": {k: _jsonable(v) for k, v in profiles.items()},
    }
    with tempfile.TemporaryDirectory(prefix="tidoc-print-") as tmp:
        in_path = Path(tmp) / "input.json"
        out_path = Path(tmp) / "result.json"
        in_path.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
        cmd = [executable, "--input", str(in_path), "--result", str(out_path)]
        if sys.platform == "darwin" and executable.endswith(".app"):
            cmd = ["open", "-W", "-a", executable, "--args", "--input", str(in_path), "--result", str(out_path)]
        proc = subprocess.run(cmd, text=True, capture_output=True, check=False)
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "").strip()
            raise RuntimeError(f"打印组件执行失败：{detail or proc.returncode}")
        if not out_path.exists():
            raise RuntimeError("打印组件未返回结果。")
        result = json.loads(out_path.read_text("utf-8"))
        if not result.get("ok"):
            raise RuntimeError(result.get("error") or "打印组件执行失败。")
        return result["data"]


def _jsonable(value):
    if is_dataclass(value):
        return _jsonable(asdict(value))
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value
