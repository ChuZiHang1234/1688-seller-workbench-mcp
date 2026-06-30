# 1688 Seller Workbench MCP

这是一个用于 Codex 的本地 skill + MCP 服务，用来控制 1688 / 阿里巴巴商家工作台
`work.1688.com`。它通过本机 Chrome 或 Edge 的持久化浏览器配置工作，可以复用登录状态。

## 功能

- 打开 1688 商家工作台。
- 检查登录状态。
- 探测当前页面文字、按钮、链接和输入框。
- 保存页面截图。
- 按可见文本点击页面控件。
- 填写表单输入框。
- 上传本地图片或文件。
- 支持配置每日自动化发布商品流程。
- 通过本地 CDP 端口连接浏览器，让浏览器在多次 MCP 调用之间保持打开。

本项目不会绕过验证码、登录验证、平台审核、风控或反滥用系统。

## 在 Codex 中安装

在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

安装完成后重启 Codex，让 `work1688` MCP 服务加载。

## MCP 工具

- `work1688_status`
- `work1688_open`
- `work1688_check_login`
- `work1688_probe`
- `work1688_screenshot`
- `work1688_click_text`
- `work1688_fill`
- `work1688_upload_files`
- `work1688_press`
- `work1688_close`

## 环境变量

- `WORK1688_BROWSER_EXE`: 自定义 Chrome 或 Edge 路径。
- `WORK1688_PROFILE_DIR`: 持久化浏览器用户数据目录。
- `WORK1688_OUTPUT_DIR`: 截图输出目录。
- `WORK1688_TIMEOUT_MS`: 默认导航和动作超时时间。
- `WORK1688_CDP_PORT`: 本地 CDP 端口，默认 `16888`。

## 安全规则

读取、截图和页面探测可以在登录后直接执行。涉及店铺结果的最终动作，例如发布商品、
修改价格、改库存、发消息、退款、取消订单、开通付费服务等，应先检查页面并得到确认，
再点击最后的提交/发布按钮。
