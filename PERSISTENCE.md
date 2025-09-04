# Persistence Overview

This document explains every place we persist state across the TEMPL stack, how XMTP client storage works in Node versus the browser, what OPFS is, and why this matters for end-to-end (E2E) versus integration tests. If you understand the smart contract but not how XMTP storage is wired, start here.

## Backend DB

The backend service uses a SQLite database to map TEMPL contracts to their XMTP group IDs and to track moderation. A lightweight in-memory cache mirrors the groups table so the server can restore state on boot. During E2E runs the database path can be overridden or cleared.

- File: `backend/groups.db` by default. In E2E we override with `DB_PATH=e2e-groups.db` and clear it when `CLEAR_DB=1`.
- Tables and meaning:
  - `groups(contract TEXT PRIMARY KEY, groupId TEXT, priest TEXT)`
    - Maps on-chain TEMPL contract address to the XMTP group conversation ID and the priest’s EOA address.
    - Written on POST `/templs` (initial group registration). Re-read at server boot to restore in-memory cache.
  - `mutes(contract TEXT, target TEXT, count INTEGER, until INTEGER, PRIMARY KEY(contract, target))`
    - Stores moderation strikes and mute expiry for each address per TEMPL contract. Written on POST `/mute`.
  - `delegates(contract TEXT, delegate TEXT, PRIMARY KEY(contract, delegate))`
    - Stores which addresses are delegated moderation powers by the priest. Written on POST/DELETE `/delegates`.
- In-memory cache: a `Map()` mirrors `groups` records with `{ group, groupId, priest }`. The `group` object is the live XMTP group handle. On boot, the server tries to resolve each `groupId` via XMTP and populate the cache.

## XMTP Node DB

The XMTP Node SDK persists client identity and message metadata in SQLCipher databases stored in the process's working directory. Each inboxId uses one database that can be reused across runs, and the database is encrypted when provided a 32‑byte key. Both the backend service and integration tests rely on this storage.

- Files: `xmtp-<env>-<inboxId>.db3` (+ `-wal`/`-shm`) in the process CWD. You'll see these at repo root during dev (e.g., `xmtp-dev-<hash>.db3`).
- Encryption: SQLCipher when a `dbEncryptionKey` is provided. The Browser SDK does NOT encrypt.
- Purpose: stores the client’s identity state, installations, and conversation/message metadata. It is not our schema; it's managed by the XMTP SDK.
- Identity model:
  - `inboxId`: stable per “user” on XMTP, derived from the identity ledger for an EOA/SCW.
  - Installations: each inbox can have multiple installations (devices/agents). On the dev network, installs are limited (10 installations per inbox).
  - When creating an XMTP client, the Node SDK locates/creates a local DB for the inboxId and reuses it.

## XMTP Browser DB

The Browser SDK stores its SQLite database inside the Origin Private File System (OPFS), a per-origin sandbox not visible on the host OS. OPFS uses exclusive access handles, so creating multiple clients or rapidly opening and closing handles can trigger `NoModificationAllowedError`. The browser implementation cannot encrypt the database even when a key is supplied.

- Storage: OPFS via the browser’s Storage Foundation API.
- Path: the SDK still names the DB like `xmtp-dev-<inboxId>.db3` but it lives inside OPFS, not on disk.
- Encryption: none (Browser SDK cannot use `dbEncryptionKey` for actual encryption).
- Important behavior:
  - OPFS uses “synchronous access handles” that are exclusive. If two handles or a writable stream are opened for the same file, further attempts can fail with `NoModificationAllowedError: createSyncAccessHandle` until the handle is released.
  - Don’t spin up multiple XMTP clients for the same inboxId concurrently in the browser.
  - Avoid repeatedly creating and tearing down clients in quick succession, which increases the chance of handle contention.
  - Prefer a single client per page lifecycle and reuse a stable installation.

## Data Flows

Several HTTP endpoints coordinate how data enters and leaves the system. The server writes to SQLite when groups are registered and updates moderation tables for delegate or mute actions. XMTP identity resolution and membership are managed by the XMTP network, not the backend database.

```mermaid
flowchart TD
    onchain["Contract events
    (create/join/delegate/mute)"] --> api["Backend handlers
    (/templs, /join, /delegates, /mute)"]
    api --> sqlite[("SQLite groups.db")]
    api --> xmtpNode[("XMTP Node DB
    `xmtp-<env>-<inboxId>.db3`")]
    xmtpNode <--> xmtpBrowser[("XMTP Browser DB
    OPFS `xmtp-<env>-<inboxId>.db3`")]
```

- POST `/templs` (create/register a TEMPL group)
  - Verifies the priest’s signature `create:<contract>`.
  - Creates a new XMTP group with the priest. If `priestInboxId` is provided it is used; otherwise the server resolves the inbox on the XMTP network via `findInboxIdByIdentifier` and waits for identity readiness before inviting. No deterministic/fake inbox IDs are generated by the server.
  - Optionally sets group metadata (name/description), tolerating the SDK’s “success reported as error” edge cases.
  - Sends a warm-up message to introduce initial activity.
  - Persists `{ contract, groupId, priest }` to SQLite and to the in-memory `groups` cache.
- POST `/join` (purchase check + add member to XMTP group)
  - Verifies `join:<contract>` signature.
  - Validates `hasAccess` against the contract (on-chain read via ethers).
  - Adds the member’s inboxId to the group. If `memberInboxId` is provided, it is used directly; otherwise the server resolves via `findInboxIdByIdentifier` and waits for identity readiness before inviting.
  - Re-syncs and sends a `member-joined` message to give the UI fresh content to discover.
  - Returns `groupId` but does NOT persist membership to our DB (membership is managed by XMTP/the group itself).
- POST/DELETE `/delegates`, POST `/mute`
  - Update the SQLite tables as described above.
- XMTP Identity, Installations, and Nonce
  - One inboxId per identity (EOA/SCW) representing the “user” on XMTP.
  - Installations represent devices/agents; dev network installs are capped at 10.
  - The signer’s `getIdentifier()` can include a `nonce`. Changing the nonce rotates to a fresh installation under the same inboxId.
  - Node: the DB is a real file you can see. Reusing the same `dbEncryptionKey` and inboxId attaches to the existing local database and doesn’t require creating a new installation each time.
  - Browser: the DB is in OPFS and cannot be seen directly by the OS. Repeatedly creating clients with different nonces can create repeated installations, and frequent create/dispose cycles may conflict with OPFS access handles.

## FAQ

This section answers common questions about what data is stored and why certain errors appear. It clarifies that chat messages and membership live in XMTP and explains common OPFS and test pitfalls.

- **Do we persist chat messages?**
  - No. Messages live in XMTP’s network + the client DB (OPFS in browser; SQLCipher DB on Node). Our backend doesn’t store chat messages.
- **Where is the “group membership” stored?**
  - In XMTP. We only store the mapping from TEMPL contract → `groupId` and the priest address. Adding/removing members happens via the XMTP group APIs and is reflected in the XMTP databases, not our SQLite.
- **Why did we see `NoModificationAllowedError` in E2E?**
  - That’s OPFS rejecting a new exclusive write handle to the DB while another handle or stream is still open. It’s a browser storage-level contention, not an XMTP core or contract issue.
- **Is this a protocol bug?**
  - No. Integration proves join works end-to-end at the protocol level using Node SDK. The E2E failures were due to Browser SDK storage/installation patterns and test-time storage manipulation.

## Testing

Integration tests run entirely in Node and are deterministic, while E2E tests exercise the browser SDK and can fail due to install limits or OPFS handle issues. The following notes outline the differences and provide strategies to avoid flakiness. Choose the approach that best fits your testing goals.

- Integration tests (Vitest)
  - Run entirely in Node. They use the Node SDK for XMTP clients and an in-process backend. The Node SDK writes to on-disk SQLCipher DBs, not OPFS. There are no browser access-handle conflicts.
  - The tests create fresh random wallets (new EOAs) for priest/member/delegate each run, so they don’t hit the dev network’s 10-installation cap.
  - Result: Deterministic, no OPFS, no install exhaustion → group joining passes.
- E2E tests (Playwright)
  - Use the Browser SDK inside Chromium. Our UI previously rotated installation nonces in the browser to “recover” from the dev install cap. Combined with reusing the same fixed Hardhat accounts and actively clearing OPFS/IndexedDB between candidate wallets, this produced two failure modes:
    1. XMTP dev “10/10 installations reached” for the reused wallet’s inboxId.
    2. OPFS `createSyncAccessHandle` errors due to rapid client re-creation and storage churn during rotation.
  - Result: Client initialization would fail before the app could join the group, causing the test to fail at “Failed to initialize XMTP for any candidate wallet”.
- Mitigations and recommended patterns
  - Stable installation (preferred in browser)
    - Use a stable, persisted nonce per wallet address for Browser SDK clients. Reuse the same installation and OPFS DB across runs. This avoids hitting the install cap and reduces OPFS handle churn.
    - This repo now uses that approach in the app: the nonce is read/written in `localStorage` and reused.
  - Ephemeral wallets for tests (simple and robust)
    - Generating a brand-new EOA for the UI per E2E run completely avoids previous installation caps for that address. Fund it from Hardhat.
    - Trade-offs:
      - Pros: clean state, no need to rotate installations, no risk of historical caps.
      - Cons: if you depend on reusing the same inboxId across runs, you lose that continuity.
    - We can toggle this in Playwright fixtures to use fresh random wallets instead of fixed Hardhat accounts.
  - Avoid aggressive OPFS clearing & multiple client attempts
    - If possible, do not clear OPFS between wallet attempts on the same page. Prefer selecting the wallet once and letting the app reuse the same installation.
    - Ensure one XMTP client per page lifecycle in the browser. If you must switch wallets, fully reload or close the previous client if the SDK exposes it.
  - Backend (Node) notes
    - The backend also creates an XMTP Node client. Because the inboxId is stable for the bot’s address, the Node SDK reuses the same local DB between runs. The code includes an installation-rotation fallback but typically does not need to create new installs if the DB and inbox are intact.
    - The backend’s own SQLite (`groups.db`) is unrelated to XMTP’s DB. It’s safe to clear between runs in E2E via `DB_PATH` and `CLEAR_DB` without affecting XMTP identity.

