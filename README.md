# Reference Relationships

Reference Relationships is currently a **lifecycle scaffold**. It tracks main windows and releases its runtime when disabled, uninstalled or shut down.
It adds no user interface, relationship editor, graph storage, metadata fields
or custom rules yet.

The [published update manifest](https://raw.githubusercontent.com/JulianKimmig/zotero-reference-relationships/main/updates.json) currently contains no releases. The local [updates.json](updates.json) is its source. No automatic upgrade is available yet.

Version `0.1.0` targets **Zotero 10.0.7 on Linux x86_64** only. The
[manifest](manifest.json) restricts the application version to `10.0.7`; this
development target does not establish full product compatibility.

The intended product provides directed, typed relationships with metadata and
custom rules, including cross-device and shared-group synchronization. These
features are unavailable in this scaffold, and no storage backend is selected.
