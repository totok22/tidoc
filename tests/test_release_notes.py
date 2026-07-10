from scripts.release_notes import bullet_notes, newest_changelog_section


def test_extracts_newest_changelog_bullets():
    text = """# Changelog

## 2026-07-10

### Added

- 新增自动检查
- 新增更新说明

## 2026-07-09

- 旧内容
"""
    section = newest_changelog_section(text)
    assert "旧内容" not in section
    assert bullet_notes(section) == ["新增自动检查", "新增更新说明"]
