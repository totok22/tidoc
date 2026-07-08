"""批次仓库、标签/备注筛选维度、schema 迁移的测试。"""

import sqlite3

import pytest

from tidoc.db import Database
from tidoc.db.batches import BatchRepo
from tidoc.engine import parse_xml


def _make_entries(repos, sample_xmls, n=3, profile=None):
    p = profile or repos["profiles"].create("张三", "李老师")
    ids = []
    for x in sample_xmls[:n]:
        parsed = parse_xml(x)
        ids.append(repos["entries"].create(p["id"], title=parsed.buyer_name, parsed=parsed))
    return p, ids


# ------------------------------------------------------------------ 批次

def test_batch_create_and_add_entries(repos, sample_xmls):
    _, ids = _make_entries(repos, sample_xmls, 3)
    b = repos["batches"].create("第一批", entry_ids=ids[:2])
    assert b["count"] == 2
    added = repos["batches"].add_entries(b["id"], [ids[2]])
    assert added == 1
    # 重复装入不增加
    assert repos["batches"].add_entries(b["id"], [ids[2]]) == 0
    assert repos["batches"].get(b["id"])["count"] == 3


def test_batch_remove_and_delete_keeps_entries(repos, sample_xmls):
    _, ids = _make_entries(repos, sample_xmls, 2)
    b = repos["batches"].create("批次", entry_ids=ids)
    repos["batches"].remove_entries(b["id"], [ids[0]])
    assert repos["batches"].get(b["id"])["count"] == 1
    repos["batches"].delete(b["id"])
    assert repos["batches"].get(b["id"]) is None
    # 删批次不删条目
    assert len(repos["entries"].list()) == 2


def test_batch_entry_note(repos, sample_xmls):
    _, ids = _make_entries(repos, sample_xmls, 1)
    b = repos["batches"].create("批次")
    repos["batches"].set_entry_note(b["id"], ids[0], "缺查验单")
    got = repos["batches"].get(b["id"])
    assert got["entry_notes"][ids[0]] == "缺查验单"
    assert got["count"] == 1  # 设备注会自动装入


def test_batch_delete_cascades_when_entry_deleted(repos, sample_xmls):
    _, ids = _make_entries(repos, sample_xmls, 2)
    b = repos["batches"].create("批次", entry_ids=ids)
    repos["entries"].delete(ids[0])
    # 条目删除后，批次关联应被外键级联清理
    assert repos["batches"].get(b["id"])["count"] == 1


def test_batch_stats_by_person(repos, sample_xmls):
    p1 = repos["profiles"].create("张三", "李老师")
    p2 = repos["profiles"].create("王五", "赵老师")
    _, ids1 = _make_entries(repos, sample_xmls, 2, profile=p1)
    _, ids2 = _make_entries(repos, sample_xmls, 1, profile=p2)
    b = repos["batches"].create("混合批", entry_ids=ids1 + ids2)
    stats = repos["batches"].get(b["id"])["stats"]
    assert stats["count"] == 3
    names = {row["name"] for row in stats["by_person"]}
    assert names == {"张三", "王五"}


def test_batch_archive_excluded_from_list(repos, sample_xmls):
    repos["batches"].create("活跃批")
    b2 = repos["batches"].create("已交批")
    repos["batches"].set_archived(b2["id"], True)
    active = repos["batches"].list()
    assert all(not x["archived"] for x in active)
    assert len(active) == 1
    assert len(repos["batches"].list(include_archived=True)) == 2


def test_batches_of_entry(repos, sample_xmls):
    _, ids = _make_entries(repos, sample_xmls, 1)
    b1 = repos["batches"].create("批一", entry_ids=ids)
    b2 = repos["batches"].create("批二", entry_ids=ids)
    names = {x["name"] for x in repos["batches"].batches_of_entry(ids[0])}
    assert names == {"批一", "批二"}


# ------------------------------------------------------------------ 标签

def test_tag_add_remove_and_filter(repos, sample_xmls):
    _, ids = _make_entries(repos, sample_xmls, 3)
    changed = repos["entries"].add_tag(ids[:2], "待催办")
    assert changed == 2
    # 重复打标不改动
    assert repos["entries"].add_tag(ids[:2], "待催办") == 0
    tagged = repos["entries"].list(tags=["待催办"])
    assert len(tagged) == 2
    repos["entries"].remove_tag([ids[0]], "待催办")
    assert len(repos["entries"].list(tags="待催办")) == 1
    assert "待催办" in repos["entries"].all_tags()


# ------------------------------------------------------------------ 备注筛选

def test_has_notes_filter(repos, sample_xmls):
    p, ids = _make_entries(repos, sample_xmls, 3)
    repos["entries"].update_field(ids[0], "notes", "有备注的一条", p["id"])
    with_notes = repos["entries"].list(has_notes=True)
    without_notes = repos["entries"].list(has_notes=False)
    assert len(with_notes) == 1
    assert len(without_notes) == 2


def test_batch_filter_on_entries(repos, sample_xmls):
    _, ids = _make_entries(repos, sample_xmls, 3)
    b = repos["batches"].create("批", entry_ids=ids[:1])
    inside = repos["entries"].list(batch_id=b["id"])
    outside = repos["entries"].list(not_in_batch_id=b["id"])
    assert len(inside) == 1
    assert len(outside) == 2


# ------------------------------------------------------------------ 迁移

def test_v1_db_upgrades_to_v2(tmp_path):
    """模拟一个只有 v1 表的旧库，打开后应补齐批次表并抬升版本号。"""
    db_path = tmp_path / "old.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE entries (id TEXT PRIMARY KEY, profile_id TEXT, title TEXT,
            invoice_no TEXT, invoice_date TEXT, seller TEXT, total TEXT,
            buyer_name TEXT, buyer_tax_id TEXT, category TEXT, tags TEXT,
            status TEXT, check_status TEXT, check_message TEXT, source TEXT,
            created_at TEXT, updated_at TEXT);
        INSERT INTO meta(key, value) VALUES('schema_version', '1');
        """
    )
    conn.commit()
    conn.close()

    db = Database(db_path)  # init_db 应升级
    ver = db.conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0]
    assert ver == "2"
    # 批次表可用
    repo = BatchRepo(db)
    b = repo.create("迁移后批次")
    assert b["count"] == 0


# ------------------------------------------------------------------ 数据目录迁移

def test_migrate_data_root_moves_files(tmp_path, sample_xmls):
    from tidoc.db import DataRoot, Database, EntryRepo, ProfileRepo

    old = tmp_path / "old"
    root = DataRoot(old)
    db = Database(root.db_path)
    profiles, entries = ProfileRepo(db), EntryRepo(db)
    p = profiles.create("张三", "李老师")
    parsed = parse_xml(sample_xmls[0])
    entries.create(p["id"], title=parsed.buyer_name, parsed=parsed)
    db.close()

    new = tmp_path / "new"
    returned = root.migrate_to(new)
    assert str(returned) == str(new)
    assert (new / "tidoc.sqlite").exists()
    assert not (old / "tidoc.sqlite").exists()

    # 新位置数据完整
    db2 = Database(new / "tidoc.sqlite")
    assert len(ProfileRepo(db2).list()) == 1
    assert len(EntryRepo(db2).list()) == 1


def test_migrate_refuses_nonempty_target(tmp_path):
    from tidoc.db import DataRoot

    root = DataRoot(tmp_path / "old")
    target = tmp_path / "busy"
    target.mkdir()
    (target / "somefile").write_text("x")
    with pytest.raises(ValueError):
        root.migrate_to(target)
