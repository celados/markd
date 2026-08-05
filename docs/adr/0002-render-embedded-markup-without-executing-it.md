---
type: ADR
title: Render embedded markup without executing it
status: accepted
generated: { by: codex/gpt-5, at: 2026-08-05T12:46:10+08:00 }
tags: [markdown, html, security, electron, renderer]
---

# Render embedded markup without executing it

Riffle's Readonly View accepts HTML syntax because Notes need richer expression than a narrow Markdown subset, but it renders that syntax through an explicit element, attribute, navigation, and resource policy rather than granting Note content application-code privileges. Script execution, event attributes, privileged embeds, and access to the Riffle bridge remain outside the Markdown renderer; future MDX, full HTML, or other executable document formats require a separate trust and sandbox design.
