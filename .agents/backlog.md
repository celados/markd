---
type: Backlog
title: Markd deferred work
description: Known follow-ups deliberately left outside completed Markd changes.
status: active
---

# Deferred work

- `@ff-labs/fff-node@0.10.1` 的 npm prebuilt 启用了 zlob walker；该 backend 当前只读取
  root/nested `.gitignore` 与 `.ignore`，不会读取 Git user/global excludes 或
  `<vault>/.git/info/exclude`。非-zlob ripgrep backend 支持两者，但 npm SDK 没有 backend
  selector。#5 保留一条 `test.fails` contract 锁住此 upstream drift；在 fff prebuilt 修正前不能把
  Git global/info acceptance gate 标记完成，也不能用 post-index JS filtering 伪装成性能正确。
- fff 官方 [#723](https://github.com/dmtrKovalenko/fff/issues/723) 已确认 release 使用的 zlob
  walker 在 `*` + re-include directory 这类合法 negation 下会过早 prune nested directories，ripgrep
  backend 则正确。Vault Index 保留对应 `test.fails` contract；上游修复前不能宣称完整 nested
  precedence/negation correctness。

- Electron Phase 2 的首个 Vault slice 使用 utility 内的临时 bootstrap snapshot builder，只为
  choose/create/reopen、Note CRUD 与 native Trash 提供 coherent tree。它没有 watcher、search 或完整
  ignore precedence，只做 `.markd`/hidden、`node_modules` 与 reserved root 的最低限度排除，不能作为最终
  ignore correctness 证据。#5 引入 fff
  Vault Index 时必须删除这个 builder，让 Snapshot/Change/search 共用唯一 index。Cloud 与其余 Tauri
  adapter 仍待 Phase 4 迁移；在此之前不能宣称 Electron feature-complete。
- Todos 与 Bookmarks CRUD 已由 utility-owned Collections interface 接管；Bookmark 的远程 metadata
  enrichment 仍是 legacy Tauri capability，不属于 #9 的 CRUD seam。迁移这个 effect
  时应继续通过 semantic bridge 进入 utility/native owner，不能恢复 renderer-side fetch 或 raw invoke。
- pasted assets、Note/Bookmark export 与 `markd-asset` protocol 已覆盖真实 hidden Electron smoke；但仓库在
  #13 落地 `electron-builder` 前没有 packaged app artifact，因此 #11 的 packaged asset/export/rejection
  smoke 不能执行。#13 必须复用同一组 semantic bridge journeys 对安装产物运行，不能把 dev Electron
  smoke 当作 packaged evidence。
- updater signing key、release URL 与 updater endpoint 已切到 `celados/markd`。Cloud Engine 已迁移
  现有协议，但 production ownership gate 在源码层保持关闭；只有 tests 可用 loopback origins 启用。
  在启用 production publishing 或部署 fork site 前，必须裁决产品域名与 Cloud API ownership，并把
  canonical origins 作为新的源码级 trusted configuration；不能仅靠继承上游环境变量打开 gate。
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
