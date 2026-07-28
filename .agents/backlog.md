# Deferred work

- 当前 fork 仍沿用上游 `usemarkd.app`、Markd Cloud、更新签名与 release URL。源码 fork
  可以独立演进；但在 Celados 发布自己的二进制前，必须先裁决产品域名、签名 key、updater
  endpoint 与 cloud ownership，不能让 fork binary 静默接入上游发布通道。
- production bundle 仍报告大 chunk，尤其 editor 与 AppShell；这是 code-splitting/performance
  follow-up，不是 build correctness failure。
- Octane 0.1.17 在已挂载 TSX editor branch 切到 lazy `Suspense` source branch 时，会对脱离
  parent 的 marker 调用 `insertBefore`；同步后挂载 ref owner 也会读到未初始化 slot。上游跟踪为
  [`octanejs/octane#335`](https://github.com/octanejs/octane/issues/335)，维护者已确认是
  runtime/compiler correctness bug；issue 当前 closed，但尚无 Markd 可消费的发布版本。Markd 已删除该
  Suspense seam，让 rich/source owner 都常驻并只切 `hidden`；这也保留 CodeMirror undo/state，
  代价是 source editor 进入 AppShell chunk。上游修复后可重新评估 code split，但不得恢复
  mount/unmount lifecycle 而不跑 `tests/browser/editor.spec.ts`。
- `@tsrx/typescript-plugin@0.3.116` 的 Octane automatic detection 仍查找未发布的
  `octane/src/compiler/volar.js`；app 在 `tsconfig.json` 显式选择公开 export
  `octane/compiler/volar`。上游跟踪为
  [`Ripple-TS/ripple#1403`](https://github.com/Ripple-TS/ripple/issues/1403)。Ripple main 的
  workspace fixture 仍显式伪造 `octane/src/compiler/volar.js`；这是小范围 source + fixture PR
  候选。
- Octane 的 `.rulesync/rules/tsrx-authoring.md` 与 MCP migrate skill 仍记录过期
  `@case (value) {}` / `@default {}` 语法；真实 compiler fixtures 使用
  `@case value: {}` / `@default: {}`。上游跟踪为
  [`octanejs/octane#336`](https://github.com/octanejs/octane/issues/336)，维护者已确认
  RuleSync source 与 MCP packaged guidance 都需要修复；issue 当前 closed。正式修复发布前以
  `packages/octane/tests/_fixtures/switch.tsrx` 为准，不再另开重复 PR。
- 启用真实 TSRX typecheck 后，`@octanejs/cmdk`、`sonner`、`tiptap` 发布的 raw `.tsrx`
  source 暴露出 strict diagnostics；Octane 当前 `tsgo` gate 没有检查这些文件。上游跟踪为
  [`octanejs/octane#332`](https://github.com/octanejs/octane/issues/332)，维护者已确认
  published-package 与 CI gate 缺陷；issue 当前 closed，但 package fix 尚未进入可消费版本。本仓库的
  `scripts/typecheck.js` 只允许这三个精确 package path，任何 local 或新 dependency diagnostic
  仍失败。上游修复发布后删除 allowlist wrapper，恢复直接
  `tsrx-tsc --noEmit`。
- `octane@0.1.17` 将 `@for (...; index i; key i)` 以及 TSX
  `.map((item, index) => key={index})` 的 key selector lower 成未定义的 index，首次渲染对应
  分支即抛 `ReferenceError`。上游跟踪为
  [`octanejs/octane#333`](https://github.com/octanejs/octane/issues/333)，维护者已确认
  TSRX/TSX 共用的 compiler correctness 根因；issue 当前 closed，但 compiler fix 尚未进入可消费版本。
  本仓库暂把
  `{ char, index }` 在 setup 中显式物化后用 `key letter.index`。修复发布后可简化，但当前写法
  本身没有错误，不要求为了语法糖回改。
- `octane@0.1.17` 的 `hostComponent` 不接受 TSX/createElement descriptor children；修复已提交
  并于 2026-07-28 合并
  [`octanejs/octane#328`](https://github.com/octanejs/octane/pull/328)。app 暂通过
  `patches/octane@0.1.17.patch` 重放；等待包含 merge commit `430061ee` 的 Octane 版本发布后，
  用 pnpm 升级并删除 `patchedDependencies` 与 patch 文件。
- `@octanejs/base-ui@0.1.15` 的 raw Popover source 在 strict consumer 中报告未使用的 `Payload`
  泛型；修复已于 2026-07-28 合并
  [`octanejs/octane#329`](https://github.com/octanejs/octane/pull/329)。app 暂用 pnpm patch
  重放；等待包含 merge commit `03588b13` 的 Base UI 版本发布后删除对应 patch。
- `@octanejs/motion@0.1.16` 的 `AnimatePresence` 与 `MotionConfig` 只渲染 function-shaped TSRX
  children，TSX descriptor/null children 被静默丢弃；修复与 TSX insert/remove regression 已提交
  并于 2026-07-28 合并
  [`octanejs/octane#331`](https://github.com/octanejs/octane/pull/331)，merge commit
  `749104c6389c854ea08c6ca3ac65f1c7d74a398e`。本仓库暂用 pnpm patch 重放；等待包含该修复的
  Motion 正式版本后升级并删除对应 patch。
- Octane snapshot 已有 Base UI Menu/Menubar/ContextMenu source 和 tests，但最新 npm
  `@octanejs/base-ui@0.1.15` tarball 未包含这些 subpaths。Markd 暂保留现有 ContextMenu；待正式
  package 发布后再把 Root/Trigger owner 移入 FileTree/PinnedNotes callers，不引用 `.scratch`
  或复制 binding source。
