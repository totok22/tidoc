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
