---
type: AgentConfig
title: GitHub issue tracker
description: Markd 工程 skills 创建、读取、依赖连接和关闭工作项的统一合同。
status: active
resource: https://github.com/celados/markd/issues
generated: { by: codex/gpt-5, at: 2026-08-03T10:50:11+08:00 }
---

# Issue tracker

Issues 和 PRD 使用 `celados/markd` GitHub Issues，通过 `gh --repo celados/markd` 操作。这个 checkout
同时配置了 fork origin 和只读 upstream，禁止依赖 `gh` 的 remote 自动推断。

## Operations

- 创建：`gh issue create --repo celados/markd`
- 读取：`gh issue view <number> --repo celados/markd --comments`
- 查询：`gh issue list --repo celados/markd --state open --json number,title,body,labels,comments`
- 评论：`gh issue comment <number> --repo celados/markd`
- 标签：`gh issue edit <number> --repo celados/markd --add-label/--remove-label`
- 关闭：`gh issue close <number> --repo celados/markd --comment "..."`

GitHub API 和 native dependency 调用也必须显式使用 `repos/celados/markd/...`。

## Pull requests

PR 不作为 triage request surface。`/triage` 只处理 Issues。

## Blocking edges

优先使用 GitHub native issue dependencies。创建 edge 时，`issue_id` 必须是 blocker 的 database ID，
不是 issue number 或 node ID。

如果 repository 不支持 native dependencies，则在 ticket 开头使用：

```text
Blocked by: #<issue>, #<issue>
```

只有所有 blocker 已关闭且 ticket 未被领取时，ticket 才属于可执行 frontier。

## Skill contract

- “Publish to issue tracker”表示创建 GitHub Issue。
- “Fetch ticket”表示读取 issue body、comments、labels 和 dependency state。
- `/implement` 开始工作时先将 ticket assign 给当前执行者。
- 完成时记录验证证据，然后关闭 ticket。
