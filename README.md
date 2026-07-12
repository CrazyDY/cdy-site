# 陈德宇个人网站

零依赖的静态个人网站，包含个人主页、可在线编辑和多格式导出的简历，以及支持 Markdown 的博客管理模块。

## 本地运行

直接打开 `index.html` 即可，或在当前目录启动静态服务器：

```powershell
python -m http.server 8080
```

然后访问 `http://localhost:8080`。

简历修改保存在浏览器 `localStorage` 中。HTML 与 Markdown 导出会直接下载；PDF 导出调用浏览器打印窗口，请选择“另存为 PDF”。静态部署时无需构建步骤。

## 博客管理

博客文章存放在 `posts/*.md`，文章清单位于 `posts/index.json`。网站没有公开的写入接口；只有拥有仓库写权限的 GitHub 账号可以新增、修改或删除文章。

发布文章时：

1. 在 `posts/` 新建 Markdown 文件。
2. 在 `posts/index.json` 添加对应的 `slug`、文件名、标题、摘要、日期和标签。
3. 提交并推送到 `main`，GitHub Pages 会自动更新。
