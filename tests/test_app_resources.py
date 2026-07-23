from pathlib import Path

from tidoc import app


def test_web_dir_prefers_pyinstaller_meipass(monkeypatch, tmp_path):
    bundled = tmp_path / "bundle" / "tidoc" / "web"
    bundled.mkdir(parents=True)
    (bundled / "index.html").write_text("<html></html>", encoding="utf-8")

    monkeypatch.setattr(app.sys, "_MEIPASS", str(tmp_path / "bundle"), raising=False)

    assert app.web_dir() == bundled


def test_web_dir_uses_source_tree_without_bundle(monkeypatch):
    monkeypatch.delattr(app.sys, "_MEIPASS", raising=False)

    assert (app.web_dir() / "index.html").is_file()


def test_loose_material_matching_does_not_reuse_previous_import_scope():
    source = (app.web_dir() / "app.js").read_text("utf-8")
    loose_handler = source.split(
        "async function handleLooseMaterialInfos", 1
    )[1].split("function readFileAsDataURL", 1)[0]

    assert "autoBindMaterialInfos(infos)" in loose_handler
    assert "recentImportedEntryIds" not in source
    assert "autoBindMaterialInfos(pendingMaterialInfos, r.created_entries || [])" in source
