---
type: ADR
title: Adopt Riffle as the product identity
status: accepted
generated: { by: codex/gpt-5.6, at: 2026-08-04T00:00:00+08:00 }
tags: [riffle, identity, release, vault]
---

# Adopt Riffle as the product identity

The independent Electron product is named **Riffle**. Current product copy, repository/package names, desktop display name, artifacts, runtime bridge, IPC channels, custom protocol, environment variables, diagnostics, site, and Cloud copy use Riffle exclusively; Markd remains only in historical provenance and pre-Riffle release records.

The released macOS bundle identifier `app.usemarkd` and Vault App Data directory `.markd/` remain stable format identifiers. Changing the bundle identifier would break the updater identity of installed clients, while renaming `.markd/` would invalidate asset links embedded in user-authored Markdown. These identifiers are deliberately not compatibility aliases and must not be exposed as the current product name.

The unowned `usemarkd.app` endpoints and their existing Cloudflare Worker, D1, R2, and Analytics resource names also remain operational identifiers until Riffle has an owned production domain and an authorized resource migration. Source-level environment variables and user-facing Cloud copy use Riffle; retaining an external resource identifier does not authorize deployment or present Markd as the current product.
