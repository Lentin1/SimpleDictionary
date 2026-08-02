# 简辞 Simple Dictionary

简辞是一款离线、按章节学习与复习的英语词汇应用。它把“今天学什么、复习什么”交给明确的章节计划，让每次学习都保持简单、可控，并把学习记录保存在本机。

## 功能亮点

- 按章节制定学习计划：每天可选择多个新词章节和多个复习章节，也可以跳着安排章节。
- 双模式学习：先处理今日到期复习，再进入今天安排的新词学习。
- 词卡学习：先回忆单词，再查看音标、词性、中文释义和例句。
- 学习记录持久化：今日进度、已掌握、待复习、词书切换和打卡记录均保存在本地。
- 词书管理：支持导入、查看、切换、重命名和删除多套词书。
- TXT / PDF 导入：支持音标；文本型 PDF 可直接识别章节、单词、音标、词性和释义。
- 本地备份：可以导出和导入 JSON 学习备份，迁移或重装后恢复进度。
- 快捷键：`←` 不认识，`→` 认识，`Space` 查看释义或进入下一个单词，`Z` 撤销上次选择。
- 学习日历：提供月、周、日视图，日视图展示按小时统计的学习曲线。

## 使用方式

1. 在「我的词书」中导入自己的 TXT 或文本型 PDF。
2. 在「今日学习」中查看打卡日历和当天章节计划。
3. 先完成到期复习，再学习当天安排的新词。
4. 对每个单词选择「认识」或「不认识」，系统会记录到当前章节的学习或复习列表。
5. 完成今日计划后打卡；需要换设备或重装时，先导出本地备份。

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
- 例句为空时，应用不会显示例句区域。
- 词性可以写成 `n.`、`adj.`、`vt.`、`vi.` 等；一个单词有多个词性时，可在释义中按对应词性分行书写。
- 章节标题建议使用 `[List 01]`、`[List 02]` 这样的形式。
- PDF 导入适用于可复制文本的 PDF；扫描图片型 PDF 暂不支持。

词书文件不会内置到应用或 DMG 中，首次使用时请从本地文件导入。

## 下载 macOS App

前往 [Releases](https://github.com/Lentin1/vocab-flow/releases) 下载 Apple Silicon 安装包：

1. 下载名称类似 `简辞-0.1.0-arm64.dmg` 的文件。
2. 打开 DMG，将「简辞」拖入 Applications。
3. 当前版本未进行 Apple 开发者签名；首次打开时，如系统拦截，请在 Finder 中右键应用并选择「打开」。

应用支持 M1、M2、M3、M4 等 Apple Silicon Mac，运行时不需要网络或账号。

## 从源码运行 Web 版

要求 Node.js `>=22.13.0`：

```bash
npm install
npm run dev
```

然后打开终端输出的本地地址。

## 构建 macOS DMG

仅构建 Apple Silicon 版本：

```bash
npm run desktop:dist
```

输出文件位于 `release/简辞-*-arm64.dmg`。桌面开发模式：

```bash
npm run desktop:dev
```

## 开发检查

```bash
npm run lint
npm test
```

## 技术栈

- React 19 + TypeScript
- Vinext / Vite
- Electron + electron-builder
- pdf.js
- Browser localStorage

## 许可证

暂未指定开源许可证。
