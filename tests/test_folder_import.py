"""文件夹批量导入的分组启发式测试。"""

from tidoc.services import scan_folder

SAMPLE_DIR = "/Users/poli/invoice2docx/invoices"


def test_scan_folder_groups_by_prefix():
    r = scan_folder(SAMPLE_DIR)
    # 批量导入现在只按发票 PDF 建条目；付款截图/查验单会被跳过，后续手动添加。
    assert r["total_files"] > 0
    assert len(r["groups"]) >= 10

    g26 = next((g for g in r["groups"] if any(f["name"].startswith("26") for f in g["files"])), None)
    assert g26 is not None
    types = {f["type"] for f in g26["files"]}
    assert "invoice_pdf" in types
    assert "payment_screenshot" not in types
    assert "inspection_pdf" not in types


def test_scan_folder_type_classification():
    r = scan_folder(SAMPLE_DIR)
    for g in r["groups"]:
        for f in g["files"]:
            assert f["type"] in {"invoice_pdf", "invoice_xml"}
    assert any("付款" in f["name"] or f["name"].lower().endswith(".jpg") for f in r["ignored"])


def test_scan_folder_accepts_messy_invoice_pdfs_without_xml(tmp_path):
    (tmp_path / "微信保存的文件(1).pdf").write_bytes(b"not a real pdf")
    (tmp_path / "A-77889900.xml").write_text("<bad/>", encoding="utf-8")
    (tmp_path / "付款截图.png").write_bytes(b"img")

    r = scan_folder(tmp_path)
    assert r["invoice_pdf_count"] == 1
    assert len(r["groups"]) == 1
    assert r["groups"][0]["files"][0]["type"] == "invoice_pdf"
    assert r["ungrouped"]
    assert r["ignored"]


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
    # 批量只导发票材料；付款截图 / 查验单之后在详情页手动补。
    for eid in res["entry_ids"]:
        e = api.get_entry(eid)["data"]
        assert e["has_invoice"]
        assert not e["has_payment"]
        assert not e["has_inspection"]
