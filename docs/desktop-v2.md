# 简辞桌面版重构说明

新版桌面端使用 Tauri 2 + React + TypeScript + SQLite，目标平台是 Apple Silicon macOS。旧 Electron/Vinext 入口暂时保留，方便在迁移期间回退和对照；正式桌面开发入口使用 v2/ 与 src-tauri/。

## 数据与迁移

- 数据库位于 `~/Library/Application Support/com.vocabflow.jianci/jian-ci.sqlite3`。
- 首次启动时会读取旧版 ~/Library/Application Support/vocab-flow/simple-dictionary-state.json，迁移词书、词条、进度、章节计划、学习历史和未完成会话。
- 词书内容、学习进度、备份和 SQLite 数据都不会写入 Git，也不会打进 DMG。
- 每次切换词书、导入、修改章节计划或回答单词后，SQLite 会记录本地快照。
- AI 接口地址和模型保存到 SQLite；API Key 只写入 macOS 钥匙串。
- JSON 备份会导出词书、进度、计划和历史记录；当前 Tauri 界面只有导出入口，没有恢复入口。

## 常用命令

~~~bash
npm run v2:typecheck
npm run v2:build
PATH=/opt/homebrew/opt/rust/bin:$PATH cargo test --manifest-path src-tauri/Cargo.toml
npm run lint
npm test
git diff --check
npm run tauri:dev
~~~

v2/ 是 Tauri 桌面应用的前端源码，不作为独立 Web 产品发布。`v2:dev` 只是 `tauri:dev` 调用的内部 Vite 开发服务器，日常使用 `npm run tauri:dev` 启动完整桌面应用。DMG 构建由 tauri:build 负责；发布前再运行完整回归并人工检查迁移数据。词书不会被预置到应用包内，用户首次使用时从本地导入。

## 学习队列与界面

学习和复习都按所选任务日期的章节取词，昨天补做、今日学习和明日提前各自使用对应日期的历史记录。已经在该日期答对的词不会因切换日期而重新进入队列；当天目标数以首次记录的目标为基准，不会随着已掌握状态缩小。选择“不认识”后，单词进入当前队列尾部，必须再次答对才会从本轮移除。选择后按 Z 可以撤销本次选择，Space 进入下一个单词。

左侧导航固定在窗口顶部，不随主内容滚动。AI 面板使用独立消息滚动区，新消息会平滑定位到最新位置；中文输入法组词期间的 Enter 只确认输入，组词结束后再次按 Enter 才发送问题。

多词性释义优先从完整原始释义拆分；拆分结果无法覆盖全部原文时会回退到完整释义。TXT 例句会保存到 SQLite 并传入 AI 上下文，但当前 Tauri 学习卡尚未显示独立例句区域。单词发音目前使用系统 Web Speech 英语音色，尚未提供发音人选择或在线自然语音。
