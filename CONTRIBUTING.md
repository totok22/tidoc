# 贡献指南

感谢您对 tidoc 的兴趣！本文档说明如何参与贡献。

## 报告问题

请使用 GitHub Issue，按模板填写环境、复现步骤与期望结果。涉及发票识别问题时，如能附上去敏样例将极大帮助我们定位。

## 开发环境

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
pip install -r requirements-print.txt   # 可选：启用打印导出组件

pytest                             # 运行测试
python -m tidoc                    # 启动应用
```

## 提交改动

1. Fork 本仓库并创建分支。
2. 保持改动最小化，一个 PR 只做一件事。
3. 新增功能请补充测试；修复 bug 请补充回归测试。
4. 确保 `pytest` 通过。
5. 提交清晰的 commit message。
6. 发起 Pull Request 并填写模板。

## 代码风格

- 遵循 PEP 8。
- 使用类型注解。
- 后端 API 统一返回 `{"ok": bool, ...}`，异常不直接抛给前端。

## 发布

由维护者通过 GitHub Actions 触发，推送 tag `v*.*.*` 后自动打包并上传至腾讯云 COS。普通贡献者无需关心。
