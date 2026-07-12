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

## 发布到 GitHub Pages

### 1. 准备 GitHub CLI

安装并登录 GitHub CLI：

```powershell
winget install --id GitHub.cli --exact --source winget
gh auth login --web --git-protocol https
gh auth status
```

如果浏览器能访问 GitHub，但 CLI 登录、`clone` 或 `push` 超时，需要为命令行配置代理。本机 v2rayN 示例端口为 `10808`：

```powershell
$env:HTTP_PROXY="socks5://127.0.0.1:10808"
$env:HTTPS_PROXY="socks5://127.0.0.1:10808"
$env:ALL_PROXY="socks5://127.0.0.1:10808"

git config --global http.proxy socks5h://127.0.0.1:10808
git config --global https.proxy socks5h://127.0.0.1:10808
```

代理端口变化时需要同步修改；v2rayN 未启动时 Git 连接会失败。

### 2. 初始化并提交项目

首次发布时，在项目目录执行：

```powershell
git init -b main
git add .
git commit -m "build personal resume and blog site"
```

仓库根目录保留 `.nojekyll`，避免 GitHub Pages 使用 Jekyll 处理静态资源。

### 3. 创建并推送公开仓库

```powershell
gh repo create cdy-site `
  --public `
  --source . `
  --remote origin `
  --push `
  --description "陈德宇的个人简历与技术博客网站"
```

仓库地址为 `https://github.com/CrazyDY/cdy-site`。

### 4. 启用 GitHub Pages

进入仓库的 **Settings → Pages**，在 **Build and deployment** 中选择：

- Source：`Deploy from a branch`
- Branch：`main`
- Folder：`/ (root)`

保存后等待首次构建完成。也可以使用 CLI：

```powershell
gh api --method POST repos/CrazyDY/cdy-site/pages `
  -f "source[branch]=main" `
  -f "source[path]=/"
```

部署地址：[https://crazydy.github.io/cdy-site/](https://crazydy.github.io/cdy-site/)。可在仓库 **Settings → Pages** 或 **Deployments → github-pages** 查看构建状态。

### 5. 发布后续更新

```powershell
git add <修改的文件>
git commit -m "描述本次修改"
git push origin main
```

推送到 `main` 后，GitHub Pages 通常会在几十秒到几分钟内自动更新。若页面仍显示旧内容，确认 Pages 状态为 `built`，然后使用 `Ctrl+F5` 强制刷新。

如需取消 Git 的全局代理：

```powershell
git config --global --unset http.proxy
git config --global --unset https.proxy
```
