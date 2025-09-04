# Core Flow Service Diagrams

Components and message flows powering TEMPL's core protocol.

## Flow overview
- [1. Templ creation](#1-templ-creation)
- [2. Pay-to-join](#2-pay-to-join)
- [3. Messaging](#3-messaging)
- [4. Moderation](#4-moderation)
- [5. Proposal creation](#5-proposal-creation)
- [6. Voting](#6-voting)
- [7. Proposal execution](#7-proposal-execution)

## Actors & Legend
- Frontend: Browser app where users deploy, join, chat, and govern.
- Backend: Node service that owns the group, verifies chain state, and moderates.
- Smart Contract: TEMPL logic (treasury, member pool, voting).
- XMTP: Messaging network.
- SQLite: Backend DB for groups, delegates, and mutes.

Legend: F=Frontend, B=Backend, C=Contract, X=XMTP, D=SQLite, M=Member, P=Priest.

## 1. Templ creation
The backend bot creates and owns the XMTP group when a TEMPL is deployed.
```mermaid
flowchart LR
    F[Frontend] -->|deploy contract| C[Smart Contract]
    F -->|POST /templs| B[Backend]
    B -->|newGroup| X[XMTP]
```

- Frontend posts `{contract, priestInboxId?}`; backend resolves inbox if needed, creates the group, adds the priest, and stores the `groupId`.

## 2. Pay-to-join
Members sign a join message, and the backend verifies purchase before inviting them.
See [CONTRACTS.md#economic-model](CONTRACTS.md#economic-model) for membership fee split details.
```mermaid
flowchart LR
    F[Frontend] -->|purchaseAccess| C[Smart Contract]
    F -->|POST /join| B[Backend]
    B -->|addMembers| X[XMTP]
```

- Backend may send a small "member-joined" message to aid discovery.

Sequence detail:
The contract purchase and backend invite flow proceeds as follows.
```mermaid
sequenceDiagram
    participant F as Frontend
    participant C as Contract (TEMPL)
    participant B as Backend
    participant X as XMTP
    F->>C: approve(ERC20) + purchaseAccess()
    C-->>F: membership granted
    F->>B: POST /join {contract, member, signature, [memberInboxId]?}
    B->>C: hasAccess(member)
    C-->>B: true
    B->>X: addMembers([inboxId])
    B-->>F: { groupId }
    F->>X: sync and discover conversation
```

## 3. Messaging
Members send messages directly to the XMTP group.
```mermaid
flowchart LR
    M[Member] -->|send message| X[XMTP Group]
```

Discovery
- After joining, browser clients sync conversations and preferences until the group is found.

## 4. Moderation
The backend enforces escalating mutes and allows delegated moderation.
```mermaid
flowchart LR
    P[Priest] -->|POST /delegates| B[Backend]
    P -->|POST /mute| B
    M[Delegate] -->|POST /mute| B
    F[Frontend] -->|GET /mutes| B
    B -->|store| D[(SQLite)]
```

- Mutes escalate in duration.
- The priest can delegate mute power to other members.
- Frontends hide messages from muted members.

Sequence detail:
The moderation process from delegation to mute proceeds as follows.
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
The backend mirrors on-chain proposal events into the XMTP group.
```mermaid
flowchart LR
    M[Member] -->|createProposal| C[Smart Contract]
    C -->|ProposalCreated event| B[Backend]
    B -->|send proposal JSON| X[XMTP Group]
```

Notes
- The backend adds members by inboxId only and linearizes invites by waiting for inbox readiness on XMTP before adding.
- After group creation/join, the backend syncs and records network stats. A small warm message may be sent.

## 6. Voting
Members vote on proposals and the backend broadcasts vote events.
```mermaid
flowchart LR
    M[Member] -->|vote| C[Smart Contract]
    C -->|VoteCast event| B[Backend]
    B -->|send vote JSON| X[XMTP Group]
```

## 7. Proposal execution
Execution is limited to an allowlisted set of contract functions.
```mermaid
flowchart LR
    M[Member] -->|executeProposal| C[Smart Contract]
    C -->|call allowlisted action| C
```

- Only pause/unpause, config updates, and treasury transfers are permitted.
- Arbitrary external calls are disabled.

End-to-end proposal lifecycle (sequence):
This sequence shows proposal creation, voting, and execution across the system.
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

## Proposal lifecycle with treasury movement
```mermaid
sequenceDiagram
    participant M as Member
    participant C as Contract (TEMPL)
    participant B as Backend
    participant X as XMTP
    participant T as Treasury
    participant R as Recipient
    M->>C: createProposal(withdrawTreasuryDAO(R, amount))
    C-->>B: ProposalCreated(id,...)
    B->>X: send {type:"proposal", id, ...}
    M->>C: vote(id, support)
    C-->>B: VoteCast(id, voter, support,...)
    B->>X: send {type:"vote", id, voter, support, ...}
    M->>C: executeProposal(id)
    C->>T: withdrawTreasury(amount)
    T->>R: transfer(amount)
    C-->>M: ProposalExecuted(id, success)
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
