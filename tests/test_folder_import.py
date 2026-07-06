"""文件夹批量导入的分组启发式测试。"""

from tidoc.services import scan_folder

SAMPLE_DIR = "/Users/poli/invoice2docx/invoices"


def test_scan_folder_groups_by_prefix():
    r = scan_folder(SAMPLE_DIR)
    # 样本目录里 26~37、71 每组有 发票/付款截图/查验单 三个文件
    assert r["total_files"] > 0
    assert len(r["groups"]) >= 10

    # 找到 26 组，校验三类齐全且类型判定正确
    g26 = next((g for g in r["groups"] if g["label"] == "26"), None)
    assert g26 is not None
    types = {f["type"] for f in g26["files"]}
    assert "invoice_pdf" in types
    assert "payment_screenshot" in types
    assert "inspection_pdf" in types


def test_scan_folder_type_classification():
    r = scan_folder(SAMPLE_DIR)
    for g in r["groups"]:
        for f in g["files"]:
            if "查验单" in f["name"]:
                assert f["type"] == "inspection_pdf"
            elif "付款截图" in f["name"] or f["name"].lower().endswith(".jpg"):
                assert f["type"] == "payment_screenshot"
            elif "发票" in f["name"] and f["name"].lower().endswith(".pdf"):
                assert f["type"] == "invoice_pdf"


def test_batch_create_entries(api):
    from tidoc.services import scan_folder as sf
    p = api.create_profile("张三", "李老师")["data"]
    scan = sf(SAMPLE_DIR)
    # 取前两组做批量创建
    groups = [{"label": g["label"],
               "files": [{"path": f["path"], "type": f["type"]} for f in g["files"]]}
              for g in scan["groups"][:2]]
    res = api.batch_create_entries(p["id"], groups)["data"]
    assert res["created"] == 2
    assert not res["failed"]
    # 每条应带上三类附件
    for eid in res["entry_ids"]:
        e = api.get_entry(eid)["data"]
        assert e["has_invoice"]
        assert e["has_payment"]
        assert e["has_inspection"]
