"""独立打印组件进程入口。

PyInstaller 打包后由核心通过 JSON 文件 IPC 调用，避免把 docx/reportlab 等重依赖塞进核心包。
"""

from __future__ import annotations

import argparse
import json
import traceback
from decimal import Decimal
from pathlib import Path

from . import PersonProfile, PrintEntry, PrintItem, PrintOptions, build_print_package


def main() -> int:
    parser = argparse.ArgumentParser(prog="tidoc_print")
    parser.add_argument("--input", required=True, help="核心传入的 JSON payload")
    parser.add_argument("--result", required=True, help="组件写出的 JSON 结果")
    args = parser.parse_args()

    result_path = Path(args.result)
    try:
        payload = json.loads(Path(args.input).read_text("utf-8"))
        entries = [_entry_from_dict(item) for item in payload.get("entries") or []]
        profiles = {
            key: PersonProfile(**(value or {}))
            for key, value in (payload.get("profiles") or {}).items()
        }
        options = PrintOptions(**(payload.get("options") or {}))
        results = build_print_package(entries, payload["out_dir"], options, profiles)
        data = {"results": [{"title": r.title, "files": r.files} for r in results]}
        _write_result(result_path, {"ok": True, "data": data})
        return 0
    except Exception as exc:  # noqa: BLE001
        _write_result(result_path, {
            "ok": False,
            "error": str(exc),
            "traceback": traceback.format_exc(),
        })
        return 1


def _entry_from_dict(data: dict) -> PrintEntry:
    items = [_item_from_dict(item) for item in data.get("items") or []]
    return PrintEntry(
        entry_id=data.get("entry_id", ""),
        title=data.get("title", ""),
        invoice_no=data.get("invoice_no", ""),
        invoice_date=data.get("invoice_date", ""),
        seller=data.get("seller", ""),
        total=_dec(data.get("total")),
        paid_amount=data.get("paid_amount", ""),
        profile_name=data.get("profile_name", ""),
        reviewer=data.get("reviewer", ""),
        items=items,
        invoice_pdfs=list(data.get("invoice_pdfs") or []),
        payment_images=list(data.get("payment_images") or []),
        inspection_pdfs=list(data.get("inspection_pdfs") or []),
    )


def _item_from_dict(data: dict) -> PrintItem:
    quantity = data.get("quantity")
    return PrintItem(
        actual_name=data.get("actual_name", ""),
        product_name=data.get("product_name", ""),
        unit=data.get("unit", ""),
        quantity=_dec(quantity) if quantity not in (None, "") else None,
        total=_dec(data.get("total")),
        seller=data.get("seller", ""),
        invoice_no=data.get("invoice_no", ""),
        storage_location=data.get("storage_location", ""),
    )


def _dec(value) -> Decimal:
    try:
        return Decimal(str(value if value not in (None, "") else "0"))
    except Exception:
        return Decimal("0")


def _write_result(path: Path, result: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2), "utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
