"""文件夹批量导入的分组启发式测试。"""

from pathlib import Path

import pytest

from tidoc.services import scan_files, scan_folder
from tidoc.engine import parse_pdf

SAMPLE_DIR = Path("/Users/poli/invoice2docx/invoices")
requires_sample_data = pytest.mark.skipif(
    not SAMPLE_DIR.is_dir(),
    reason="本地发票样本目录不存在",
)


@requires_sample_data
def test_scan_folder_groups_by_prefix():
    r = scan_folder(SAMPLE_DIR)
    # 批量导入按发票 PDF 建条目；付款截图/查验单不靠命名自动绑定。
    assert r["total_files"] > 0
    assert len(r["groups"]) >= 10

    g26 = next((g for g in r["groups"] if any(f["name"].startswith("26") for f in g["files"])), None)
    assert g26 is not None
    types = {f["type"] for f in g26["files"]}
    assert "invoice_pdf" in types
    assert "payment_screenshot" not in types
    assert "inspection_pdf" not in types


@requires_sample_data
def test_scan_folder_type_classification():
    r = scan_folder(SAMPLE_DIR)
    for g in r["groups"]:
        for f in g["files"]:
            assert f["type"] in {"invoice_pdf", "invoice_xml"}
    assert any(f["type"] == "payment_screenshot" for f in r["ignored"])
    assert any(f["type"] == "inspection_pdf" for f in r["ignored"])
    assert r["matched_xml_count"] > 0


@requires_sample_data
def test_scan_files_accepts_multi_selected_invoice_files():
    paths = [
        f"{SAMPLE_DIR}/28+电子元件+390.05+发票.pdf",
        f"{SAMPLE_DIR}/20260425205440942/立创商城发票-7556653A-26957000000103383672.xml",
    ]
    r = scan_files(paths)
    assert r["invoice_pdf_count"] == 1
    assert r["matched_xml_count"] == 1
    assert len(r["groups"]) == 1
    assert {f["type"] for f in r["groups"][0]["files"]} == {"invoice_pdf", "invoice_xml"}


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


@requires_sample_data
def test_known_messy_sample_pdfs_parse_core_fields():
    samples = [
        ("26+稳压电源+128.62+发票.pdf", "深圳市驿生胜利科技有限公司", "直流稳压电源"),
        ("27+pc耗材+200.13+发票.pdf", "深圳拓竹科技有限公司", "3D打印机线材"),
        ("26332000004713530326-北京理工大学教育基金会.pdf", "杭州深度求索人工智能基础技术研究有限公司", "技术服务"),
        ("71+排插+107+发票.pdf", "北京京东金禾贸易有限公司", "公牛"),
    ]
    for filename, seller, item_keyword in samples:
        inv = parse_pdf(f"{SAMPLE_DIR}/{filename}")
        assert inv.invoice_no
        assert inv.buyer_name == "北京理工大学教育基金会"
        assert inv.seller == seller
        assert inv.items
        assert item_keyword in inv.items[0].actual_name


@requires_sample_data
def test_batch_create_entries(api):
    from tidoc.services import scan_folder as sf
    p = api.create_profile("张三", "李老师")["data"]
    scan = sf(SAMPLE_DIR)
    # 取前两组做批量创建
    picked = scan["groups"][:2]
    groups = [{"label": g["label"],
               "files": [{"path": f["path"], "type": f["type"]} for f in g["files"]]}
              for g in picked]
    res = api.batch_create_entries(p["id"], groups)["data"]
    assert res["created"] == 2
    assert not res["failed"]
    for eid in res["entry_ids"]:
        e = api.get_entry(eid)["data"]
        assert e["has_invoice"]
        assert not e["has_payment"]
        assert not e["has_inspection"]
