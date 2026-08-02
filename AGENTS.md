# AGENTS.md

## 项目概览

这是「简辞（Simple Dictionary）」：一个离线、按章节安排学习和复习的英语词汇应用。

- Web 版是功能开发的源代码和默认验证入口。
- Electron 只负责把已构建的 Web 版装进 macOS 窗口并生成 DMG。
- 学习进度、词书、章节计划、学习日历和当前学习会话保存在浏览器 `localStorage`，不依赖登录或网络。
- 用户导入的 TXT/PDF 词书以及处理后的词书文件不能提交到 Git，也不能打包进 DMG。代码内少量示例词和测试词书只用于演示 UI。

## 目录约定

- `app/page.tsx`：主要的客户端学习界面、词书管理、导入、计划、会话和持久化逻辑。目前是单页主入口，修改时优先保持现有类型和状态边界清晰。
- `app/globals.css`：全局布局和组件样式。项目当前不使用 CSS Modules。
- `app/layout.tsx`：页面 metadata、字体和根布局。
- `lib/pdf-import.ts`：文本型 PDF 导入解析。
- `scripts/extract_toefl_pdf.py`：把特定 TOEFL PDF 提取为本项目 TXT 导入格式的辅助脚本。
- `desktop/main.mjs`：Electron 主进程；启动本地 HTTP 服务，加载构建产物，不连接远程服务。
- `desktop/icon.svg`：macOS 应用图标源文件。
- `electron-builder.yml`：DMG 打包配置；当前目标为 Apple Silicon `arm64`。
- `tests/rendered-html.test.mjs`：构建后 HTML 和关键应用逻辑的回归检查。
- `dist/`、`release/`、`.next/`、`.wrangler/`：生成目录，不应手动修改或提交。

## 开发边界和产品规则

### Web 与 DMG

Web 版和 DMG 版使用同一套 `app/`、`lib/` 和配置代码。默认只修改 Web 版并在本地验证；只有用户明确说“同步到 DMG”“打包 DMG”或类似请求时，才执行 Electron 构建。用户明确说“推送 GitHub”时，才执行提交和推送。

打包前不要把用户的词书数据、导出的备份、处理后的 TXT/PDF 或 `localStorage` 快照复制到项目中。DMG 只应包含应用代码和构建产物。

### 学习会话

- 每天按章节计划分为复习旧词和学习新词两个入口。
- “不认识”不会只安排一个未来日期：当前章节/列表中的单词会被放到当前会话队列末尾，继续循环，直到用户答对。
- 复习时考察当天计划选中的整个章节/列表，不因为单词是否在首次学习阶段出现过而过滤掉。
- “认识”从当前队列移除并记录为已掌握；“不认识”记录为待复习，同时保留在当前队列中。
- 退出学习会话必须保留当前模式、当前单词、是否已查看释义、上次回答和队列，重新进入后可以继续。
- 快捷键约定：`←` 不认识，`→` 认识，`Space` 查看释义或进入下一个单词，`Z` 撤销上次选择。编辑框、文本框和下拉控件获得焦点时不要拦截快捷键。

### 章节计划

- 章节计划是唯一的学习/复习安排来源；不要重新引入基于记忆曲线的自动日期算法。
- 每天可以选择多个学习章节和多个复习章节，允许跳着选择章节。
- 每日目标显示为当天计划章节中的单词总量，并据此计算进度和预计完成日期。
- 章节选择、词书切换、词书名称和备注、学习记录都必须按词书隔离保存。

### 词书和导入

TXT 导入格式为每行一个条目，字段顺序如下；例句字段可为空：

```text
[List 01]
summary | [ˈsʌməri] | 总结；概要 | n. | The summary is easy to understand.
species | [ˈspiːʃiːz] | 物种；种类 | n. |

[List 02]
resilient | [rɪˈzɪliənt] | 有韧性的；能迅速恢复的 | adj. |
```

- 章节标题支持 `[List 01]` 形式；字段分隔符为半角 `|`。
- 词条字段为：单词、音标、中文释义、词性、例句（可选）。
- 例句为空时不要渲染例句区域，也不要显示“例句待补充”等占位文案。
- 词性使用 `n.`、`adj.`、`vt.`、`vi.` 等缩写；多个词性/释义应按对应关系分行展示。
- PDF 导入面向可复制文本型 PDF；扫描图片型 PDF 不要假设可以直接识别。
- 删除词书时应同时删除该词书的进度、计划、会话和学习历史；删除前要有明确确认，不能误删当前词书后留下脏状态。

### 界面约定

- 应用名称为“简辞”，英文副标题为 `SIMPLE DICTIONARY`。
- 单词正文使用无衬线字体；词性应靠近对应释义并保持同一水平行，中文释义主体居中。
- 单词序号、无实际作用的“自动保存”、提示卡、无效设置入口等不要重新加入主界面。
- 今日进度和我的单词本固定显示在背词界面下方；侧边栏可以折叠，但折叠按钮应保持轻量的线条镂空样式，不要使用突兀的实心边框。
- 顶部问候语根据北京时间分为早晨、上午、中午、下午、晚上和深夜；深夜应优先提醒休息，而不是鼓励继续学习。
- 颜色保持低对比、柔和；“下一个单词”按钮仍使用深色，但不要使用高对比纯黑。

## 常用命令

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
npm run lint
npm test
npm run build
```

说明：`npm test` 会先运行 `npm run build`，再执行 `tests/rendered-html.test.mjs`。完成 UI 或学习流程修改后，至少运行 `npm run lint` 和 `npm test`；涉及构建配置或 Electron 时再运行 `npm run desktop:dist`。

## PDF/TXT 词书处理

处理已知 TOEFL PDF 时可使用：

```bash
python3 scripts/extract_toefl_pdf.py \
  --input "/path/to/source.pdf" \
  --output "/path/to/output.txt"
```

输出词书应放在项目外部（例如桌面或下载目录），不要放入仓库。若修改解析器，必须检查章节数量、每章词条数量、音标、词性和释义完整性。

## macOS DMG

构建 Apple Silicon DMG：

```bash
npm run desktop:dist
```

产物位于 `release/简辞-*-arm64.dmg`。`electron-builder.yml` 通过 `extraResources` 把 `dist/` 放进应用资源目录，`desktop/main.mjs` 在本地启动服务后加载这些资源。当前没有 Apple Developer 签名，交付时要提醒用户首次打开可能需要 Finder 右键“打开”。

## Git 与 GitHub

开始修改前先确认：

```bash
git status --short --branch
git remote -v
```

遵循以下原则：

- 保留用户已有修改，不使用 `git reset --hard`、`git checkout --` 或广泛删除命令覆盖工作区。
- 提交前运行 `git diff --check`，并根据改动范围运行 lint、测试和构建。
- 提交信息使用简洁的 Conventional Commits 风格，例如 `feat: ...`、`fix: ...`、`docs: ...`。
- 未得到明确请求时，不要自动 push、创建 PR、合并分支、创建 release 或上传 DMG。
- 发布前确认当前分支、远端地址、提交历史和 DMG 产物；不要把 `release/` 或用户词书作为 GitHub 资产之外的仓库文件提交。

## 修改后的交付说明

最终回复应简要说明：改了什么、运行了哪些检查、是否生成了 DMG、是否进行了 GitHub 操作；如果没有执行用户未明确授权的 push/release/DMG 同步，要明确说未执行。
