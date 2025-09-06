# Persistence Appendix

## Backend DB Details

The backend service uses a SQLite database (`backend/groups.db` by default) to map TEMPL contracts to their XMTP group IDs and to track moderation. A lightweight in-memory cache mirrors the `groups` table so the server can restore state on boot. During E2E runs the path can be overridden with `DB_PATH` or cleared with `CLEAR_DB=1`.

### Tables

- `groups(contract TEXT PRIMARY KEY, groupId TEXT, priest TEXT)`
  - Maps on-chain TEMPL contract address to the XMTP group conversation ID and the priest’s EOA address.
  - Written on POST `/templs`. Re-read at server boot to restore in-memory cache.
- `mutes(contract TEXT, target TEXT, count INTEGER, until INTEGER, PRIMARY KEY(contract, target))`
  - Stores moderation strikes and mute expiry for each address per TEMPL contract. Written on POST `/mute`.
- `delegates(contract TEXT, delegate TEXT, PRIMARY KEY(contract, delegate))`
  - Stores which addresses are delegated moderation powers by the priest. Written on POST/DELETE `/delegateMute`.

## XMTP Node DB Details

The XMTP Node SDK persists client identity and message metadata in SQLCipher databases named `xmtp-<env>-<inboxId>.db3` in the process's working directory. Each inboxId reuses its database across runs when opened with the same `dbEncryptionKey`. Both the backend service and integration tests rely on this storage.

### Identity model

- `inboxId`: stable per “user” on XMTP, derived from the identity ledger for an EOA/SCW.
- Installations: each inbox can have multiple installations (devices/agents). On the dev network, installs are limited to 10 per inbox.
- When creating an XMTP client, the Node SDK locates or creates a local DB for the inboxId and reuses it.

## XMTP Browser DB Details

The Browser SDK stores its SQLite database inside the Origin Private File System (OPFS), a per-origin sandbox not visible on the host OS. The SDK still names the file `xmtp-dev-<inboxId>.db3`, but it lives inside OPFS and cannot be encrypted even when a key is supplied.

### Important behavior

- OPFS uses exclusive “synchronous access handles.” Opening multiple handles or a writable stream for the same file can trigger `NoModificationAllowedError: createSyncAccessHandle` until the handle is released.
- Avoid spinning up multiple XMTP clients for the same inboxId concurrently in the browser.
- Avoid repeatedly creating and tearing down clients in quick succession to reduce handle contention.
- Prefer a single client per page lifecycle and reuse a stable installation.

## Data Flow Endpoints

Several HTTP endpoints coordinate how data enters and leaves the system. The server writes to SQLite when groups are registered and updates moderation tables for delegate or mute actions. XMTP identity resolution and membership are managed by the XMTP network, not the backend database.

- **POST `/templs` (create/register a TEMPL group)**
  - Verifies the priest’s signature `create:<contract>`.
  - Creates a new XMTP group with the priest. If `priestInboxId` is provided it is used; otherwise the server resolves the inbox on the XMTP network via `findInboxIdByIdentifier` and waits for identity readiness before inviting.
  - Optionally sets group metadata (name/description), tolerating the SDK’s “success reported as error” edge cases.
  - Sends a warm-up message to introduce initial activity.
  - Persists `{ contract, groupId, priest }` to SQLite and to the in-memory cache.
- **POST `/join` (purchase check + add member to XMTP group)**
  - Verifies `join:<contract>` signature.
  - Validates `hasAccess` against the contract (on-chain read via ethers).
  - Adds the member’s inboxId to the group. If `memberInboxId` is provided, it is used directly; otherwise the server resolves via `findInboxIdByIdentifier` and waits for identity readiness before inviting.
  - Re-syncs and sends a `member-joined` message for the UI.
  - Returns `groupId` but does not persist membership to SQLite.
- **POST/DELETE `/delegateMute`, POST `/mute`**
  - Update the SQLite tables as described above.
- **XMTP Identity, Installations, and Nonce**
  - One inboxId per identity (EOA/SCW) representing the user on XMTP.
  - Installations represent devices/agents; dev network installs are capped at 10.
  - The signer’s `getIdentifier()` can include a `nonce`. Changing the nonce rotates to a fresh installation under the same inboxId.
  - Node: the DB is a real file; reusing the same `dbEncryptionKey` and inboxId attaches to the existing local database.
  - Browser: the DB is in OPFS; repeated client creation with different nonces can create repeated installations and may conflict with OPFS access handles.
