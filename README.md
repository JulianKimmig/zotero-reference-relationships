# Reference Relationships

Reference Relationships is currently a **lifecycle scaffold with unverified
installation**. Its source implements main-window tracking and runtime cleanup.
It adds no user interface, relationship editor, graph storage, metadata fields
or custom rules yet.

Installation requires a real HTTPS update-manifest URL, which is not configured.
The supplied [updates.json](updates.json) contains an empty release list for this
plugin; it has not been published to an update host.

Version `0.1.0` targets **Zotero 10.0.7 on Linux x86_64** only. The
[manifest](manifest.json) restricts the application version to `10.0.7`; this
development target does not establish full product compatibility.

The intended product provides directed, typed relationships with metadata and
custom rules, including cross-device and shared-group synchronization. These
features are unavailable in this scaffold, and no storage backend is selected.
