# Documentation Index

后续开发者和 AI 请按以下顺序阅读：

1. [`../AGENTS.md`](../AGENTS.md)：强制工作流、验证、提交、分支和推送规则。
2. [`../README.md`](../README.md)：面向使用者和开发者的功能、安装、运行与打包说明。
3. [`AI-development-guide.md`](AI-development-guide.md)：当前架构、关键数据流、跨层同步点、不可破坏行为和排障方法。
4. [`2026-08-13-development-handoff.md`](2026-08-13-development-handoff.md)：历史开发快照，仅用于追溯当时的设计与提交背景。

`AI-development-guide.md` 是 `docs/` 中关于当前实现的事实来源。日期命名的交接文档可能包含过时提交号、测试数量和功能边界，不能替代当前源码、`AGENTS.md` 与主开发指南。

When documentation conflicts, use this priority:

```text
current source and tests
  > AGENTS.md
  > README.md and AI-development-guide.md
  > dated historical handoff documents
```
