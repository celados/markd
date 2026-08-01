---
type: Backlog
title: Markd deferred work
description: Known follow-ups deliberately left outside completed Markd changes.
status: active
---

# Deferred work

- updater signing key、release URL 与 updater endpoint 已切到 `celados/markd`。应用仍沿用上游
  `usemarkd.app` 品牌域名和 Markd Cloud API；在启用 cloud publishing 或部署 fork site 前，必须裁决
  产品域名与 cloud ownership，不能让 fork binary 静默写入上游服务。
- Vaultwarden 服务版本尚未兼容 Bitwarden CLI `2026.7.0`，会在解密 item 时抛出
  `invalid type: JsValue(...), expected a string`。本次发布 setup 受控固定官方 CLI `2026.6.0`；后续应升级
  Vaultwarden 到支持 2026.7.0+ client 的版本，再删除这个临时版本 pin。
- production bundle 仍报告大 chunk，尤其 editor 与 AppShell；这是 code-splitting/performance
  follow-up，不是 build correctness failure。
- Octane 2026-07-31 release train 为消费已审计的上游修复而加入了精确
  `minimumReleaseAgeExclude`。这些版本通过普通 install/build/browser 门禁后，待其自然满足 pnpm
  release-age policy 时删除该临时例外列表；不要把例外扩成 package-name wildcard。
- `@octanejs/base-ui` 已正式发布 Menu/Menubar/ContextMenu subpaths，但 Markd 仍保留现有
  ContextMenu。后续 adoption 需要把 Root/Trigger owner 移入 FileTree/PinnedNotes callers，并以
  browser journey 验证右键、键盘导航、dismissal 和 focus restore；不要复制 binding source。
