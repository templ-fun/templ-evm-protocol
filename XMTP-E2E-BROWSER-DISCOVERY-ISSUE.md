## XMTP Browser Discovery After Join — Complete Repro + Evidence

This document provides an exact, minimal reproduction and the evidence we collect when the Browser SDK does not surface a group after the server adds the member (the “add‑after‑creation” path). It also shows a passing local repro for comparison and a template to send to XMTP support.

### Summary
- At group creation time (browser included as a member): Browser SDK discovers immediately (prod + local).
- When the backend adds the browser after creation: On production, the browser sometimes doesn’t surface the conversation quickly even after the server sends a welcome and syncs. On XMTP Local Node, the minimal repro discovers in ~1s.

### SDK Versions
- Browser: `@xmtp/browser-sdk@4.1.0`
- Node: `@xmtp/node-sdk@4.1.0`
- App Version header: `templ/0.1.0`

---

## Repro A (Local, deterministic) — Add‑After‑Creation Passes

Use XMTP Local Node to eliminate external variables and capture logs.

Prereqs:
- Docker running
- Node v22.18.0

Steps:
1) Start XMTP local node and tail logs
   ```bash
   npm run xmtp:local:up
   (cd xmtp-local-node && docker compose logs -f)
   ```
2) Run the minimal add‑after‑join repro test
   ```bash
   E2E_XMTP_LOCAL=1 E2E_XMTP_ENV=local \
     npm --prefix frontend run test:e2e -- --project=tech-demo --grep "add-after-join minimal repro"
   ```
3) Expected output (sample):
   - Console (from the test):
     - `REPRO: Browser inboxId= <hex>`
     - `REPRO: Server created group <groupId> serverInbox= <hex>`
     - Node aggregate stats BEFORE and AFTER `group.addMembers([browserInboxId])`:
       - AFTER shows `SendWelcomeMessages` incremented and `QueryWelcomeMessages` incremented.
     - `REPRO: discovery result { ok: true, attempt: 1, byId: true }`

Self‑contained minimal repro (conceptual code)

Node (env=local):
```ts
import { Client as NodeClient } from '@xmtp/node-sdk';
import { ethers } from 'ethers';

const env = 'local'; // API http://localhost:5556 (node), history http://localhost:5558
const dbEncryptionKey = new Uint8Array(32);

// Create a Node client with an EOA-like signer
const wallet = ethers.Wallet.createRandom();
const xmtp = await NodeClient.create({
  type: 'EOA',
  getIdentifier: () => ({ identifier: wallet.address.toLowerCase(), identifierKind: 0, nonce: 1 }),
  signMessage: async (msg) => ethers.getBytes(await wallet.signMessage(typeof msg === 'string' ? msg : ethers.toBeHex(msg)))
}, { env, dbEncryptionKey, loggingLevel: 'off', appVersion: 'templ/repro-0.1.0' });

// Create a group without the browser member
let group = await xmtp.conversations.newGroup([]).catch(async () =>
  xmtp.conversations.newGroup([xmtp.inboxId])
);
const groupId = group.id; // hex, no 0x
await xmtp.conversations.sync();

// Add the browser member after creation and send a warm message
await group.addMembers([browserInboxId /* hex */]);
await xmtp.conversations.sync();
await group.send('warm');

// Optional: print Node aggregate stats
console.log(xmtp.debugInformation.apiAggregateStatistics());
```

Browser (env=local):
```ts
import { Client } from '@xmtp/browser-sdk';

// Create a Browser client with an EOA-like signer that calls window.ethereum for signatures
const address = await window.ethereum.request({ method: 'eth_requestAccounts' }).then(a => a[0]);
const signer = {
  type: 'EOA',
  getIdentifier: () => ({ identifier: address.toLowerCase(), identifierKind: 'Ethereum', nonce: 1 }),
  signMessage: async (message) => {
    const data = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const sig = await window.ethereum.request({ method: 'personal_sign', params: [data, address] });
    return ethers.getBytes(sig);
  }
};
const client = await Client.create(signer, { env: 'local', appVersion: 'templ/repro-0.1.0' });

// Discovery sequence after server addMembers(...)
await client.conversations.sync();
await client.preferences.sync();
await client.preferences.inboxState(true);
await client.conversations.syncAll(['allowed','unknown','denied']);

// Try to resolve by id; repeat a few times if needed
const wanted = groupId; // hex without 0x
const byId = await client.conversations.getConversationById(wanted);
if (!byId) {
  const list = await client.conversations.list({ consentStates: ['allowed','unknown','denied'] });
  const found = list.find(c => c.id === wanted);
  console.log('found?', Boolean(found));
}

// Optional: print Browser aggregate stats
console.log(await client.debugInformation.apiAggregateStatistics());
```

Evidence to attach if needed:
- Node stats before/after add (printed by the test): shows SendWelcomeMessages and QueryWelcomeMessages increments.
- Exact IDs: `groupId` (hex, no 0x), `browserInboxId`, `serverInboxId`.
- Docker logs captured from `xmtp-local-node`.

---

## Repro B (Production) — Full App Flow Sometimes Misses Discovery

Run the full core flows (server creates group; browser joins; server adds member by inboxId; server syncs; warm send).

Steps:
```bash
npm --prefix frontend run test:e2e -- --project=tech-demo --grep "All 7 Core Flows"
```

What happens:
- Backend logs (added instrumentation):
  - `Inviting member by inboxId` with the resolved inboxId
  - `addMembers([inboxId]) succeeded`
  - `Server conversations synced after join`
- Browser discovery loop (instrumented):
  - Calls in order: `conversations.sync()` → `preferences.sync()` → `preferences.inboxState(true)` → `conversations.syncAll(['allowed','unknown','denied'])` → `getConversationById(id)` and `list({ consentStates })`, with short windows of `streamGroups()` and `streamAllMessages()`.
  - Aggregated Browser network stats printed when `VITE_E2E_DEBUG=1`: pay attention to `QueryWelcomeMessages`, `SubscribeWelcomes`, and attempts.

Evidence to collect on production:
- Backend logs around `/join`:
  - `Inviting member by inboxId ...`
  - `addMembers([inboxId]) succeeded`
  - `Server conversations synced after join`
  - Group id returned to the browser
- Browser console output (from Playwright):
  - Aggregate stats after each `conversations.sync()` (we log this in dev/e2e): look for `QueryWelcomeMessages`, `SubscribeWelcomes`.
  - Attempts and timestamps for `getById` and `list()` checks.
- Debug endpoints (when enabled):
  - `GET http://localhost:3001/debug/group?contractAddress=<addr>&refresh=1` → serverInboxId, stored/resolved groupId
  - `GET http://localhost:3001/debug/conversations` → count and first group IDs

Note: For pure discovery evidence on your side, disable any server “send” fallbacks and rely solely on the Browser SDK.

---

## Findings (So Far)

- PoC with browser added at creation discovers instantly (prod + local).
- Minimal add‑after‑join repro passes on local (deterministic); Node stats show welcome/query increments.
- Full app flow on production can miss discovery in the “add‑after‑creation” window despite the server’s add+sync+warm.

---

## Support Request (For XMTP Devs)

Subject: Browser SDK does not reliably surface group after addMembers; creation-time works; local repro passes

Context:
- Browser: @xmtp/browser-sdk 4.1.0; Node: @xmtp/node-sdk 4.1.0; appVersion templ/0.1.0
- Production vs Local Node: at-creation is instant in both; add-after-creation passes on local but sometimes not on production within the window.

Ask:
- Confirm the expected client call sequence for deterministic discovery post‑add.
- Verify whether production infra can delay surfacing welcomes/groups after addMembers and whether additional calls are recommended.

Attach:
- Minimal repro logs (local):
  - Node aggregate stats before/after add (show `SendWelcomeMessages`/`QueryWelcomeMessages` increment).
  - groupId, browserInboxId, serverInboxId.
- Full flow logs (production):
  - Backend logs around `/join`: inboxId used, addMembers success, server sync confirmation, groupId.
  - Browser aggregate stats after explicit syncs and attempts log (counts for `QueryWelcomeMessages` and `SubscribeWelcomes`).
  - Debug endpoints output `/debug/group`, `/debug/conversations`.

---

## Appendix — Pointers (no repo access required)

- XMTP Local Node: https://github.com/xmtp/xmtp-local-node (exposes API :5555 / :5556, history :5558)
- Node SDK: https://www.npmjs.com/package/@xmtp/node-sdk
- Browser SDK: https://www.npmjs.com/package/@xmtp/browser-sdk

---

## GitHub Issue — Ready‑To‑Paste Template

Title: Browser SDK does not reliably surface group after addMembers; creation‑time works; local repro passes

Body:

```
Summary
———
When a member is added to an existing group via Node SDK `group.addMembers([inboxId])`, the Browser SDK does not always surface the conversation promptly on production, even after a server warm message. At group creation time (browser included), discovery is instant. A minimal add‑after‑join repro against XMTP Local Node passes and discovers within ~1s.

Environments & Versions
———
- Browser: @xmtp/browser-sdk 4.1.0
- Node:    @xmtp/node-sdk    4.1.0
- AppVersion: templ/0.1.0
- Production endpoints (default SDKs) and XMTP Local Node (API :5555, history :5558)

Expected
———
After `group.addMembers([browserInboxId])` and server warm send, Browser SDK should discover via `conversations.sync()` + `getConversationById(id)` / `list()` within a few seconds.

Actual
———
- Production (full app flow): sometimes the browser does not surface the group within the window after join. Server logs confirm successful `addMembers`, post‑add `conversations.sync()`, and warm message sending.
- Local Node (minimal repro): add‑after‑join discovers within ~1s.

Local Minimal Repro (passes)
———
1) Start XMTP local node and tail logs:
   npm run xmtp:local:up
   (cd xmtp-local-node && docker compose logs -f)
2) Run repro:
   E2E_XMTP_LOCAL=1 E2E_XMTP_ENV=local \\
     npm --prefix frontend run test:e2e -- --project=tech-demo --grep "add-after-join minimal repro"
3) Behavior: Browser discovers by id (attempt ~1). Node aggregate stats show `SendWelcomeMessages`/`QueryWelcomeMessages` increment.

Browser Client Calls Used For Discovery
———
conversations.sync()
preferences.sync()
preferences.inboxState(true)
conversations.syncAll(["allowed","unknown","denied"])
conversations.getConversationById(groupId)
conversations.list({ consentStates:["allowed","unknown","denied"] })
streamGroups() and streamAllMessages() for short windows

IDs (paste actual values)
———
- groupId (hex, no 0x):  <groupId_here>
- browserInboxId:        <browserInboxId_here>
- serverInboxId:         <serverInboxId_here>
- timestamps (ISO):      <ts_invite> <ts_browser_sync_start> <ts_browser_getById_attempts>

Server Logs (prod)
———
Paste snippets around /join:
- Inviting member by inboxId: <hex>
- addMembers([inboxId]) succeeded
- Server conversations synced after join
- Warm message sent (if logged)
- Group id returned: <groupId>

Node Aggregate Stats (local repro)
———
Paste BEFORE and AFTER `group.addMembers([browserInboxId])` (from @xmtp/node-sdk debugInformation.apiAggregateStatistics):

BEFORE:
============ Api Stats ============
UploadKeyPackage        X
FetchKeyPackage         X
SendGroupMessages       X
SendWelcomeMessages     X
QueryGroupMessages      X
QueryWelcomeMessages    X
... (rest of dump)

AFTER:
============ Api Stats ============
UploadKeyPackage        X
FetchKeyPackage         X+Δ
SendGroupMessages       X+Δ
SendWelcomeMessages     X+1  <-- increments
QueryGroupMessages      X
QueryWelcomeMessages    X+Δ  <-- increments
... (rest of dump)

Browser Aggregate Stats (prod run)
———
Paste dumps captured after conversations.sync attempts (via client.debugInformation.apiAggregateStatistics):
============ Api Stats ============
UploadKeyPackage        ...
FetchKeyPackage         ...
SendGroupMessages       ...
SendWelcomeMessages     ...
QueryGroupMessages      ...
QueryWelcomeMessages    ...  <-- watch this value
SubscribeMessages       ...
SubscribeWelcomes       ...  <-- and this
============ Identity ============
PublishIdentityUpdate    ...
GetIdentityUpdatesV2     ...
GetInboxIds             ...
============ Stream ============
SubscribeMessages        ...
SubscribeWelcomes        ...

Notes / Questions
———
- Is this call sequence sufficient to deterministically surface the group post‑join?
- Could production infra delay welcome/conversation surfacing after addMembers? If yes, recommended mitigation?
- Any additional calls or options we should use to guarantee discovery (e.g., explicit welcome queries)?

Code references (for your context)
———
- Minimal repro test: frontend/e2e/xmtp-add-after-join.pw.spec.js
- Browser discovery loop: frontend/src/App.jsx
- Backend invite path: backend/src/server.js (logs inboxId used and post‑add sync)
```
