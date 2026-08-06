# 简辞桌面版重构说明

新版桌面端使用 Tauri 2 + React + TypeScript + SQLite，目标平台是 Apple Silicon macOS。旧 Electron/Vinext 入口暂时保留，方便在迁移期间回退和对照；正式桌面开发入口使用 v2/ 与 src-tauri/。

## 数据与迁移

- 数据库位于 macOS 的应用数据目录 jian-ci.sqlite3。
- 首次启动时会读取旧版 ~/Library/Application Support/vocab-flow/simple-dictionary-state.json，迁移词书、词条、进度、章节计划、学习历史和未完成会话。
- 词书内容、学习进度、备份和 SQLite 数据都不会写入 Git，也不会打进 DMG。
- 每次切换词书、导入、修改章节计划或回答单词后，SQLite 会记录本地快照。
- AI 接口地址和模型保存到 SQLite；API Key 只写入 macOS 钥匙串。

## 常用命令

~~~bash
npm run v2:typecheck
npm run v2:build
PATH=/opt/homebrew/opt/rust/bin:$PATH cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:dev
~~~

v2/ 是 Tauri 桌面应用的前端源码，不作为独立 Web 产品发布。`v2:dev` 只是 `tauri:dev` 调用的内部 Vite 开发服务器，日常使用 `npm run tauri:dev` 启动完整桌面应用。DMG 构建由 tauri:build 负责；发布前再运行完整回归并人工检查迁移数据。词书不会被预置到应用包内，用户首次使用时从本地导入。

## 学习队列

学习和复习都严格按当天安排的章节取词。选择“不认识”后，单词进入当前章节队尾，必须再次答对才会从本轮队列移除。选择后按 Z 可以撤销本次选择，Space 进入下一个单词。
