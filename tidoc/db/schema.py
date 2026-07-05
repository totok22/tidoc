"""SQLite 表结构（设计文档第 5、6 节）。

- profiles      身份
- entries       报账条目（一张发票为核心）
- entry_fields  可改字段的 origin/current 双值 + 人工修改标记（第 6.2 节）
- field_history 字段级修改历史，不可擦除（第 6.2 节）
- items         物品明细（识别得到，默认只读）
- attachments   附件

关键信息（发票号码、总额、抬头、税号）作为 entries 的列，软件内默认只读；
可改字段（实付金额、实际物资名称、备注等）走 entry_fields 以便留痕。
"""

from __future__ import annotations

import sqlite3

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,          -- 本人姓名（必填，写入导出）
    reviewer    TEXT NOT NULL,          -- 对应审核人（必填，写入导出）
    is_default  INTEGER NOT NULL DEFAULT 0,
    -- 以下供打印导出组件使用（可选）
    student_id  TEXT DEFAULT '',
    contact     TEXT DEFAULT '',
    bank_name   TEXT DEFAULT '',
    bank_card   TEXT DEFAULT '',
    season      TEXT DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id            TEXT PRIMARY KEY,
    profile_id    TEXT NOT NULL,
    title         TEXT NOT NULL DEFAULT '',   -- 抬头，强隔离字段（第 7 节）
    -- 识别得到、默认只读
    invoice_no    TEXT DEFAULT '',
    invoice_date  TEXT DEFAULT '',
    seller        TEXT DEFAULT '',
    total         TEXT DEFAULT '',            -- 价税合计，字符串存 Decimal
    buyer_name    TEXT DEFAULT '',
    buyer_tax_id  TEXT DEFAULT '',
    -- 分类 / 状态
    category      TEXT DEFAULT '',
    tags          TEXT DEFAULT '',            -- JSON 数组字符串
    status        TEXT NOT NULL DEFAULT 'draft',   -- draft/partial/complete
    check_status  TEXT NOT NULL DEFAULT 'warning', -- pass/warning/blocked
    check_message TEXT DEFAULT '',
    source        TEXT DEFAULT '',            -- 数据来源 xml/pdf/xml+pdf/manual
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_entries_profile ON entries(profile_id);
CREATE INDEX IF NOT EXISTS idx_entries_title   ON entries(title);
CREATE INDEX IF NOT EXISTS idx_entries_status  ON entries(status);

-- 可改字段的 origin/current 双值。current != origin 即永久打上人工修改标记。
CREATE TABLE IF NOT EXISTS entry_fields (
    entry_id    TEXT NOT NULL,
    field       TEXT NOT NULL,      -- paid_amount / actual_item_name / notes / ...
    origin      TEXT DEFAULT '',    -- 识别原值
    current     TEXT DEFAULT '',    -- 当前值
    modified    INTEGER NOT NULL DEFAULT 0,  -- 是否被人工改过（永久，不可擦除）
    PRIMARY KEY (entry_id, field),
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

-- 字段级修改历史，不可删除，随条目一起导出（第 6.2 节）
CREATE TABLE IF NOT EXISTS field_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id    TEXT NOT NULL,
    field       TEXT NOT NULL,
    old_value   TEXT DEFAULT '',
    new_value   TEXT DEFAULT '',
    profile_id  TEXT DEFAULT '',    -- 操作身份
    changed_at  TEXT NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_entry ON field_history(entry_id);

CREATE TABLE IF NOT EXISTS items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id      TEXT NOT NULL,
    name          TEXT DEFAULT '',   -- 发票原始物资名称
    actual_name   TEXT DEFAULT '',
    unit          TEXT DEFAULT '',
    quantity      TEXT DEFAULT '',
    unit_price    TEXT DEFAULT '',
    total         TEXT DEFAULT '',
    spec          TEXT DEFAULT '',
    ordinal       INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_items_entry ON items(entry_id);

CREATE TABLE IF NOT EXISTS attachments (
    id            TEXT PRIMARY KEY,
    entry_id      TEXT NOT NULL,
    type          TEXT NOT NULL,     -- invoice_pdf/invoice_xml/payment_screenshot/inspection_pdf/other
    original_name TEXT DEFAULT '',
    stored_path   TEXT DEFAULT '',   -- 相对 attachments/ 的路径
    sha256        TEXT DEFAULT '',
    note          TEXT DEFAULT '',   -- 付款截图可关联实付金额备注
    added_at      TEXT NOT NULL,
    FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_entry ON attachments(entry_id);
"""


def init_db(conn: sqlite3.Connection) -> None:
    """建表并写入 schema 版本。幂等。"""
    conn.executescript(SCHEMA)
    conn.execute(
        "INSERT OR IGNORE INTO meta(key, value) VALUES('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()
