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

Use **Manage types…** in the Relationships section to create or edit types and
metadata fields. Fields support text, numbers, booleans, dates and enum options,
with optional or required values. Type and field IDs stay fixed when labels change.
Retire a type to prevent new use while keeping existing relationships readable.

Removing fields, changing value kinds, requiring values or narrowing enum options
requires **Review metadata migration…**. Review the old values and typed replacements,
then preview and save the change. Cancel preserves the catalog and existing data.

Relationships are stored as immutable standalone Zotero notes and use native
library synchronization. Preserve these plugin-managed notes: editing or deleting
them can make relationship data unavailable. Conflicting or incomplete generations
block changes until resolved. Native reference fields, ordinary notes and Zotero's
Related links retain their separate behavior.

Configured rules generate relationships from explicit roots. Rows distinguish
manual, generated and combined support; editing or removing a manual contribution
preserves independent rule support. Generated-only rows follow their roots and
rules and cannot be edited directly.

The rule configuration interface is not available yet. The initial catalog does
not enable inverse rules automatically; the Referencing type alone creates an
explicit link.

The [published update manifest](https://raw.githubusercontent.com/JulianKimmig/zotero-reference-relationships/main/updates.json) currently contains no releases. The local [updates.json](updates.json) is its source. No automatic upgrade is available yet.

Version `0.1.0` targets **Zotero 10.0.7 on Linux x86_64** only. The
[manifest](manifest.json) restricts the application version to `10.0.7`; this
development target does not establish full product compatibility.
