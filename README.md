# Reference Relationships

Create directed, typed relationships between regular Zotero references in the
same personal or group library. The initial types are **Referencing**,
**Referenced by** and **Similar**, each with optional plain-text Note metadata.

Select a reference and open its **Relationships** item-pane section, or use
**Add relationship…** in its context menu. Choose a target through Zotero's native
picker, select a type, enter metadata and click **Preview**, then **Save relationship**.
Cancel discards the draft. Incoming and outgoing rows provide navigation, editing
and removal; removal requires confirmation. Self-links and cross-library links
are rejected. Read-only libraries can be viewed but cannot be edited.

Relationships are stored as immutable standalone Zotero notes and use native
library synchronization. Preserve these plugin-managed notes: editing or deleting
them can make relationship data unavailable. Conflicting or incomplete generations
block changes until resolved. Native reference fields, ordinary notes and Zotero's
Related links retain their separate behavior.

Custom type definitions, automatic inverse relationships and custom rules are
not available yet. Creating Referencing currently creates only that explicit link.

The [published update manifest](https://raw.githubusercontent.com/JulianKimmig/zotero-reference-relationships/main/updates.json) currently contains no releases. The local [updates.json](updates.json) is its source. No automatic upgrade is available yet.

Version `0.1.0` targets **Zotero 10.0.7 on Linux x86_64** only. The
[manifest](manifest.json) restricts the application version to `10.0.7`; this
development target does not establish full product compatibility.
