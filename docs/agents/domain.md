---
type: AgentConfig
title: Domain documentation
description: Agent 在探索和修改 Riffle 前读取 domain context 与 ADR 的规则。
status: active
generated: { by: codex/gpt-5, at: 2026-08-03T10:50:11+08:00 }
---

# Domain docs

Riffle 使用 single-context layout。

## Before exploring

1. 读取根 `CONTEXT.md`。
2. 读取与目标区域相关的 `docs/adr/`。
3. 缺失的 ADR 不构成错误；只有出现真实、难以逆转的决策时才创建。

## Vocabulary

Issue title、spec、测试名和代码中的领域概念必须使用 `CONTEXT.md` 定义的术语。发现缺失或歧义时，
使用 `/domain-modeling` 收敛，不自行制造同义词。

## ADR conflicts

若实现或 Proposal 与现有 ADR 冲突，必须明确指出并重新裁决，不能静默覆盖。
