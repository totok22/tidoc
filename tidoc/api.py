"""PyWebView JS↔Python 桥暴露的 API（设计文档第 4 节）。

前端通过 window.pywebview.api.<method> 调用。所有方法返回可 JSON 序列化的 dict / list，
统一用 {"ok": bool, ...} 包裹，异常转成 {"ok": False, "error": msg}，避免桥抛异常。
"""

from __future__ import annotations

import functools
import base64
import os
import re
import subprocess
import sys
import time
import webbrowser
import uuid
from pathlib import Path

from tidoc import __version__

from .db import (
    AttachmentRepo,
    BatchRepo,
    Database,
    DataRoot,
    EntryRepo,
    ProfileRepo,
)

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
        self.data_root = DataRoot(data_root, manage_pointer=True)
        self.db = Database(self.data_root.db_path)
        self.profiles = ProfileRepo(self.db)
        self.entries = EntryRepo(self.db)
        self.attachments = AttachmentRepo(self.db, self.data_root)
        self.batches = BatchRepo(self.db)
        self._window = None
        _cleanup_old_dropped_files(self.data_root.dropped_dir)

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

    # ------------------------------------------------------------ 应用偏好
    @_guard
    def app_preference(self, key, default=""):
        row = self.db.conn.execute("SELECT value FROM meta WHERE key = ?", (str(key),)).fetchone()
        return row["value"] if row else default

    @_guard
    def set_app_preference(self, key, value):
        self.db.conn.execute(
            "INSERT INTO meta(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (str(key), str(value)),
        )
        self.db.conn.commit()
        return {"key": str(key), "value": str(value)}

    @_guard
    def app_info(self):
        return {
            "name": "tidoc",
            "version": __version__,
            "author": "totok22",
            "repository": "https://github.com/totok22/tidoc",
        }

    # ------------------------------------------------------------ 录入 / 识别
    @_guard
    def parse_files(self, xml_path=None, pdf_path=None):
        """先解析、不落库，供前端预览识别结果与校验。"""
        from .engine import check_invoice, parse_invoice_files

        parsed = parse_invoice_files(xml_path, pdf_path)
        check = check_invoice(parsed)
        return {"parsed": parsed.to_dict(), "check": check.to_dict()}

    @_guard
    def create_entry(self, profile_id, title="", xml_path=None, pdf_path=None,
                     payment_paths=None, inspection_path=None, status="draft"):
        """从上传文件创建条目：解析 → 校验 → 落库 → 复制附件。"""
        from .engine import check_invoice, parse_invoice_files

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

        self.entries.recompute_status(entry_id)
        return self.entries.get(entry_id)

    # ------------------------------------------------------------ 文件夹批量导入
    @_guard
    def scan_folder(self, folder):
        """扫描目录，按发票 PDF 生成批量导入预览。"""
        from .services.folder_import import scan_folder

        return scan_folder(folder)

    @_guard
    def scan_files(self, paths):
        """扫描多选或拖入的发票文件，按发票 PDF 生成批量导入预览。"""
        from .services.folder_import import scan_files

        return scan_files(paths or [])

    @_guard
    def save_dropped_files(self, files):
        """保存前端拖入但拿不到本机路径的文件，返回临时路径列表。"""
        staging = self.data_root.dropped_dir
        staging.mkdir(parents=True, exist_ok=True)
        out = []
        for item in (files or []):
            name = _safe_filename(item.get("name") or "dropped-file")
            data_url = item.get("data_url") or ""
            if "," in data_url:
                data_url = data_url.split(",", 1)[1]
            if not data_url:
                raise ValueError(f"文件内容为空：{name}")
            raw = base64.b64decode(data_url)
            dest_dir = staging / uuid.uuid4().hex[:8]
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = dest_dir / name
            dest.write_bytes(raw)
            out.append(str(dest))
        return {"paths": out}

    @_guard
    def cleanup_dropped_files(self, paths):
        """删除拖拽中转区里的临时文件。只允许删除 dropped/ 内的文件。"""
        deleted = 0
        for path in (paths or []):
            p = Path(path)
            if _is_inside(self.data_root.dropped_dir, p) and p.is_file():
                p.unlink()
                _remove_empty_dropped_parent(self.data_root.dropped_dir, p.parent)
                deleted += 1
        return {"deleted": deleted}

    @_guard
    def batch_create_entries(self, profile_id, groups, title=""):
        """按前端确认后的分组批量创建条目。

        groups: [{"files": [{"path", "type"}...]}...]
        每组必须有发票 PDF，可附带 XML。付款截图 / 查验单在条目内添加。
        """
        from .engine import check_invoice, parse_invoice_files
        from .db import TYPE_INVOICE_PDF, TYPE_INVOICE_XML

        created, failed = [], []
        for g in (groups or []):
            files = g.get("files") or []
            invoice_files = [f for f in files if f.get("type") == TYPE_INVOICE_PDF]
            xml_files = [f for f in files if f.get("type") == TYPE_INVOICE_XML]
            pdf_path = next((f["path"] for f in files if f.get("type") == TYPE_INVOICE_PDF), None)
            xml_path = next((f["path"] for f in xml_files), None)
            try:
                if not pdf_path:
                    raise ValueError("缺少发票 PDF")
                parsed = parse_invoice_files(xml_path, pdf_path)
                if parsed.invoice_no:
                    old = self.db.conn.execute(
                        "SELECT id FROM entries WHERE profile_id = ? AND invoice_no = ? LIMIT 1",
                        (profile_id, parsed.invoice_no),
                    ).fetchone()
                    if old:
                        raise ValueError("这张发票已导入过")
                entry_id = self.entries.create(profile_id, title=title, parsed=parsed, status="draft")
                check = check_invoice(parsed, expected_title=title)
                self.entries.set_check(entry_id, check.status, check.message)
                for f in invoice_files:
                    self.attachments.add(entry_id, f["path"], TYPE_INVOICE_PDF)
                for f in xml_files:
                    self.attachments.add(entry_id, f["path"], TYPE_INVOICE_XML)
                self.entries.recompute_status(entry_id)
                created.append(entry_id)
            except Exception as exc:  # noqa: BLE001 — 单组失败不阻断其余
                failed.append({"group": g.get("label") or g.get("key") or "?", "error": str(exc)})
        return {"created": len(created), "entry_ids": created, "failed": failed}

    # ------------------------------------------------------------ 条目管理
    @_guard
    def list_entries(self, filters=None):
        return self.entries.list(**(filters or {}))

    @_guard
    def get_entry(self, entry_id):
        return self.entries.get(entry_id)

    @_guard
    def update_field(self, entry_id, field, value, profile_id=""):
        result = self.entries.update_field(entry_id, field, value, profile_id)
        self.entries.recompute_status(entry_id)
        return result

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

    # ------------------------------------------------------------ 标签（批量）
    @_guard
    def add_tag(self, entry_ids, tag):
        return {"changed": self.entries.add_tag(entry_ids or [], tag)}

    @_guard
    def remove_tag(self, entry_ids, tag):
        return {"changed": self.entries.remove_tag(entry_ids or [], tag)}

    @_guard
    def list_tags(self):
        return self.entries.all_tags()

    # ------------------------------------------------------------ 批次（运营组工作单元）
    @_guard
    def list_batches(self, include_archived=False):
        return self.batches.list(include_archived=include_archived)

    @_guard
    def get_batch(self, batch_id):
        return self.batches.get(batch_id)

    @_guard
    def create_batch(self, name, note="", entry_ids=None):
        return self.batches.create(name, note or "", entry_ids or [])

    @_guard
    def update_batch(self, batch_id, fields=None):
        return self.batches.update(batch_id, **(fields or {}))

    @_guard
    def archive_batch(self, batch_id, archived=True):
        return self.batches.set_archived(batch_id, archived)

    @_guard
    def delete_batch(self, batch_id):
        self.batches.delete(batch_id)
        return {"deleted": batch_id}

    @_guard
    def add_entries_to_batch(self, batch_id, entry_ids):
        return {"added": self.batches.add_entries(batch_id, entry_ids or [])}

    @_guard
    def remove_entries_from_batch(self, batch_id, entry_ids):
        return {"removed": self.batches.remove_entries(batch_id, entry_ids or [])}

    @_guard
    def set_batch_entry_note(self, batch_id, entry_id, note):
        return self.batches.set_entry_note(batch_id, entry_id, note or "")

    @_guard
    def batches_of_entry(self, entry_id):
        return self.batches.batches_of_entry(entry_id)

    # ------------------------------------------------------------ 明细行
    @_guard
    def add_item(self, entry_id, fields=None):
        return self.entries.add_item(entry_id, **(fields or {}))

    @_guard
    def update_item(self, item_id, fields=None):
        return self.entries.update_item(item_id, fields or {})

    @_guard
    def delete_item(self, item_id):
        entry_id = self.entries.delete_item(item_id)
        return {"deleted": item_id, "entry_id": entry_id}

    # ------------------------------------------------------------ 附件
    @_guard
    def add_attachment(self, entry_id, src_path, att_type, note=""):
        self._validate_attachment_for_entry(entry_id, src_path, att_type)
        att = self.attachments.add(entry_id, src_path, att_type, note)
        self.entries.recompute_status(entry_id)
        return att

    @_guard
    def delete_attachment(self, att_id):
        att = self.attachments.get(att_id)
        self.attachments.delete(att_id)
        if att and att.get("entry_id"):
            self.entries.recompute_status(att["entry_id"])
        return {"deleted": att_id}

    @_guard
    def set_attachment_note(self, att_id, note):
        return self.attachments.set_note(att_id, note)

    @_guard
    def update_attachment(self, att_id, fields=None):
        fields = fields or {}
        current = self.attachments.get(att_id)
        if not current:
            raise FileNotFoundError(f"附件不存在：{att_id}")
        new_type = fields.get("type") or current["type"]
        new_path = fields.get("src_path") or current["abs_path"]
        if fields.get("type") or fields.get("src_path"):
            self._validate_attachment_for_entry(current["entry_id"], new_path, new_type)
        att = self.attachments.update(
            att_id,
            att_type=fields.get("type"),
            src_path=fields.get("src_path"),
            note=fields.get("note"),
        )
        if att and att.get("entry_id"):
            self.entries.recompute_status(att["entry_id"])
        return att

    def _validate_attachment_for_entry(self, entry_id, src_path, att_type) -> None:
        from .db import TYPE_INSPECTION, TYPE_INVOICE_PDF, TYPE_INVOICE_XML
        from .engine import parse_invoice_files
        from .services.folder_import import classify_pdf_attachment_type, extract_pdf_invoice_no

        path = Path(src_path)
        suffix = path.suffix.lower()
        entry = self.entries.get(entry_id)
        if not entry:
            raise FileNotFoundError(f"条目不存在：{entry_id}")

        if att_type == TYPE_INVOICE_XML:
            if suffix != ".xml":
                raise ValueError("发票 XML 只能添加 .xml 文件。")
            parsed = parse_invoice_files(xml_path=path)
            if not parsed.invoice_no or not (parsed.seller or parsed.buyer_name):
                raise ValueError("这个 XML 不是可识别的官方电子发票 XML。")
            _validate_same_invoice(entry, parsed.invoice_no, path.name)
            return

        if att_type == TYPE_INVOICE_PDF:
            if suffix != ".pdf":
                raise ValueError("发票 PDF 只能添加 .pdf 文件。")
            detected = classify_pdf_attachment_type(path)
            if detected == TYPE_INSPECTION:
                raise ValueError("这个 PDF 像是发票查验单，请作为“查验单 PDF”添加。")
            parsed = parse_invoice_files(pdf_path=path)
            if not parsed.invoice_no:
                raise ValueError("无法从这个 PDF 识别发票号，请确认它是原始发票 PDF。")
            _validate_same_invoice(entry, parsed.invoice_no, path.name)
            return

        if att_type == TYPE_INSPECTION:
            if suffix != ".pdf":
                raise ValueError("查验单只能添加 PDF 文件。")
            detected = classify_pdf_attachment_type(path)
            if detected != TYPE_INSPECTION:
                try:
                    parsed = parse_invoice_files(pdf_path=path)
                except Exception:
                    parsed = None
                if parsed and parsed.invoice_no:
                    raise ValueError("这个 PDF 像是发票 PDF，请作为“发票 PDF”添加。")
                raise ValueError("无法确认这个 PDF 是发票查验单。")
            invoice_no = extract_pdf_invoice_no(path)
            if invoice_no:
                _validate_same_invoice(entry, invoice_no, path.name)

    @_guard
    def open_attachment(self, att_id):
        att = self.attachments.get(att_id)
        if not att:
            raise FileNotFoundError(f"附件不存在：{att_id}")
        _open_local_path(att["abs_path"])
        return {"opened": att["abs_path"]}

    @_guard
    def reveal_attachment(self, att_id):
        att = self.attachments.get(att_id)
        if not att:
            raise FileNotFoundError(f"附件不存在：{att_id}")
        _reveal_local_path(att["abs_path"])
        return {"revealed": att["abs_path"]}

    # ------------------------------------------------------------ 汇总 / 绑定包
    @_guard
    def build_summary(self, entry_ids):
        from .services.summary import build_summary

        return build_summary(self.entries, entry_ids)

    @_guard
    def export_bindle(self, entry_ids, out_name=None):
        from .services.bindle import export_bindle

        name = out_name or "绑定包"
        out_path = self.data_root.exports_dir / f"{name}.tidoc"
        lookup = {p["id"]: p for p in self.profiles.list()}
        result = export_bindle(self.entries, self.attachments, entry_ids, out_path, lookup)
        return {"path": str(result), "count": len(entry_ids)}

    @_guard
    def export_overview_excel(self, entry_ids, out_name=None):
        from .services.exports import export_overview_xlsx

        name = out_name or "报账总览"
        out_path = self.data_root.exports_dir / f"{name}.xlsx"
        lookup = {p["id"]: p for p in self.profiles.list()}
        result = export_overview_xlsx(self.entries, lookup, entry_ids, out_path)
        return {"path": str(result), "count": len(entry_ids)}

    @_guard
    def export_attachment_archive(self, entry_ids, out_name=None):
        from .services.exports import export_attachment_zip

        name = out_name or "附件整理包"
        out_path = self.data_root.exports_dir / f"{name}.zip"
        lookup = {p["id"]: p for p in self.profiles.list()}
        result = export_attachment_zip(
            self.entries, self.data_root.attachments_dir, lookup, entry_ids, out_path
        )
        return {"path": str(result), "count": len(entry_ids)}

    @_guard
    def inspect_bindle(self, path):
        from .services.bindle import inspect_bindle

        return inspect_bindle(path)

    @_guard
    def import_bindle(self, path, profile_id, allow_tampered=False):
        from .services.bindle import import_bindle

        return import_bindle(self.entries, self.attachments, path, profile_id, allow_tampered)

    # ------------------------------------------------------------ 打印导出组件（可选）
    @_guard
    def print_component_status(self):
        from .services.printing import component_status
        return component_status(self.data_root.components_dir)

    @_guard
    def build_prints(self, entry_ids, options=None, out_name=None):
        """生成打印件（发票拼接 / 付款截图拼接 / 查验单拼接 / 报账说明 / 验收单）。
        按抬头强隔离，输出到 exports/<out_name>/<抬头>/。"""
        from .services.printing import build_prints as _build
        name = out_name or "打印件"
        out_dir = self.data_root.exports_dir / name
        return _build(self.entries, self.profiles, self.data_root.attachments_dir,
                      entry_ids, out_dir, options, self.data_root.components_dir)

    # ------------------------------------------------------------ 联网更新（腾讯云 COS）
    @_guard
    def check_updates(self):
        from .services.updater import check_updates
        return check_updates(self.data_root.components_dir)

    @_guard
    def download_core_update(self):
        from .services.updater import COMPONENT_CORE, download_update, load_manifest
        manifest = load_manifest()
        result = download_update(manifest, COMPONENT_CORE, self.data_root.updates_dir)
        return result.to_dict()

    @_guard
    def install_print_component(self):
        from .services.updater import install_print_component, load_manifest
        manifest = load_manifest()
        result = install_print_component(
            manifest, self.data_root.components_dir, self.data_root.updates_dir
        )
        return result.to_dict()

    # ------------------------------------------------------------ 文件对话框
    @_guard
    def pick_files(self, multiple=True, file_types=None):
        """调系统文件选择框，返回路径列表。前端拿不到本地路径，必须走这里。"""
        import webview
        dialog_type = _file_dialog_kind(webview, "OPEN", "OPEN_DIALOG")
        types = tuple(file_types) if file_types else ()
        result = self._window.create_file_dialog(
            dialog_type, allow_multiple=multiple, file_types=types
        )
        return {"paths": list(result) if result else []}

    @_guard
    def pick_folder(self):
        """调系统文件夹选择框，返回目录路径。"""
        import webview
        result = self._window.create_file_dialog(_file_dialog_kind(webview, "FOLDER", "FOLDER_DIALOG"))
        path = (list(result)[0] if result else "") if result else ""
        return {"path": path}

    @_guard
    def data_root_path(self):
        from .db.paths import default_data_root
        d = self._paths_dict()
        d["is_default"] = str(self.data_root.root) == str(default_data_root())
        return d

    @_guard
    def choose_and_migrate_data_root(self):
        """弹出文件夹选择框，把数据迁到用户选的空目录，并热重建各仓库。

        选中目录后：关闭当前 DB 连接 → 移动全部数据 → 用新根重开连接与仓库。
        返回新的路径清单，供前端刷新设置页显示。
        """
        import webview
        result = self._window.create_file_dialog(
            _file_dialog_kind(webview, "FOLDER", "FOLDER_DIALOG")
        )
        target = (list(result)[0] if result else "") if result else ""
        if not target:
            return {"ok": True, "data": {"changed": False}}
        old_root = self.data_root
        # 先断开 DB（释放 sqlite 文件句柄），再搬运，避免 Windows 下占用无法移动。
        self.db.close()
        try:
            new_root_path = old_root.migrate_to(target)
        except Exception:
            # 迁移失败：用原根恢复连接，保证应用可继续用。
            self._rebuild_repos(old_root.root)
            raise
        self._rebuild_repos(new_root_path)
        return {"ok": True, "data": {"changed": True, **self._paths_dict()}}

    @_guard
    def reset_data_root_to_default(self):
        """把数据迁回系统默认目录（清除迁移指针）。"""
        from .db.paths import default_data_root
        default = default_data_root()
        if str(self.data_root.root) == str(default):
            return {"changed": False}
        self.db.close()
        new_root_path = self.data_root.migrate_to(default)
        self._rebuild_repos(new_root_path)
        return {"changed": True, **self._paths_dict()}

    def _rebuild_repos(self, root) -> None:
        """用给定数据根重建 DataRoot / Database 及各仓库（迁移后热切换）。"""
        self.data_root = DataRoot(root, manage_pointer=True)
        self.db = Database(self.data_root.db_path)
        self.profiles = ProfileRepo(self.db)
        self.entries = EntryRepo(self.db)
        self.attachments = AttachmentRepo(self.db, self.data_root)
        self.batches = BatchRepo(self.db)

    def _paths_dict(self) -> dict:
        return {
            "root": str(self.data_root.root),
            "attachments": str(self.data_root.attachments_dir),
            "exports": str(self.data_root.exports_dir),
            "db": str(self.data_root.db_path),
            "components": str(self.data_root.components_dir),
            "updates": str(self.data_root.updates_dir),
        }

    @_guard
    def open_path(self, path):
        _open_local_path(path)
        return {"opened": str(path)}

    @_guard
    def open_external_url(self, url):
        text = str(url)
        if not (text.startswith("https://") or text.startswith("http://")):
            raise ValueError("只能打开网页链接。")
        webbrowser.open(text)
        return {"opened": text}


def _file_dialog_kind(webview_module, modern_name: str, legacy_name: str):
    file_dialog = getattr(webview_module, "FileDialog", None)
    if file_dialog is not None and hasattr(file_dialog, modern_name):
        return getattr(file_dialog, modern_name)
    return getattr(webview_module, legacy_name)


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[/\\:\0]+", "_", name).strip()
    return cleaned or "dropped-file"


def _is_inside(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _cleanup_old_dropped_files(folder: Path, max_age_seconds: int = 24 * 60 * 60) -> None:
    if not folder.exists():
        return
    cutoff = time.time() - max_age_seconds
    for path in folder.rglob("*"):
        if path.is_file() and path.stat().st_mtime < cutoff:
            path.unlink()
            _remove_empty_dropped_parent(folder, path.parent)


def _remove_empty_dropped_parent(root: Path, folder: Path) -> None:
    if folder.resolve() == root.resolve() or not _is_inside(root, folder):
        return
    try:
        folder.rmdir()
    except OSError:
        pass


def _open_local_path(path: str | Path) -> None:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"文件不存在：{p}")
    if sys.platform == "darwin":
        subprocess.Popen(["open", str(p)])
    elif os.name == "nt":
        os.startfile(str(p))  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["xdg-open", str(p)])


def _validate_same_invoice(entry: dict, invoice_no: str, filename: str) -> None:
    expected = entry.get("invoice_no") or ""
    if expected and invoice_no and invoice_no != expected:
        raise ValueError(f"这份材料不属于当前条目：{filename}。识别到发票号 {invoice_no}，当前条目是 {expected}。")


def _reveal_local_path(path: str | Path) -> None:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"文件不存在：{p}")
    if sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(p)])
    elif os.name == "nt":
        subprocess.Popen(["explorer", "/select,", str(p)])
    else:
        _open_local_path(p.parent)
