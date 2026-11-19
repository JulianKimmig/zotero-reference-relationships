# Reference Relationships

Create directed, typed relationships between regular Zotero references in the
same personal or group library. The initial types are **Referencing**,
**Referenced by** and **Similar**, each with optional plain-text Note metadata.

Install the provided XPI through Zotero's **Tools → Plugins** window: open the
gear menu and choose **Install Add-on From File…**. Keep a JSON backup before
upgrading. Disable or uninstall the plugin from the same window; reinstalling
restores access to retained relationship data after the library finishes syncing.

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

When the Relationships section offers **Review original relationships…**, use
it to inspect retained original keys, metadata and contributions after merges or
endpoint changes. Choose **Edit this original…**, **Remove this original…** or
select originals for a reviewed removal. Preview the complete effects before
saving; other contributions remain stored. Close and reopen the list if Zotero
reports that data changed. These controls repair original contributions. Storage
forks from concurrent synchronization require a developer recovery review;
there is currently no user interface for choosing between those stored versions.

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

To back up or transfer relationship data, open **Reference Relationships** in
Zotero's preferences and use **Backup and restore**:

1. Select the export library and choose **Export to new file**. The JSON file
   contains original relationships, metadata, type definitions and rules. Read-only
   libraries can be exported. Existing files are never overwritten.
2. To restore or transfer, select the target library, choose **Choose import file**,
   then select **Merge** or **Replace**. Merge keeps identical records once and
   rejects conflicting identities. Replace uses the complete imported authority.
3. Review every endpoint mapping. Use **Choose reference…** to select the actual
   target reference, or **Retain original inactive key** for an unavailable
   original. Different owners require an explicit decision for every endpoint;
   matching titles, DOIs or item keys do not automatically establish identity.
4. Choose **Preview import** and inspect the before/after authority, projected
   relationships, metadata, rules and retained-endpoint diagnostics. Review pages
   preserve every captured field. Generated relationships are recomputed.
5. Replacing an existing graph requires **Backup current graph to new file**.
   Commit is enabled only after that complete backup has been written and verified.
   Cancel discards a review before confirmation and leaves the import and backup
   files in place. After choosing **Commit reviewed import**, wait for its result;
   the target, operation and cancellation controls remain locked until it finishes.

If the library, references or permissions change, prepare a fresh preview. A failed
write is not acknowledged as a backup; choose a new filename for another attempt.
Keep the original import and backup files until recovery is complete. Incomplete
or conflicting synchronized authority blocks imports; finish synchronization and
preserve all plugin-managed notes while resolving any persistent conflict.

Relationship authority lives in standalone notes headed **Reference Relationships
data** within its Zotero library. Disable or uninstall retains these notes and
JSON backups. Ordinary Zotero translator exports are separate from this plugin's
JSON backup format.

Published releases use the [GitHub release update feed](https://github.com/JulianKimmig/zotero-reference-relationships/releases/latest/download/updates.json).
The feed becomes available with the first automated release. Existing local
`0.1.0` installations need one manual installation of that release to adopt the
new feed; subsequent published updates are automatic. The legacy raw-main
[updates.json](updates.json) remains empty.

Version `0.1.1` supports **Zotero 10.0.7 on Linux x86_64**. The
[manifest](manifest.json) restricts the application version to `10.0.7`.
Other Zotero versions and operating systems are outside the supported scope.

Each library supports up to 1,000 explicit relationships, 64 relationship types
and 64 rules, with up to 16 metadata fields per type. Each validated graph is
also limited to 1 MiB. Preview rejects invalid or excessive work before
publication; no partial result is saved. Persistent
sync conflicts require an explicit complete recovery review. Keep all competing
data notes until recovery is finished; importing over a conflict is blocked.

The plugin is distributed under the [MIT license](LICENSE).
[Third-party notices](THIRD-PARTY-NOTICES.md) describe runtime references and
development dependencies.
