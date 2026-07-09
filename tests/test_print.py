"""打印导出组件测试：PDF 拼接、图片转 PDF、Word 生成、抬头强隔离。"""

import glob
from decimal import Decimal

import pytest

import tidoc_print

# 组件依赖未装则整体跳过（核心测试不受影响）
pytestmark = pytest.mark.skipif(not tidoc_print.is_available(), reason="打印组件依赖未安装")

SAMPLE_DIR = "/Users/poli/invoice2docx/invoices"


def _sample(pattern):
    files = sorted(glob.glob(f"{SAMPLE_DIR}/{pattern}"))
    if not files:
        pytest.skip(f"无样本：{pattern}")
    return files


def test_availability():
    assert tidoc_print.is_available()
    assert tidoc_print.missing_dependencies() == []


def test_merge_pdfs(tmp_path):
    from tidoc_print.pdf_merge import merge_pdfs
    from pypdf import PdfReader
    pdfs = _sample("*发票.pdf")[:2]
    out = merge_pdfs(pdfs, tmp_path / "merged.pdf")
    assert out.exists()
    assert len(PdfReader(str(out)).pages) >= 2


def test_merge_pdfs_with_annotation(tmp_path):
    from tidoc_print.pdf_merge import merge_pdfs
    pdfs = _sample("*发票.pdf")[:1]
    out = merge_pdfs(pdfs, tmp_path / "annotated.pdf", annotations=["发票号：123   报账人：张三"])
    assert out.exists() and out.stat().st_size > 0


def test_images_to_pdf(tmp_path):
    from tidoc_print.pdf_merge import images_to_pdf
    from pypdf import PdfReader
    imgs = _sample("*付款截图.jpg")[:2]
    out = images_to_pdf(imgs, tmp_path / "pay.pdf", annotations=["实付：¥100"] * len(imgs))
    assert out.exists()
    reader = PdfReader(str(out))
    assert len(reader.pages) == 1
    page = reader.pages[0]
    assert float(page.mediabox.width) > float(page.mediabox.height)


def test_images_to_pdf_two_per_page(tmp_path):
    from tidoc_print.pdf_merge import images_to_pdf
    from pypdf import PdfReader
    imgs = (_sample("*付款截图.jpg") * 2)[:3]
    out = images_to_pdf(imgs, tmp_path / "pay3.pdf", annotations=["No.1-1/3", "No.1-2/3", "No.1-3/3"])
    assert out.exists()
    reader = PdfReader(str(out))
    assert len(reader.pages) == 2
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "Page 1/2" in text


def test_generate_word_docs(tmp_path):
    from tidoc_print import PrintEntry, PrintItem, PersonProfile
    from tidoc_print.word_docs import generate_acceptance_doc, generate_reimburse_doc
    from docx import Document

    entries = [
        PrintEntry(
            entry_id="e1", title="北京理工大学", invoice_no="123",
            seller="某某公司", total=Decimal("100.00"), profile_name="张三",
            items=[PrintItem(actual_name="电阻", unit="个", quantity=Decimal("10"), total=Decimal("100.00"), seller="某某公司", invoice_no="123")],
        ),
    ]
    r = generate_reimburse_doc(entries, tmp_path / "报账说明.docx", "2026年7月5日", PersonProfile(person_name="张三"))
    a = generate_acceptance_doc(entries, tmp_path / "验收单.docx", "2026年7月5日")
    assert r.exists() and a.exists()
    # 报账说明表格里应有数据行
    assert len(Document(str(r)).tables[0].rows) >= 2
    assert len(Document(str(a)).tables[0].rows) >= 2


def test_title_isolation(tmp_path):
    """两个抬头必须分成两套文件，绝不混合（第 7 节）。"""
    from tidoc_print import PrintEntry, PrintItem, build_print_package, PrintOptions

    def mk(title, no):
        return PrintEntry(
            entry_id=no, title=title, invoice_no=no, seller="公司", total=Decimal("50.00"),
            profile_name="张三",
            items=[PrintItem(actual_name="物资", unit="个", quantity=Decimal("1"), total=Decimal("50.00"), invoice_no=no)],
        )

    entries = [mk("北京理工大学", "1"), mk("北京理工大学教育基金会", "2")]
    opts = PrintOptions(make_invoice_pdf=False, make_payment_pdf=False, make_inspection_pdf=False)
    results = build_print_package(entries, tmp_path, opts)
    titles = {r.title for r in results}
    assert titles == {"北京理工大学", "北京理工大学教育基金会"}
    # 两个抬头各自的目录独立
    assert (tmp_path / "北京理工大学").exists()
    assert (tmp_path / "北京理工大学教育基金会").exists()


def test_full_package_with_real_files(tmp_path):
    from tidoc_print import PrintEntry, PrintItem, build_print_package, PrintOptions
    pdf = _sample("*发票.pdf")[0]
    img = _sample("*付款截图.jpg")[0]
    insp = _sample("*查验单.pdf")[0]
    entry = PrintEntry(
        entry_id="e1", title="北京理工大学", invoice_no="123", seller="公司",
        total=Decimal("100.00"), paid_amount="100.00", profile_name="张三",
        items=[PrintItem(actual_name="物资", unit="个", quantity=Decimal("1"), total=Decimal("100.00"), invoice_no="123")],
        invoice_pdfs=[pdf], payment_images=[img], inspection_pdfs=[insp],
    )
    results = build_print_package([entry], tmp_path, PrintOptions())
    assert len(results) == 1
    files = results[0].files
    assert "invoice_pdf" in files and "payment_pdf" in files
    assert "inspection_pdf" in files and "reimburse_doc" in files and "acceptance_doc" in files
    for path in files.values():
        from pathlib import Path
        assert Path(path).exists()
