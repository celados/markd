---
type: Backlog
title: Markd deferred work
description: Known follow-ups deliberately left outside completed Markd changes.
status: active
---

# Deferred work

- Electron Phase 2 的首个 Vault slice 使用 utility 内的临时 bootstrap snapshot builder，只为
  choose/create/reopen、Note CRUD 与 native Trash 提供 coherent tree。它没有 watcher、search 或完整
  ignore precedence，只做 `.markd`/hidden、`node_modules` 与 reserved root 的最低限度排除，不能作为最终
  ignore correctness 证据。#5 引入 fff
  Vault Index 时必须删除这个 builder，让 Snapshot/Change/search 共用唯一 index。Pins、Collections、
  Quick Capture、Cloud 与其余 Tauri adapter 仍待 Phase 4 迁移；在此之前不能宣称 Electron feature-complete。
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
- Electron target 的 fff adoption 仍有 ignore lifecycle hard gate：Markd-managed `.ignore` block
  必须在 initial scan、watch ingestion 与 rescan 中生效，并且 hidden path、`.git/info/exclude`、
  global/root/nested ignore 与 hard-policy defense 都要有 contract tests。不修改用户 `.gitignore`，
  也不再为 fff 增加 `additionalIgnorePatterns`。设计合同见
  [`../docs/electron-native-architecture.md`](../docs/electron-native-architecture.md)。
- `@pierre/trees` 当前仍是 `1.0.0-beta`，且 package metadata 声明 React peers。采用 Vanilla runtime
  前必须证明不会安装或加载 React，并以 browser journeys 锁住 focus、keyboard、rename、drag/drop
  和 context-menu 行为。
- `@ff-labs/fff-node` 通过 `ffi-rs` 加载平台 `@ff-labs/fff-bin-*` cdylib；该 optional
  dependency 必须在 electron-builder packaged macOS/Linux artifacts 中完成 ASAR unpack、加载、
  签名、公证和运行 smoke；dev mode 成功不构成 Electron migration 的 packaging 证据。
