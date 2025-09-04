# Core Flow Service Diagrams

This document illustrates the components, endpoints, and message flows that power TEMPL’s core protocol functions. It includes visual diagrams and concrete request/response formats so auditors and implementers can understand every moving part.

## Actors & Legend
- Frontend: Browser app (XMTP Browser SDK) where users deploy, join, chat, and govern.
- Backend: Node service (XMTP Node SDK) that owns the group, verifies on-chain state, and manages moderation.
- Smart Contract: TEMPL on-chain logic (treasury, member pool, voting, execution allowlist).
- XMTP: Messaging network (env: local|dev|production).
- SQLite: Backend persistence for groups, delegates, and mutes.

Legend in diagrams: F = Frontend, B = Backend, C = Smart Contract, X = XMTP, D = SQLite.

## 1. Templ creation
```mermaid
flowchart LR
    F[Frontend] -->|deploy contract| C[Smart Contract]
    F -->|POST /templs| B[Backend]
    B -->|newGroup| X[XMTP]
```

During Templ creation the backend's bot wallet creates and owns the XMTP group:

- The frontend sends the deployed contract address and the priest's inbox ID to the backend via `POST /templs`. If the inbox ID isn't provided, the backend resolves it on the XMTP network via `findInboxIdByIdentifier` and waits for the identity to be visible before inviting. No deterministic/fake inbox IDs are used.
- The backend calls `newGroup` on XMTP, adds the priest as a member, and records the resulting group ID.
- Group ownership remains with the backend service; the priest does not control the group.

## 2. Pay-to-join
```mermaid
flowchart LR
    F[Frontend] -->|purchaseAccess| C[Smart Contract]
    F -->|POST /join| B[Backend]
    B -->|addMembers| X[XMTP]
```

The frontend signs `join:<contractAddress>` and the backend verifies purchase on‑chain before adding the member. The backend may send a small "member-joined" message to help clients discover the group.

Sequence detail:
```mermaid
sequenceDiagram
    participant F as Frontend
    participant C as Contract (TEMPL)
    participant B as Backend
    participant X as XMTP
    F->>C: approve(ERC20) + purchaseAccess()
    C-->>F: membership granted
    F->>B: POST /join {contract, member, signature, [memberInboxId]?}
    B->>C: hasPurchased(member)
    C-->>B: true
    B->>X: addMembers([inboxId])
    B-->>F: { groupId }
    F->>X: sync and discover conversation
```

## 3. Messaging
```mermaid
flowchart LR
    M[Member] -->|send message| X[XMTP Group]
```

Discovery
- After a member joins, browser clients explicitly call `conversations.sync()` to fetch new welcomes, followed by `preferences.sync()` and `conversations.syncAll([...])`, and then poll/stream until the group is found. The UI requires discovery.

## 4. Moderation
The backend tracks mutes with escalating durations. The priest can delegate
mute power to other members. Frontends hide messages from muted members.

```mermaid
flowchart LR
    P[Priest] -->|POST /delegates| B[Backend]
    P -->|POST /mute| B
    M[Delegate] -->|POST /mute| B
    F[Frontend] -->|GET /mutes| B
    B -->|store| D[(SQLite)]
```

Sequence detail:
```mermaid
sequenceDiagram
    participant P as Priest
    participant B as Backend
    participant D as SQLite
    P->>B: POST /delegates {contract, priest, delegate, signature}
    B->>D: upsert delegate
    P-->>B: 200 { delegated: true }
    P->>B: POST /mute {contract, moderator, target, signature}
    B->>D: get strike count -> compute until
    D-->>B: count, until
    B-->>P: 200 { mutedUntil }
```

## 5. Proposal creation
```mermaid
flowchart LR
    F[Member] -->|createProposal| C[Smart Contract]
    C -->|ProposalCreated event| B[Backend]
    B -->|send proposal JSON| X[XMTP Group]
```

The backend watches on‑chain events and mirrors them into the group as JSON payloads so clients can render proposal and vote updates in real time.

Notes
- The backend adds members by inboxId only and linearizes invites by waiting for inbox readiness on XMTP before adding.
- After group creation/join, the backend syncs and records network stats. A small warm message may be sent.

## 6. Voting
```mermaid
flowchart LR
    F[Member] -->|vote| C[Smart Contract]
    C -->|VoteCast event| B[Backend]
    B -->|send vote JSON| X[XMTP Group]
```

## 7. Proposal execution
```mermaid
flowchart LR
    F[Member] -->|executeProposal| C[Smart Contract]
    C -->|call allowlisted action| C
```
Execution is restricted to an allowlist of contract functions (pause/unpause, config updates, and treasury transfers of the TEMPL‑denominated token). Arbitrary external calls are disabled.

End-to-end proposal lifecycle (sequence):
```mermaid
sequenceDiagram
    participant M as Member
    participant C as Contract (TEMPL)
    participant B as Backend
    participant X as XMTP
    M->>C: createProposal(title, description, callData, period)
    C-->>M: ProposalCreated(id,...)
    C-->>B: ProposalCreated(id,...)
    B->>X: send {type:"proposal", id, ...}
    M->>C: vote(id, support)
    C-->>B: VoteCast(id, voter, support,...)
    B->>X: send {type:"vote", id, voter, support, ...}
    M->>C: executeProposal(id)
    C-->>M: ProposalExecuted(id, success)
```

## Purchase Distribution (On-Chain)
```mermaid
sequenceDiagram
    participant U as User
    participant C as Contract (TEMPL)
    participant Burn as Burn (0xdead)
    participant T as Treasury
    participant P as Member Pool
    participant R as Protocol
    U->>C: purchaseAccess()
    C->>Burn: 30% burn
    C->>T: 30% treasury
    C->>P: 30% pool
    C->>R: 10% protocol
    C-->>U: membership recorded
```

## Backend Endpoints & Signatures
- POST `/templs` – create group for a deployed TEMPL
  - Signature: `create:<contract>` signed by priest EOA.
  - Body: `{ contractAddress, priestAddress, signature, priestInboxId? }`
  - Response: `{ groupId }`
- POST `/join` – verify purchase and invite member
  - Signature: `join:<contract>` signed by member EOA.
  - Body: `{ contractAddress, memberAddress, signature, memberInboxId? }`
  - Response: `{ groupId }` or HTTP 503 until identity is visible on XMTP.
- POST `/delegates` – grant mute rights
  - Signature: `delegate:<contract>:<delegate>` signed by priest EOA.
  - Body: `{ contractAddress, priestAddress, delegateAddress, signature }`
  - Response: `{ delegated: true }`
- DELETE `/delegates` – revoke mute rights
  - Same signature format; `{ delegated: false }` on success.
- POST `/mute` – escalate mute for a target
  - Signature: `mute:<contract>:<target>` signed by priest or a delegate.
  - Response: `{ mutedUntil }` (ms since epoch; 0 means permanent after 5th strike).
- GET `/mutes?contractAddress=...` – list active mutes: `{ mutes: [{ address, count, until }] }`
- Debug (when `ENABLE_DEBUG_ENDPOINTS=1`): `/debug/group`, `/debug/conversations`, `/debug/membership`, `/debug/last-join`, `/debug/inbox-state`.

Backend resolves inboxIds from the XMTP network via `findInboxIdByIdentifier` and waits for identity readiness before `addMembers`. No deterministic/fake inboxIds are generated by the server.

## Governance Allowlist & Rules
- Proposal actions are restricted to an allowlist enforced at creation and execution:
  - `setPausedDAO(bool)`
  - `updateConfigDAO(address,uint256)`
  - `withdrawTreasuryDAO(address,uint256,string)`
  - `withdrawAllTreasuryDAO(address,string)`
  - `sweepMemberRewardRemainderDAO(address)`
- Voting: 1/member; priest weight = `priestVoteWeight` while `members.length < priestWeightThreshold`, else 1.
- Anti‑flash: voters must have joined before `proposal.createdAt`.
- Majority: `yesVotes > noVotes`, anyone may execute after `endTime`.

## Data & Storage
- SQLite tables:
  - `groups(contract TEXT PRIMARY KEY, groupId TEXT, priest TEXT)`
  - `mutes(contract TEXT, target TEXT, count INTEGER, until INTEGER, PRIMARY KEY(contract, target))`
  - `delegates(contract TEXT, delegate TEXT, PRIMARY KEY(contract, delegate))`
- XMTP client DBs:
  - Node: `xmtp-<env>-<inboxId>.db3` (SQLCipher when `dbEncryptionKey` provided).
  - Browser: OPFS per-origin; not OS-visible.

## Errors, Retries & Discovery
- `/join` may return HTTP 503 until the member identity is visible on XMTP; the frontend should retry.
- Browsers discover the group by calling `conversations.sync()`, `preferences.sync()`, `conversations.syncAll([...])` and polling/streaming for the conversation id.
