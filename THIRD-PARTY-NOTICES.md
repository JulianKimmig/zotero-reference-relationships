# Third-party references and development dependencies

The project source is provided under the MIT license in LICENSE.

## Runtime host and API references

Zotero is the separately installed runtime application. Its source is distributed
under the GNU Affero General Public License, version 3, by the Corporation for
Digital Scholarship; its own copyright, license and trademark notices apply.
Zotero source and runtime binaries are outside this XPI.

API and lifecycle references include the official Zotero developer documentation
(https://www.zotero.org/support/dev/client_coding/plugin_development) and the
official make-it-red sample (https://github.com/zotero/make-it-red). These references
are distinct from the project's MIT license.

## Development dependencies

| Package | Pinned version | Package license |
| --- | --- | --- |
| TypeScript | 5.9.3 | Apache-2.0 |
| @types/node | 22.20.1 | MIT |
| undici-types | 6.21.0 | MIT |

These packages provide development tooling and declarations. They remain outside
the XPI, and their own license files accompany their installed npm packages.
The XPI contains the project's production files, LICENSE and these notices;
account tooling, tests, profiles, credentials and Node packages are excluded.
