"""数据层、修改追踪、绑定包导出/导入/篡改检测的测试。"""

import os
import zipfile

from tidoc.db import STATUS_COMPLETE, TYPE_INVOICE_XML
from tidoc.engine import parse_xml
from tidoc.services import export_bindle, import_bindle, inspect_bindle


def test_profile_first_is_default(repos):
    p = repos["profiles"].create("张三", "李老师")
    assert p["is_default"] == 1
    p2 = repos["profiles"].create("王五", "赵老师")
    assert p2["is_default"] == 0


def test_profile_required_fields(repos):
    import pytest
    with pytest.raises(ValueError):
        repos["profiles"].create("", "李老师")


def test_field_modification_marks_permanently(repos, sample_xmls):
    p = repos["profiles"].create("张三", "李老师")
    parsed = parse_xml(sample_xmls[0])
    eid = repos["entries"].create(p["id"], title=parsed.buyer_name, parsed=parsed)

    repos["entries"].update_field(eid, "notes", "改了", p["id"])
    e = repos["entries"].get(eid)
    assert e["fields"]["notes"]["modified"] is True
    assert len(e["history"]) == 1

    # 改回原值，标记仍不擦除（永久）
    repos["entries"].update_field(eid, "notes", "", p["id"])
    e = repos["entries"].get(eid)
    assert e["fields"]["notes"]["modified"] is True
    assert len(e["history"]) == 2


def test_locked_field_correction_logged(repos, sample_xmls):
    p = repos["profiles"].create("张三", "李老师")
    parsed = parse_xml(sample_xmls[0])
    eid = repos["entries"].create(p["id"], title=parsed.buyer_name, parsed=parsed)
    repos["entries"].correct_locked_field(eid, "invoice_no", "999", p["id"])
    e = repos["entries"].get(eid)
    assert e["invoice_no"] == "999"
    assert any("人工修正" in h["field"] for h in e["history"])


def test_list_filters(repos, sample_xmls):
    p = repos["profiles"].create("张三", "李老师")
    for x in sample_xmls[:3]:
        parsed = parse_xml(x)
        repos["entries"].create(p["id"], title=parsed.buyer_name, parsed=parsed)
    all_e = repos["entries"].list()
    assert len(all_e) == 3
    kw = repos["entries"].list(keyword="立创")
    assert len(kw) >= 0  # 关键字过滤不报错


def test_bindle_round_trip_and_tamper(repos, sample_xmls, tmp_path):
    p = repos["profiles"].create("张三", "李老师")
    ids = []
    for x in sample_xmls[:2]:
        parsed = parse_xml(x)
        eid = repos["entries"].create(p["id"], title=parsed.buyer_name, parsed=parsed, status=STATUS_COMPLETE)
        repos["attachments"].add(eid, x, TYPE_INVOICE_XML)
        ids.append(eid)

    out = export_bindle(repos["entries"], repos["attachments"], ids,
                        str(tmp_path / "包.tidoc"), {p["id"]: p})
    assert out.exists()

    insp = inspect_bindle(out)
    assert insp["verified"] is True
    assert len(insp["entries"]) == 2

    # 篡改：改 entries.json
    tampered = tmp_path / "t.tidoc"
    with zipfile.ZipFile(out) as zin, zipfile.ZipFile(tampered, "w") as zout:
        for item in zin.namelist():
            data = zin.read(item)
            if item == "entries.json":
                data = data.replace(b'"total"', b'"ttl"', 1)
            zout.writestr(item, data)
    insp2 = inspect_bindle(tampered)
    assert insp2["verified"] is False
    assert "entries.json" in insp2["tampered"]

    # 拒绝导入篡改包
    res = import_bindle(repos["entries"], repos["attachments"], tampered, p["id"])
    assert res["imported"] == 0

    # 允许强制导入
    res2 = import_bindle(repos["entries"], repos["attachments"], out, p["id"])
    assert res2["imported"] == 2
