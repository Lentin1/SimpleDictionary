# 简辞 Simple Dictionary

简辞是一款离线、按章节学习与复习的英语词汇应用。它把“今天学什么、复习什么”交给明确的章节计划，让每次学习都保持简单、可控，并把学习记录保存在本机。

## 功能亮点

- 按章节制定学习计划：每天可选择多个新词章节和多个复习章节，也可以跳着安排章节。
- 跨日任务：可以提前完成明天的复习与新词，也可以补做昨天遗漏的任务并补打卡。
- 双模式学习：可分别进入所选日期的复习章节和新词章节，两个队列按日期独立记录。
- 词卡学习：先回忆单词，再查看音标、词性和完整中文释义；多词性释义会在不丢失原文的前提下拆行显示。
- AI 单词助教：答题后可在右侧栏针对当前词继续提问，支持配置云端或本机的 OpenAI-compatible LLM API。
- 学习记录持久化：今日进度、已掌握、待复习、词书切换和打卡记录均保存在本地；macOS 版使用独立数据文件，更新应用不会覆盖进度。
- 词书管理：支持导入、查看、切换、重命名和删除多套词书。
- TXT / PDF 导入：支持音标；文本型 PDF 可直接识别章节、单词、音标、词性和释义。
- 本地备份：可以导出包含词书和学习记录的 JSON 归档；当前 Tauri 界面尚未提供 JSON 恢复入口。
- 快捷键：`←` 不认识，`→` 认识，`Space` 查看释义或进入下一个单词，`Z` 撤销上次选择。
- 学习日历：提供月、周、日视图，日视图展示按小时统计的学习曲线。

## 使用方式

1. 在「我的词书」中导入自己的 TXT 或文本型 PDF。
2. 在「今日学习」中查看打卡日历和当天章节计划。
3. 按当天计划分别进入复习章节或新词章节；也可以补做昨天、提前完成明天的任务。
4. 对每个单词选择「认识」或「不认识」；“不认识”的词会移到本轮队尾，直到答对才移出队列。
5. 完成今日计划后打卡；需要留档时导出本地 JSON 备份。

## TXT 导入格式

每个章节使用一个标题，每行一个单词。字段顺序为：

```text
[List 01]
summary | [ˈsʌməri] | 总结；概要 | n. | The summary is easy to understand.
species | [ˈspiːʃiːz] | 物种；种类 | n. |

[List 02]
resilient | [rɪˈzɪliənt] | 有韧性的；能迅速恢复的 | adj. |
```

说明：

- 格式为：`单词 | 音标 | 中文释义 | 词性 | 例句（可选）`。
- 例句字段会随导入写入本地词书，并作为 AI 助教的上下文；当前 Tauri 学习卡尚未单独展示例句。
- 词性可以写成 `n.`、`adj.`、`vt.`、`vi.` 等；一个单词有多个词性时，可在释义中按对应词性分行书写。
- 章节标题建议使用 `[List 01]`、`[List 02]` 这样的形式。
- PDF 导入适用于可复制文本的 PDF；扫描图片型 PDF 暂不支持。

词书文件不会内置到应用或 DMG 中，首次使用时请从本地文件导入。

## 下载 macOS App

前往 [Releases](https://github.com/Lentin1/SimpleDictionary/releases) 下载 Apple Silicon 安装包：

1. 下载与当前版本号匹配的安装包；v0.2.0 的资产名为 `JianCi_0.2.0_aarch64.dmg`，后续版本以 Releases 页面为准。
2. 打开 DMG，将「简辞」拖入 Applications。
3. 当前版本未进行 Apple 开发者签名；首次打开时，如系统拦截，请在 Finder 中右键应用并选择「打开」。

应用支持 M1、M2、M3、M4 等 Apple Silicon Mac。词书导入、学习和本地记录不需要网络或账号；使用云端 AI 接口时需要网络和相应的 API 配置。

## 从源码运行桌面版

要求 Node.js `>=22.13.0` 和 Rust：

```bash
npm install
PATH=/opt/homebrew/opt/rust/bin:$PATH npm run tauri:dev
```

新版前端只作为 Tauri 桌面应用的界面和构建资源，不再作为独立 Web 产品运行。

## 构建 macOS DMG

仅构建 Apple Silicon 版本：

```bash
npm run tauri:build
```

输出文件位于 `src-tauri/target/release/bundle/dmg/`。桌面开发模式：

```bash
npm run tauri:dev
```

## 开发检查

```bash
npm run v2:typecheck
npm run v2:build
npm run lint
npm test
PATH=/opt/homebrew/opt/rust/bin:$PATH cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

## 技术栈

- React 19 + TypeScript + Vite：负责桌面应用界面和前端构建
- Tauri 2 + Rust：负责轻量 macOS 桌面壳和本地能力
- SQLite（rusqlite bundled）：负责词书、章节计划、学习进度和历史记录
- pdf.js：负责离线解析文本型 PDF
- 旧 Electron / Vinext 入口：迁移期间保留，正式桌面版使用 Tauri

## 许可证

本项目采用 [MIT License](LICENSE) 开源。
