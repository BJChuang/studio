# 桃花岛创作台 · 独立静态展示版

从 `codex/creation-studio-dev` 的创作台页面抽离，来源提交 `04bab5260`。保留原来的界面、模板、编辑流程和全部本地素材。页面入口直接打开创作台，无需主站登录。

本项目使用原生 HTML / CSS / JavaScript，无 Vue、主站 workspace 包、CDN 或第三方 npm 依赖。`provenance.json` 记录来源，`src/generated/sourceManifest.json` 保留原始清单与散列。

## 本地打开

需要 Node.js 20 或以上，不需要 `npm install`：

```powershell
cd E:\workSpace\kepler\studio
npm start
```

浏览器访问 <http://localhost:5300>。如端口被占用，可运行 `npm start -- --port 5301`。局域网展示可使用 `npm start -- --host 0.0.0.0`。

页面使用 ES 模块和本地存储，需要通过 HTTP 服务访问，不能双击 `index.html` 以 `file://` 打开。Node 仅用于本地提供文件，部署后的页面无需 Node 或应用后端。

## 展示范围

- 模板浏览与采用、核心设定、世界书、画布与属性、变量与事件、角色与素材库、创作指南。
- 实时预览、独立运行窗口、本地保存恢复、JSON 备份导入导出。
- 桌面与手机原有布局，1,584 个图片、字体和音视频资源均在本目录内。

AI、模型生成和平台接口在展示版中不发起服务请求，相关操作沿用界面错误提示并说明静态版未连接服务。发布沿用原型的本地记录行为，不会上架平台。独立运行中的模型对话也需要真实服务，本项目不包含这类服务。

草稿存储在当前浏览器的 IndexedDB / localStorage 中，不会自动读取主站域名或端口下的草稿。更换设备、浏览器或清理站点数据前，请先导出备份。

## 构建与部署

```powershell
npm run build
npm run preview
```

`build` 校验原始脚本、DOM 模块及全部素材的 SHA-256，检查 JavaScript 语法，然后生成 `dist/`。`preview` 提供构建产物预览；如开发服务仍在运行，使用 `npm run preview -- --port 5301`。

生产构建会将启动程序预压缩并拆成不超过 256 KiB 的下载块，并合并小型启动脚本以减少串行请求。页面显示下载进度，每块失败时最多尝试 3 次；单次请求 20 秒超时，整体下载 90 秒超时后提供“重新打开”。每块和解压后的程序均验证 SHA-256。支持 DecompressionStream 的浏览器使用分块下载，其他浏览器保留标准 ES 模块加载；原始脚本和冻结的预览程序不进行压缩改写。此处的预压缩仅指 gzip 传输压缩。

可运行 `npm test` 验证分块重组、部分下载中断、损坏数据、超时和取消。GitHub Actions 在构建前也会执行这组测试。网络仍需能访问 GitHub Pages，本项目不内置第三方镜像。

将 **dist 目录中的全部内容** 上传到静态服务器。默认构建适用于站点根目录；若部署到 `/studio/` 子目录，使用 `npm run build -- --base /studio/`。构建只在 dist 副本中调整素材地址，原始源码与散列清单保持不变。`npm run preview` 自动读取本次构建的路径，并打印正确的预览地址。

无需在服务器上运行 `npm start`，也无需 API 反向代理、登录服务或 SPA 路由回退。服务器应将 `.js` 作为 JavaScript 提供，并允许原型的内联样式与 sandbox iframe 脚本。

## 上传到 GitHub Pages

项目已附带 `.github/workflows/deploy-pages.yml`。将本目录的源码上传到独立 GitHub 仓库后，GitHub Actions 会校验、构建并发布 `dist`，自动读取 Pages 的仓库路径。源码根目录应直接包含 `index.html`、`package.json` 和 `.github`，不要再套一层 studio 文件夹。无需上传 dist，也无需 npm install。

1. 在 GitHub 创建空仓库，例如 `studio`。创建时先不添加 README、.gitignore 或 License，以免产生远程初始提交。
2. 在 PowerShell 执行以下命令，将 `YOUR_USERNAME` 和仓库名替换为实际值：

   ```powershell
   cd E:\workSpace\kepler\studio
   git init -b main
   git add .
   git commit -m "Add standalone studio presentation"
   git remote add origin https://github.com/YOUR_USERNAME/studio.git
   git push -u origin main
   ```

3. 打开该 GitHub 仓库的 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
4. 打开 **Actions → Deploy studio to GitHub Pages → Run workflow → main → Run workflow**。首次 push 时若 Pages 尚未启用，工作流可能失败；完成第 3 步后重新运行即可。
5. 等待 build 和 deploy 成功，在 **Settings → Pages** 或本次 Actions 部署结果中打开网站。普通项目仓库的地址通常为 `https://YOUR_USERNAME.github.io/studio/`，以 GitHub 返回的地址为准。

后续修改只需提交并 push 到 main，会自动更新。无需手动修改素材路径、填写 Token 或在自己的电脑上保持 npm start 运行。

GitHub Free 可使用公开仓库的 Pages，私有仓库是否支持取决于账户计划；请按仓库内容的可见性需求选择。项目包含约 108 MB、1,584 个素材，建议通过 Git 命令上传。

官方说明：[配置 Pages 发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)、[使用 Actions 部署 Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 目录

```text
index.html                   独立页面入口
src/main.js                  页面挂载与静态展示模式
src/moduleLoader.js          带进度、校验、超时与重试的启动下载器
src/shell.css                独立加载界面
src/prototypeSurface.js      原生 DOM / 事件 / 预览适配层
src/generated/               原型脚本、DOM、来源清单与冻结的子页面程序
creator-prototype/assets/    全量本地素材
scripts/serve.mjs            零依赖静态文件服务
scripts/check.mjs            来源完整性与语法校验
scripts/build.mjs            输出可直接托管的 dist
scripts/moduleLoader.test.mjs 下载器回归测试
docs/creator-prototype-comparison.md  上游功能对照文档（保留原记录，非本次验收结果）
provenance.json              抽离来源
```

修改页面装载逻辑可编辑 `src/main.js`，修改展示外壳可编辑 `src/shell.css`。`src/generated/` 保留上游内容；若修改其中脚本或素材，需要同步维护其来源清单。原始脚本内保留第三方许可证说明。

## 本次验证（2026-10-27）

- `npm run build` 通过：原型脚本和 DOM 模块与上游散列一致，全部 1,584 个素材（108,214,308 字节）逐个校验通过，JavaScript 语法检查通过。
- 构建产物 HTTP 检查通过：入口、独立运行查询地址、JavaScript MIME、本地媒体地址正常；不存在的 API 返回 404，POST 返回 405。
- 浏览器中验证：无需登录打开模板页、采用渡魂谣、保存、刷新后恢复、手动进入画布、切换实时预览与开场引导、通过新窗口运行作品；主编辑页面控制台未见警告或错误。
- Pages 适配验证：站点根路径和 `/studio/` 两种构建通过；在本地 `/studio/` 模拟地址打开模板、画布、开场预览与新窗口运行，素材路径包含仓库前缀且图片加载正常。未向真实 GitHub 仓库上传，也尚未实际发布到 Pages。

以上不代表对全部原型功能逐项验收；本次未调用真实 AI 服务或执行平台发布。
