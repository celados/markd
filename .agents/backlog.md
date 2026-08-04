---
type: Backlog
title: Markd deferred work
description: Known follow-ups deliberately left outside completed Markd changes.
status: active
---

# Deferred work

- updater signing key、release URL 与 updater endpoint 已切到 `celados/markd`。Cloud Engine 已迁移
  现有协议，但 production ownership gate 在源码层保持关闭；只有 tests 可用 loopback origins 启用。
  在启用 production publishing 或部署 fork site 前，必须裁决产品域名与 Cloud API ownership，并把
  canonical origins 作为新的源码级 trusted configuration；不能仅靠继承上游环境变量打开 gate。
- Vaultwarden 服务版本尚未兼容 Bitwarden CLI `2026.7.0`，会在解密 item 时抛出
  `invalid type: JsValue(...), expected a string`。本次发布 setup 受控固定官方 CLI `2026.6.0`；后续应升级
  Vaultwarden 到支持 2026.7.0+ client 的版本，再删除这个临时版本 pin。
- production bundle 仍报告大 chunk，尤其 editor 与 AppShell；这是 code-splitting/performance
  follow-up，不是 build correctness failure。
- Playwright browser journeys 仍绑定固定 preview port `4173`；并行 agent 同时运行 suite 时可能因端口
  已占用而在用例开始前失败。单独复跑已通过 35/35，确认这不是产品 bug；后续应由测试编排分配隔离端口，
  不能通过杀掉其他 agent 的进程来掩盖冲突。
- Octane 2026-07-31 release train 为消费已审计的上游修复而加入了精确
  `minimumReleaseAgeExclude`。这些版本通过普通 install/build/browser 门禁后，待其自然满足 pnpm
  release-age policy 时删除该临时例外列表；不要把例外扩成 package-name wildcard。
- `@octanejs/base-ui` 已正式发布 Menu/Menubar/ContextMenu subpaths，但 Markd 仍保留现有
  ContextMenu。后续 adoption 需要把 Root/Trigger owner 移入 FileTree/PinnedNotes callers，并以
  browser journey 验证右键、键盘导航、dismissal 和 focus restore；不要复制 binding source。
- `@pierre/trees` 当前仍是 `1.0.0-beta`，且 package metadata 声明 React peers。采用 Vanilla runtime
  前必须证明不会安装或加载 React，并以 browser journeys 锁住 focus、keyboard、rename、drag/drop
  和 context-menu 行为。
- `@celados/fff-node` 通过 `ffi-rs` 加载平台 `@celados/fff-bin-darwin-*` cdylib。#13 已对 unsigned local
  artifact 验证 ASAR header、exact unpacked native payload、updater metadata 与 packaged utility smoke；
  Developer ID 签名、公证和 Gatekeeper 验证只能由 tag release workflow 使用真实 Apple credentials 闭环。
- `v0.2.5` 的 canonical assets、匿名 readback 与 production updater smoke 已通过，网站源码也已切到
  该版本。Celados fork 不拥有 `usemarkd.app`，当前 Cloudflare 凭据可见的账户均不包含该 zone，因此
  不能把源码更新宣称为线上部署。只有产品域名 ownership 完成裁决、对应账户明确授权后，才能绑定并
  验证 fork 的公开网站；在此之前以公开 GitHub Release 作为正式下载入口。
