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

Use **Manage rules…** in the Relationships section, or open **Reference
Relationships** in Zotero's preferences. Select the library, then create a rule
with a stable ID, root type, matching type and output type. Conditions inspect
the original manual relationship; output metadata copies selected root fields
or uses typed constants. Preview the added, updated and removed relationships
before saving. Existing rules can be edited, enabled, disabled or deleted with
the same review. Cancel preserves the saved rules and relationships.

For an inverse, select **Referencing** as both the root and matching type,
**Referenced by** as output, and **Reverse source and target**. To copy Note
metadata, choose **Copy root field** and select **note**. After saving the rule,
`A referencing B` also produces `B referenced-by A`. The initial catalog enables
no rules automatically. **Explain generated relationship…** shows the original
manual relationship, producing rules and metadata contributions.

Rules keep or reverse existing endpoints within one library. They do not run
scripts or discover new endpoints. Changing a root or output type resets the
form's conditions and mappings; select them again before previewing. If library
data changes during editing, cancel and reopen the rule to review the latest
version.

The [published update manifest](https://raw.githubusercontent.com/JulianKimmig/zotero-reference-relationships/main/updates.json) currently contains no releases. The local [updates.json](updates.json) is its source. No automatic upgrade is available yet.

Version `0.1.0` targets **Zotero 10.0.7 on Linux x86_64** only. The
[manifest](manifest.json) restricts the application version to `10.0.7`; this
development target does not establish full product compatibility.
