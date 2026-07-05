# 理票 · Tidoc

报账凭证管理与整理工具。Mac / Windows 通用桌面程序。

帮个人把一次报账所需的发票、付款截图、查验单集中录入、自动识别校验、结构化保存，并生成可在成员之间交换的绑定包；运营组用可选的打印导出组件，把多人的材料合并成给学校老师审核的纸质件。

- 前端：PyWebView 原生窗口 + HTML（双击即开）
- 后端：Python，移植自参考仓库 `invoice2docx` 的解析引擎
- 数据：SQLite + 附件文件仓库
- 状态：核心开发中（设计文档第 12 节阶段 1–6 已跑通）

详见 [DESIGN.md](DESIGN.md)。

## 开发

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt

python -m tidoc                    # 启动应用（双击体验的开发等价物）
python -m tidoc --debug            # 打开 WebView 调试
pytest                             # 运行测试
```

## 目录结构

```
tidoc/
├─ engine/     解析引擎（XML/PDF 解析、金额闭合校验，移植自 invoice2docx）
├─ db/         数据层（SQLite + 附件仓库、身份、条目、字段修改追踪）
├─ services/   汇总、绑定包 .tidoc 导出/导入、HMAC 签名
├─ web/        HTML/CSS/JS 前端
├─ api.py      PyWebView JS↔Python 桥
└─ app.py      应用入口
```

## 已完成 / 待做

已跑通（阶段 1–6）：原生窗口骨架、数据层与身份、解析引擎与录入/识别/校验、
条目增删改查与筛选搜索、字段级修改追踪（不可擦除）、绑定包导出/导入与 HMAC 篡改检测。

待做（阶段 7–9）：COS 联网更新、打印导出组件（可选安装、跨人合并、页面信息标注）、
打包（Mac/Win）与体积优化。
