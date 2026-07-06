"""报账条目（Entry）仓库。设计文档第 5、6、8 节。

职责：
- 从解析结果创建条目，写入识别字段（只读）、明细、可改字段的 origin 值。
- 可改字段更新走 update_field：current != origin 即永久打标记 + 写 field_history。
- 关键信息（发票号、总额、抬头、税号）默认只读；确需修正走 correct_locked_field 留痕。
- 列表 / 筛选 / 搜索、状态机、删除。
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from ..engine.models import ParsedInvoice
from ..engine.money import money
from .database import Database

# 可自由修改的字段（设计文档 8.5）
EDITABLE_FIELDS = ("paid_amount", "actual_item_name", "notes")
# 关键信息，软件内默认只读；确需修正走特殊留痕流程（设计文档 8.5、第 6 节）
LOCKED_FIELDS = ("invoice_no", "total", "buyer_name", "buyer_tax_id", "title", "seller", "invoice_date")

STATUS_DRAFT = "draft"
STATUS_PARTIAL = "partial"
STATUS_COMPLETE = "complete"
VALID_STATUS = (STATUS_DRAFT, STATUS_PARTIAL, STATUS_COMPLETE)


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _row_to_dict(row) -> dict:
    return {k: row[k] for k in row.keys()} if row else {}


class EntryRepo:
    def __init__(self, db: Database):
        self.db = db

    # ------------------------------------------------------------------ 创建
    def create(
        self,
        profile_id: str,
        title: str = "",
        parsed: ParsedInvoice | None = None,
        status: str = STATUS_DRAFT,
    ) -> str:
        entry_id = uuid.uuid4().hex
        now = _now()
        p = parsed or ParsedInvoice()
        self.db.conn.execute(
            """INSERT INTO entries(id, profile_id, title, invoice_no, invoice_date,
               seller, total, buyer_name, buyer_tax_id, status, check_status,
               source, created_at, updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (entry_id, profile_id, title or p.buyer_name, p.invoice_no, p.invoice_date,
             p.seller, str(money(p.total)) if p.total else "", p.buyer_name,
             p.buyer_tax_id, status, "warning", p.source, now, now),
        )
        # 可改字段初始化：origin = current（识别原值；实付金额识别不到留空）
        for field in EDITABLE_FIELDS:
            origin = self._initial_editable(field, p)
            self.db.conn.execute(
                "INSERT INTO entry_fields(entry_id, field, origin, current, modified) VALUES(?,?,?,?,0)",
                (entry_id, field, origin, origin),
            )
        # 明细
        for i, item in enumerate(p.items):
            self.db.conn.execute(
                """INSERT INTO items(entry_id, name, actual_name, unit, quantity,
                   unit_price, total, spec, ordinal) VALUES(?,?,?,?,?,?,?,?,?)""",
                (entry_id, item.name, item.actual_name, item.unit,
                 str(item.quantity) if item.quantity is not None else "",
                 str(money(item.unit_price)), str(money(item.total)), item.spec, i),
            )
        self.db.conn.commit()
        return entry_id

    @staticmethod
    def _initial_editable(field: str, p: ParsedInvoice) -> str:
        if field == "actual_item_name":
            return p.items[0].actual_name if p.items else ""
        return ""

    # ------------------------------------------------------------------ 读取
    def get(self, entry_id: str) -> dict | None:
        row = self.db.conn.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
        if not row:
            return None
        entry = _row_to_dict(row)
        entry["tags"] = json.loads(entry.get("tags") or "[]")
        entry["fields"] = self._fields(entry_id)
        entry["items"] = self._items(entry_id)
        entry["attachments"] = self._attachments(entry_id)
        entry["history"] = self.history(entry_id)
        # 按类型汇总附件在场情况，供完整度派生（与 list 保持一致）
        types = {a["type"] for a in entry["attachments"]}
        entry["has_invoice"] = bool({"invoice_pdf", "invoice_xml"} & types)
        entry["has_payment"] = "payment_screenshot" in types
        entry["has_inspection"] = "inspection_pdf" in types
        entry["completeness"] = self._completeness(entry, entry["fields"])
        return entry

    def _fields(self, entry_id: str) -> dict:
        rows = self.db.conn.execute(
            "SELECT field, origin, current, modified FROM entry_fields WHERE entry_id = ?",
            (entry_id,),
        ).fetchall()
        return {
            r["field"]: {"origin": r["origin"], "current": r["current"], "modified": bool(r["modified"])}
            for r in rows
        }

    def _items(self, entry_id: str) -> list[dict]:
        rows = self.db.conn.execute(
            "SELECT * FROM items WHERE entry_id = ? ORDER BY ordinal", (entry_id,)
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    def _attachments(self, entry_id: str) -> list[dict]:
        rows = self.db.conn.execute(
            "SELECT * FROM attachments WHERE entry_id = ? ORDER BY added_at", (entry_id,)
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    def history(self, entry_id: str) -> list[dict]:
        rows = self.db.conn.execute(
            "SELECT * FROM field_history WHERE entry_id = ? ORDER BY changed_at, id", (entry_id,)
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    # ------------------------------------------------------------------ 列表 / 筛选
    def list(self, **filters) -> list[dict]:
        """按抬头、报账人、销售方、状态、类别、关键词、金额区间、日期过滤（设计文档 8.8）。"""
        where, params = [], []
        if filters.get("title"):
            where.append("title = ?"); params.append(filters["title"])
        if filters.get("profile_id"):
            where.append("profile_id = ?"); params.append(filters["profile_id"])
        if filters.get("status"):
            where.append("status = ?"); params.append(filters["status"])
        if filters.get("check_status"):
            where.append("check_status = ?"); params.append(filters["check_status"])
        if filters.get("category"):
            where.append("category = ?"); params.append(filters["category"])
        if filters.get("seller"):
            where.append("e.seller LIKE ?"); params.append(f"%{filters['seller']}%")
        if filters.get("keyword"):
            kw = f"%{filters['keyword']}%"
            # 关键词检索覆盖：发票号 / 销售方 / 购买方抬头 / 备注 / 实际物资名称 / 明细名称 / 分类
            where.append("""(
                e.invoice_no LIKE ? OR e.seller LIKE ? OR e.buyer_name LIKE ?
                OR e.category LIKE ?
                OR EXISTS (SELECT 1 FROM entry_fields ef
                           WHERE ef.entry_id = e.id AND ef.field IN ('notes','actual_item_name')
                             AND ef.current LIKE ?)
                OR EXISTS (SELECT 1 FROM items it
                           WHERE it.entry_id = e.id
                             AND (it.name LIKE ? OR it.actual_name LIKE ?))
            )""")
            params += [kw, kw, kw, kw, kw, kw, kw]
        if filters.get("date_from"):
            where.append("e.invoice_date >= ?"); params.append(filters["date_from"])
        if filters.get("date_to"):
            where.append("e.invoice_date <= ?"); params.append(filters["date_to"])
        if filters.get("modified_only"):
            where.append("EXISTS (SELECT 1 FROM entry_fields ef WHERE ef.entry_id = e.id AND ef.modified = 1)")

        sql = "SELECT e.* FROM entries e"
        if where:
            sql += " WHERE " + " AND ".join(where)
        # 排序
        sort = filters.get("sort") or "updated"
        order = {
            "updated": "e.updated_at DESC",
            "created": "e.created_at DESC",
            "amount": "e.total DESC",
            "date": "e.invoice_date DESC",
            "seller": "e.seller ASC",
        }.get(sort, "e.updated_at DESC")
        sql += " ORDER BY " + order
        rows = self.db.conn.execute(sql, params).fetchall()

        result = []
        for r in rows:
            entry = _row_to_dict(r)
            entry["tags"] = json.loads(entry.get("tags") or "[]")
            # 列表视图带上人工修改标记摘要与附件数，供 UI 显示角标
            entry["modified_fields"] = self._modified_fields(entry["id"])
            # 按类型统计附件，供 UI 显示「发票/付款/查验」三个完整度状态点
            type_rows = self.db.conn.execute(
                "SELECT type, COUNT(*) c FROM attachments WHERE entry_id = ? GROUP BY type",
                (entry["id"],),
            ).fetchall()
            by_type = {tr["type"]: tr["c"] for tr in type_rows}
            entry["attachment_count"] = sum(by_type.values())
            entry["attachment_types"] = by_type
            entry["has_invoice"] = bool(by_type.get("invoice_pdf") or by_type.get("invoice_xml"))
            entry["has_payment"] = bool(by_type.get("payment_screenshot"))
            entry["has_inspection"] = bool(by_type.get("inspection_pdf"))
            # 列表附上可改字段当前值（备注 / 实付金额 / 实际物资名），供卡片预览
            ef = self._fields(entry["id"])
            entry["fields"] = ef
            entry["completeness"] = self._completeness(entry, ef)
            result.append(entry)

        # 金额区间在 Python 侧过滤（total 以字符串存 Decimal）
        amt_min = filters.get("amount_min")
        amt_max = filters.get("amount_max")
        if amt_min is not None or amt_max is not None:
            from decimal import Decimal
            def in_range(e):
                try:
                    v = Decimal(e.get("total") or "0")
                except Exception:
                    return False
                if amt_min is not None and v < Decimal(str(amt_min)):
                    return False
                if amt_max is not None and v > Decimal(str(amt_max)):
                    return False
                return True
            result = [e for e in result if in_range(e)]
        return result

    def _modified_fields(self, entry_id: str) -> list[str]:
        rows = self.db.conn.execute(
            "SELECT field FROM entry_fields WHERE entry_id = ? AND modified = 1", (entry_id,)
        ).fetchall()
        return [r["field"] for r in rows]

    @staticmethod
    def _completeness(entry: dict, fields: dict) -> dict:
        """派生「完整度」与状态：发票 + 付款截图 + 查验单三种附件齐、实付已填、校验通过。

        状态自动推导（不再纯手动）：
        - complete：三种材料齐 + 实付已填 + 校验未 blocked。
        - draft：什么材料都还没有。
        - partial：介于两者之间。
        返回 {ready, status, missing:[中文缺项...]}。
        """
        missing = []
        if not entry.get("has_invoice"):
            missing.append("发票")
        if not entry.get("has_payment"):
            missing.append("付款截图")
        if not entry.get("has_inspection"):
            missing.append("查验单")
        paid = (fields.get("paid_amount") or {}).get("current") or ""
        if not str(paid).strip():
            missing.append("实付金额")
        if entry.get("check_status") == "blocked":
            missing.append("校验未通过")
        ready = not missing
        any_material = entry.get("has_invoice") or entry.get("has_payment") or entry.get("has_inspection")
        status = "complete" if ready else ("partial" if any_material else "draft")
        return {"ready": ready, "status": status, "missing": missing}

    # ------------------------------------------------------------------ 可改字段更新
    def update_field(self, entry_id: str, field: str, value: str, profile_id: str = "") -> dict:
        """更新一个可改字段。current != origin 即永久打人工修改标记并写历史。"""
        if field not in EDITABLE_FIELDS:
            raise ValueError(f"字段「{field}」不是可自由修改的字段。")
        row = self.db.conn.execute(
            "SELECT origin, current FROM entry_fields WHERE entry_id = ? AND field = ?",
            (entry_id, field),
        ).fetchone()
        if row is None:
            raise ValueError("条目或字段不存在。")
        old_value = row["current"]
        new_value = str(value) if value is not None else ""
        if new_value == old_value:
            return self._fields(entry_id)
        # 一旦 current != origin 就永久标记（即使之后改回，标记不擦除）
        modified = 1 if new_value != row["origin"] else self._current_modified(entry_id, field)
        self.db.conn.execute(
            "UPDATE entry_fields SET current = ?, modified = ? WHERE entry_id = ? AND field = ?",
            (new_value, modified, entry_id, field),
        )
        self._log_history(entry_id, field, old_value, new_value, profile_id)
        self._touch(entry_id)
        self.db.conn.commit()
        return self._fields(entry_id)

    def _current_modified(self, entry_id: str, field: str) -> int:
        r = self.db.conn.execute(
            "SELECT modified FROM entry_fields WHERE entry_id = ? AND field = ?",
            (entry_id, field),
        ).fetchone()
        return r["modified"] if r else 0

    def correct_locked_field(self, entry_id: str, field: str, value: str, profile_id: str = "") -> dict:
        """对关键信息的『标记为人工修正』特殊流程：更新列值 + 强制留痕（第 6 节、8.5）。"""
        if field not in LOCKED_FIELDS:
            raise ValueError(f"字段「{field}」不属于关键信息修正范围。")
        row = self.db.conn.execute(f"SELECT {field} v FROM entries WHERE id = ?", (entry_id,)).fetchone()
        if row is None:
            raise ValueError("条目不存在。")
        old_value = row["v"] or ""
        new_value = str(value) if value is not None else ""
        if new_value == old_value:
            return self.get(entry_id)
        self.db.conn.execute(f"UPDATE entries SET {field} = ? WHERE id = ?", (new_value, entry_id))
        self._log_history(entry_id, f"[人工修正]{field}", old_value, new_value, profile_id)
        self._touch(entry_id)
        self.db.conn.commit()
        return self.get(entry_id)

    def _log_history(self, entry_id, field, old_value, new_value, profile_id) -> None:
        self.db.conn.execute(
            """INSERT INTO field_history(entry_id, field, old_value, new_value, profile_id, changed_at)
               VALUES(?,?,?,?,?,?)""",
            (entry_id, field, old_value, new_value, profile_id, _now()),
        )

    # ------------------------------------------------------------------ 元数据 / 状态
    def set_status(self, entry_id: str, status: str) -> None:
        if status not in VALID_STATUS:
            raise ValueError(f"非法状态：{status}")
        self.db.conn.execute("UPDATE entries SET status = ? WHERE id = ?", (status, entry_id))
        self._touch(entry_id)
        self.db.conn.commit()

    def recompute_status(self, entry_id: str) -> str:
        """按附件齐全 + 实付已填 + 校验通过自动推导并持久化 status。

        附件或可改字段变化后调用，使列表筛选、导航分区与卡片徽标保持一致。
        """
        entry = self.db.conn.execute(
            "SELECT check_status FROM entries WHERE id = ?", (entry_id,)
        ).fetchone()
        if not entry:
            return ""
        type_rows = self.db.conn.execute(
            "SELECT DISTINCT type FROM attachments WHERE entry_id = ?", (entry_id,)
        ).fetchall()
        types = {r["type"] for r in type_rows}
        stub = {
            "check_status": entry["check_status"],
            "has_invoice": bool({"invoice_pdf", "invoice_xml"} & types),
            "has_payment": "payment_screenshot" in types,
            "has_inspection": "inspection_pdf" in types,
        }
        status = self._completeness(stub, self._fields(entry_id))["status"]
        self.db.conn.execute("UPDATE entries SET status = ? WHERE id = ?", (status, entry_id))
        self.db.conn.commit()
        return status

    def set_check(self, entry_id: str, check_status: str, message: str = "") -> None:
        self.db.conn.execute(
            "UPDATE entries SET check_status = ?, check_message = ? WHERE id = ?",
            (check_status, message, entry_id),
        )
        self._touch(entry_id)
        self.db.conn.commit()

    def set_meta(self, entry_id: str, category: str | None = None, tags: list | None = None) -> None:
        if category is not None:
            self.db.conn.execute("UPDATE entries SET category = ? WHERE id = ?", (category, entry_id))
        if tags is not None:
            self.db.conn.execute(
                "UPDATE entries SET tags = ? WHERE id = ?", (json.dumps(tags, ensure_ascii=False), entry_id)
            )
        self._touch(entry_id)
        self.db.conn.commit()

    def _touch(self, entry_id: str) -> None:
        self.db.conn.execute("UPDATE entries SET updated_at = ? WHERE id = ?", (_now(), entry_id))

    # ------------------------------------------------------------------ 明细行 CRUD
    def add_item(self, entry_id: str, name: str = "", actual_name: str = "",
                 unit: str = "", quantity: str = "", unit_price: str = "",
                 total: str = "", spec: str = "") -> dict:
        """在条目末尾追加一条明细行，返回新行 dict。"""
        max_ord = self.db.conn.execute(
            "SELECT COALESCE(MAX(ordinal), -1) FROM items WHERE entry_id = ?", (entry_id,)
        ).fetchone()[0]
        self.db.conn.execute(
            """INSERT INTO items(entry_id, name, actual_name, unit, quantity,
               unit_price, total, spec, ordinal) VALUES(?,?,?,?,?,?,?,?,?)""",
            (entry_id, name, actual_name, unit, quantity, unit_price, total, spec, max_ord + 1),
        )
        self._touch(entry_id)
        self.db.conn.commit()
        return self._items(entry_id)[-1]

    def update_item(self, item_id: int, fields: dict) -> dict:
        """更新一条明细行的指定字段，返回更新后的行 dict。"""
        allowed = ("name", "actual_name", "unit", "quantity", "unit_price", "total", "spec")
        sets, vals = [], []
        for k, v in fields.items():
            if k in allowed:
                sets.append(f"{k} = ?")
                vals.append(str(v) if v is not None else "")
        if not sets:
            raise ValueError("没有可更新的字段。")
        row = self.db.conn.execute("SELECT entry_id FROM items WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise ValueError("明细行不存在。")
        entry_id = row["entry_id"]
        vals.append(item_id)
        self.db.conn.execute(f"UPDATE items SET {', '.join(sets)} WHERE id = ?", vals)
        self._touch(entry_id)
        self.db.conn.commit()
        updated = self.db.conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        return _row_to_dict(updated)

    def delete_item(self, item_id: int) -> str:
        """删除一条明细行，返回所属 entry_id。"""
        row = self.db.conn.execute("SELECT entry_id FROM items WHERE id = ?", (item_id,)).fetchone()
        if not row:
            raise ValueError("明细行不存在。")
        entry_id = row["entry_id"]
        self.db.conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
        self._touch(entry_id)
        self.db.conn.commit()
        return entry_id

    # ------------------------------------------------------------------ 删除
    def delete(self, entry_id: str) -> None:
        self.db.conn.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
        self.db.conn.commit()

    def delete_many(self, entry_ids: list[str]) -> int:
        if not entry_ids:
            return 0
        placeholders = ",".join("?" * len(entry_ids))
        cur = self.db.conn.execute(f"DELETE FROM entries WHERE id IN ({placeholders})", entry_ids)
        self.db.conn.commit()
        return cur.rowcount
