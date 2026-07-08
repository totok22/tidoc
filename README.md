# tidoc

[![CI](https://github.com/totok22/tidoc/actions/workflows/ci.yml/badge.svg)](https://github.com/totok22/tidoc/actions/workflows/ci.yml)
[![Release](https://github.com/totok22/tidoc/actions/workflows/release.yml/badge.svg)](https://github.com/totok22/tidoc/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> 为 **BITFSAE**（北京理工大学 FSAE 车队）打造的报账凭证管理与整理工具。

tidoc 是一款跨平台桌面程序，帮助车队/社团成员把一次报账所需的发票、付款截图、查验单集中录入、自动识别校验、结构化保存，并生成可在成员之间交换的绑定包；运营组可用可选的打印导出组件，把多人的材料合并成给学校老师审核的纸质件。

- **前端**：PyWebView 原生窗口 + HTML/CSS/JS（双击即开）
- **后端**：Python，本地运行，不监听任何网络端口
- **数据**：SQLite + 本地附件仓库
- **交换**：带 HMAC 签名的 `.tidoc` 绑定包
- **更新**：通过腾讯云 COS 分发核心与可选组件

## 下载与安装

Release 构建由 GitHub Actions 自动打包并上传到车队 COS：

- macOS：下载 `tidoc-core-macos-v{version}.dmg`
- Windows：下载 `tidoc-core-windows-v{version}.exe`

安装后双击运行即可。首次使用请在「身份信息」中维护本人、审核人、学号、银行卡等信息。

> 开发版用户可直接从源码运行，见「开发」节。

## 使用要点

1. 发票 PDF 是创建条目的必要材料；XML 只用于提高识别准确度，不能单独创建条目。
2. 批量导入适合处理一批发票 PDF；付款截图、查验单需要绑定到具体条目。
3. 拖拽到空白列表区会批量导入发票；拖拽到条目卡片会绑定付款截图或查验单。
4. 可用抬头、报账人、批次、状态、日期、金额、标签等条件先筛选，再用“选当前列表 / 选待补 / 选需确认”批量处理。
5. 打印导出是可选组件，需要安装 `requirements-print.txt` 或在设置中从 COS 下载。

## 核心能力

- **发票录入**：单条新建、文件夹批量导入、多选文件导入、拖拽发票 PDF / XML 到主界面导入。
- **本地识别**：优先解析电子发票 XML；没有 XML 时解析 PDF 文本，兼容部分数电发票错位文本流。
- **校验与提示**：金额闭合校验、抬头一致性校验、校验状态与提示信息直接显示在列表。
- **材料整理**：付款截图、查验单可在条目详情添加，也可拖到条目卡片或材料区绑定。
- **防误操作**：同一条目重复附件会被拦截；发票 PDF / XML 拖入已有条目时会核对发票号，避免混入其他发票。
- **条目管理**：搜索、统一筛选、排序、多栏列表、Shift 范围选择、字段修改追踪、材料齐备状态自动计算。
- **批次处理**：把任意条目装入命名批次，像文件夹一样打开、重命名、归档，并可整批汇总、导出、打印。
- **标签与备注筛选**：支持批量添加 / 移除标签，并按标签或有无备注快速定位条目。
- **交换与导出**：`.tidoc` 绑定包导入导出、总览 Excel、附件整理 zip。
- **打印导出**（可选）：发票/付款截图/查验单拼接 PDF、报账说明 / 验收单 Word，按抬头强隔离，支持跨人合并与页面信息标注。
- **联网更新**：检查 COS 上的核心与打印组件更新，下载后校验 SHA256。

> **注意**：阿里云 OCR 识别组件当前未实现，也不在当前计划内。现阶段本地解析（XML + PDF 文本）已能覆盖绝大多数电子发票。

## 开发

```bash
git clone https://github.com/totok22/tidoc.git
cd tidoc
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
pip install -r requirements-print.txt   # 可选：启用打印导出组件

python -m tidoc                    # 启动应用
python -m tidoc --debug            # 打开 WebView 调试
pytest                             # 运行测试
```

## 项目结构

```
tidoc/            核心（必装，只依赖 pywebview + pypdf）
├─ engine/        解析引擎（XML/PDF 解析、金额闭合校验）
├─ db/            数据层（SQLite + 附件仓库、身份、条目、字段修改追踪）
├─ services/      批量导入、汇总、绑定包 .tidoc 导出/导入、HMAC 签名、打印组件适配、联网更新
├─ web/           HTML/CSS/JS 前端
├─ api.py         PyWebView JS↔Python 桥
└─ app.py         应用入口
tidoc_print/      打印导出组件（可选安装，重依赖 docx/pypdf/Pillow/reportlab）
scripts/          构建、版本号注入、打包入口
tests/            pytest 测试
```

## 状态

- [x] 原生窗口骨架与前后端通信
- [x] 数据层与身份管理
- [x] 发票解析引擎（XML / PDF 文本）
- [x] 录入、识别、校验闭环
- [x] 文件夹 / 多选 / 拖拽导入
- [x] 付款截图、查验单绑定与重复防护
- [x] 条目增删改查、筛选搜索、字段修改追踪
- [x] 批次、标签、多栏列表和范围选择
- [x] `.tidoc` 绑定包导出/导入与 HMAC 篡改检测
- [x] 打印导出组件（可选安装、按抬头强隔离、跨人合并、页面信息标注）
- [x] 联网更新（腾讯云 COS）
- [ ] 应用打包与体积优化（CI 已配置，持续完善）
- [ ] ~~阿里云 OCR 识别组件~~（暂缓，不在当前计划内）

设计细节见 [DESIGN.md](DESIGN.md)，更新发布流程见 [docs/UPDATE.md](docs/UPDATE.md)。

## 参与贡献

欢迎提交 Issue 和 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)

## 致谢

- 发票解析与 Word 生成逻辑参考并移植自 `invoice2docx`。
