"""PyWebView JS↔Python 桥暴露的 API（设计文档第 4 节）。

前端通过 window.pywebview.api.<method> 调用。所有方法返回可 JSON 序列化的 dict / list，
统一用 {"ok": bool, ...} 包裹，异常转成 {"ok": False, "error": msg}，避免桥抛异常。
"""

from __future__ import annotations

import functools
from pathlib import Path

from .db import (
    AttachmentRepo,
    Database,
    DataRoot,
    EntryRepo,
    ProfileRepo,
)
from .engine import check_invoice, parse_invoice_files
from .services import export_bindle, import_bindle, inspect_bindle
from .services.summary import build_summary


def _guard(func):
    """把返回值包成 {ok:True,...}，异常包成 {ok:False,error:...}。"""
    @functools.wraps(func)
    def wrapper(self, *args, **kwargs):
        try:
            result = func(self, *args, **kwargs)
            if isinstance(result, dict) and "ok" in result:
                return result
            return {"ok": True, "data": result}
        except Exception as exc:  # noqa: BLE001 — 桥不能抛，统一转错误
            return {"ok": False, "error": str(exc)}
    return wrapper


class Api:
    def __init__(self, data_root: str | Path | None = None):
        self.data_root = DataRoot(data_root)
        self.db = Database(self.data_root.db_path)
        self.profiles = ProfileRepo(self.db)
        self.entries = EntryRepo(self.db)
        self.attachments = AttachmentRepo(self.db, self.data_root)
        self._window = None

    def bind_window(self, window) -> None:
        self._window = window

    # ------------------------------------------------------------ 身份
    @_guard
    def list_profiles(self):
        return self.profiles.list()

    @_guard
    def create_profile(self, name, reviewer, is_default=False, optional=None):
        return self.profiles.create(name, reviewer, is_default, **(optional or {}))

    @_guard
    def update_profile(self, profile_id, fields=None):
        return self.profiles.update(profile_id, **(fields or {}))

    @_guard
    def set_default_profile(self, profile_id):
        self.profiles.set_default(profile_id)
        return {"profile_id": profile_id}

    @_guard
    def delete_profile(self, profile_id):
        self.profiles.delete(profile_id)
        return {"deleted": profile_id}

    # ------------------------------------------------------------ 录入 / 识别
    @_guard
    def parse_files(self, xml_path=None, pdf_path=None):
        """先解析、不落库，供前端预览识别结果与校验。"""
        parsed = parse_invoice_files(xml_path, pdf_path)
        check = check_invoice(parsed)
        return {"parsed": parsed.to_dict(), "check": check.to_dict()}

    @_guard
    def create_entry(self, profile_id, title="", xml_path=None, pdf_path=None,
                     payment_paths=None, inspection_path=None, status="draft"):
        """从上传文件创建条目：解析 → 校验 → 落库 → 复制附件。"""
        parsed = None
        if xml_path or pdf_path:
            parsed = parse_invoice_files(xml_path, pdf_path)
        entry_id = self.entries.create(profile_id, title=title, parsed=parsed, status=status)

        if parsed:
            check = check_invoice(parsed, expected_title=title)
            self.entries.set_check(entry_id, check.status, check.message)

        from .db import TYPE_INSPECTION, TYPE_INVOICE_PDF, TYPE_INVOICE_XML, TYPE_PAYMENT
        if xml_path:
            self.attachments.add(entry_id, xml_path, TYPE_INVOICE_XML)
        if pdf_path:
            self.attachments.add(entry_id, pdf_path, TYPE_INVOICE_PDF)
        for pp in (payment_paths or []):
            self.attachments.add(entry_id, pp, TYPE_PAYMENT)
        if inspection_path:
            self.attachments.add(entry_id, inspection_path, TYPE_INSPECTION)

        return self.entries.get(entry_id)

    # ------------------------------------------------------------ 条目管理
    @_guard
    def list_entries(self, filters=None):
        return self.entries.list(**(filters or {}))

    @_guard
    def get_entry(self, entry_id):
        return self.entries.get(entry_id)

    @_guard
    def update_field(self, entry_id, field, value, profile_id=""):
        return self.entries.update_field(entry_id, field, value, profile_id)

    @_guard
    def correct_locked_field(self, entry_id, field, value, profile_id=""):
        return self.entries.correct_locked_field(entry_id, field, value, profile_id)

    @_guard
    def set_status(self, entry_id, status):
        self.entries.set_status(entry_id, status)
        return {"entry_id": entry_id, "status": status}

    @_guard
    def set_meta(self, entry_id, category=None, tags=None):
        if isinstance(category, dict):
            tags = category.get("tags")
            category = category.get("category")
        self.entries.set_meta(entry_id, category=category, tags=tags)
        return self.entries.get(entry_id)

    @_guard
    def delete_entry(self, entry_id):
        self.entries.delete(entry_id)
        return {"deleted": entry_id}

    @_guard
    def delete_entries(self, entry_ids):
        n = self.entries.delete_many(entry_ids)
        return {"deleted": n}

    # ------------------------------------------------------------ 附件
    @_guard
    def add_attachment(self, entry_id, src_path, att_type, note=""):
        return self.attachments.add(entry_id, src_path, att_type, note)

    @_guard
    def delete_attachment(self, att_id):
        self.attachments.delete(att_id)
        return {"deleted": att_id}

    @_guard
    def set_attachment_note(self, att_id, note):
        return self.attachments.set_note(att_id, note)

    # ------------------------------------------------------------ 汇总 / 绑定包
    @_guard
    def build_summary(self, entry_ids):
        return build_summary(self.entries, entry_ids)

    @_guard
    def export_bindle(self, entry_ids, out_name=None):
        name = out_name or "绑定包"
        out_path = self.data_root.exports_dir / f"{name}.tidoc"
        lookup = {p["id"]: p for p in self.profiles.list()}
        result = export_bindle(self.entries, self.attachments, entry_ids, out_path, lookup)
        return {"path": str(result), "count": len(entry_ids)}

    @_guard
    def inspect_bindle(self, path):
        return inspect_bindle(path)

    @_guard
    def import_bindle(self, path, profile_id, allow_tampered=False):
        return import_bindle(self.entries, self.attachments, path, profile_id, allow_tampered)

    # ------------------------------------------------------------ 打印导出组件（可选）
    @_guard
    def print_component_status(self):
        from .services.printing import component_status
        return component_status()

    @_guard
    def build_prints(self, entry_ids, options=None, out_name=None):
        """生成打印件（发票拼接 / 付款截图拼接 / 查验单拼接 / 报账说明 / 验收单）。
        按抬头强隔离，输出到 exports/<out_name>/<抬头>/。"""
        from .services.printing import build_prints as _build
        name = out_name or "打印件"
        out_dir = self.data_root.exports_dir / name
        return _build(self.entries, self.profiles, self.data_root.attachments_dir,
                      entry_ids, out_dir, options)

    # ------------------------------------------------------------ 文件对话框
    @_guard
    def pick_files(self, multiple=True, file_types=None):
        """调系统文件选择框，返回路径列表。前端拿不到本地路径，必须走这里。"""
        import webview
        dialog_type = webview.OPEN_DIALOG
        types = tuple(file_types) if file_types else ()
        result = self._window.create_file_dialog(
            dialog_type, allow_multiple=multiple, file_types=types
        )
        return {"paths": list(result) if result else []}

    @_guard
    def data_root_path(self):
        return {"root": str(self.data_root.root)}
