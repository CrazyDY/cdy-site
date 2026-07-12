# 陈德宇个人网站

零依赖的静态个人网站，包含个人主页、可在线编辑和多格式导出的简历，以及支持 Markdown 的博客管理模块。

## 本地运行

直接打开 `index.html` 即可，或在当前目录启动静态服务器：

```powershell
python -m http.server 8080
```

然后访问 `http://localhost:8080`。

简历修改和博客文章保存在浏览器 `localStorage` 中。HTML 与 Markdown 导出会直接下载；PDF 导出调用浏览器打印窗口，请选择“另存为 PDF”。静态部署时无需构建步骤。
