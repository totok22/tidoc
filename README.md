# 理票 · Tidoc

报账凭证管理与整理工具。Mac / Windows 通用桌面程序。

帮个人把一次报账所需的发票、付款截图、查验单集中录入、自动识别校验、结构化保存，并生成可在成员之间交换的绑定包；运营组用可选的打印导出组件，把多人的材料合并成给学校老师审核的纸质件。

- 前端：PyWebView 原生窗口 + HTML（双击即开）
- 后端：Python，移植自参考仓库 `invoice2docx` 的解析引擎
- 数据：SQLite + 附件文件仓库
- 状态：核心开发中（导入、整理、交换、打印导出主流程已跑通）

详见 [DESIGN.md](DESIGN.md)。

## 当前能力

- 发票导入：支持单条新建、文件夹批量导入、多选发票文件，以及拖拽发票 PDF / XML 到主界面导入。
- 自动识别：优先使用电子发票 XML；没有 XML 时解析 PDF 文本，兼容部分数电发票错位文本流。
- 材料整理：付款截图、查验单可在条目详情添加，也可拖到条目卡片或材料区绑定。
- 防误操作：同一条目重复附件会被拦截；发票 PDF / XML 拖入条目时会核对发票号，避免混入其他发票。
- 条目管理：支持搜索、筛选、排序、精简列表、批量选择、字段修改追踪和材料齐备状态。
- 交换与导出：支持绑定包 `.tidoc` 导入导出、总览 Excel、附件整理包和可选打印导出组件。

## 使用要点

1. 首次使用先在“身份信息”里维护本人、审核人、学号和银行卡等信息。
2. 发票 PDF 是创建条目的必要材料；XML 只用于提高识别准确度，不能单独创建条目。
3. 批量导入适合处理一批发票 PDF；付款截图、查验单需要绑定到具体条目。
4. 拖拽到空白列表区会导入发票；拖拽到条目卡片会绑定付款截图或查验单。
5. 打印导出是可选组件，需要安装 `requirements-print.txt` 后启用。

## 开发

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
pip install -r requirements-print.txt   # 可选：启用打印导出组件

python -m tidoc                    # 启动应用（双击体验的开发等价物）
python -m tidoc --debug            # 打开 WebView 调试
pytest                             # 运行测试
```

## 目录结构

```
tidoc/            核心（必装，只依赖 pywebview + pypdf）
├─ engine/        解析引擎（XML/PDF 解析、金额闭合校验，移植自 invoice2docx）
├─ db/            数据层（SQLite + 附件仓库、身份、条目、字段修改追踪）
├─ services/      批量导入、汇总、绑定包 .tidoc 导出/导入、HMAC 签名、打印组件适配
├─ web/           HTML/CSS/JS 前端
├─ api.py         PyWebView JS↔Python 桥
└─ app.py         应用入口
tidoc_print/      打印导出组件（可选安装，重依赖 docx/pypdf/Pillow/reportlab）
├─ pdf_merge.py   发票/查验单 PDF 拼接、付款截图转 PDF、页面信息标注
├─ word_docs.py   报账说明 / 验收单 Word 生成（移植自 engine.py）
├─ builder.py     按抬头强隔离的打印件编排
└─ templates/     Word 模板
```

## 已完成 / 待做

已跑通（阶段 1–8）：原生窗口骨架、数据层与身份、解析引擎与录入/识别/校验、
文件夹/多选/拖拽导入、材料绑定与重复防护、条目增删改查与筛选搜索、
字段级修改追踪（不可擦除）、绑定包导出/导入与 HMAC 篡改检测、
打印导出组件（可选安装、按抬头强隔离、跨人合并、页面信息标注）。

待做（阶段 9–10）：OCR 识别组件（可选安装，用户自填阿里云 Key，四档触发）、
COS 联网更新、打包（Mac/Win）与体积优化。
