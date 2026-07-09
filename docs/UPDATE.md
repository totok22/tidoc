# tidoc 联网更新发布说明

更新源使用车队已有腾讯云 COS：

- Bucket：`bitfsae-1416420925`
- 地域：`ap-beijing`
- 公开地址：`https://img.bitfsae.com/tidoc`
- 清单：`https://img.bitfsae.com/tidoc/manifest.json`

CDN 缓存规则：

- `/tidoc/manifest.json` 不缓存
- `zip` / `exe` / `dmg` 缓存 30 天

## 发布

仓库 Secrets 需要存在：

- `TENCENT_SECRET_ID`
- `TENCENT_SECRET_KEY`

打 tag 后推送即可触发：

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions 会并行打包 macOS / Windows，汇总后运行
`scripts/build_manifest.py` 生成 `manifest.json` 和 `upload_plan.tsv`，再用腾讯云官方
`coscli` 上传。发布文件先上传，`manifest.json` 最后上传，避免客户端读到半成品清单。

## COS 路径

```text
tidoc/manifest.json
tidoc/core/windows/tidoc-core-windows-v0.1.1.exe
tidoc/core/macos/tidoc-core-macos-v0.1.1.dmg
tidoc/print/windows/tidoc-print-windows-v0.1.1.exe
tidoc/print/macos/tidoc-print-macos-v0.1.1.zip
```

## 客户端行为

- 设置 -> 软件更新会读取公开 manifest；当前不会在启动时自动联网检查。
- 核心更新会下载并校验安装包，校验通过后打开更新包；未重启前仍显示有更新，但状态会标为“已下载待安装”。
- 打印组件可直接下载安装到本机数据目录的 `components/print/<platform>/` 下。
- 下载 / 安装过程会在设置弹窗里显示进行中状态，组件安装完成后立即刷新状态。
- 客户端不保存腾讯云密钥，只做 HTTPS 下载和 SHA256 完整性校验。
- macOS 上如果应用内 Python/OpenSSL 不能验证系统已信任的证书链，会用系统 `curl` 重试读取清单和下载文件；不会关闭证书校验。
