# team3/web — Web 控制台

team3 的 Web 控制台（Next.js App Router），用于查看协作进度、收发消息、管理 agent 任务。

[English](README.md) | **简体中文**

## 开发启动

```bash
cd team3/web
npm install
TEAM3_SUPERMAN=1 PORT=9001 npm run dev
# 打开 http://localhost:9001
```

> 入口与打包方式见仓库根 [README](../README.md) 与 `spec/usage.md`。

## 设计规范

- UI 遵循 [DESIGN-LANGUAGE.md](DESIGN-LANGUAGE.md)（StyleSeed 设计语言，Mintlify 风格）
- 开发约束见 [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md)
