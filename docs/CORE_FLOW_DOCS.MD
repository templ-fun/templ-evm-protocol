# Core Flow Diagrams (Telegram Edition)

Use this reference to see how the contracts, backend API, frontend, and Telegram notifier interact today. Every section pairs a flowchart with a sequence diagram so you can choose the view that fits your debugging or onboarding moment.

## Actors

- **Frontend (F)** – Vite + React app in the browser.
- **Backend (B)** – Express server handling signatures, persistence, and Telegram notifications.
- **Contract (C)** – On-chain templ instance.
- **Telegram (T)** – Bot-backed delivery of templ events (optional).
- **Cloudflare D1 (D)** – Serverless binding store (contract ↔ Telegram chat id) with an in-memory fallback for local runs.
- **Member (M)** / **Priest (P)** – Participants initiating actions.

## 1. Templ creation

```mermaid
flowchart LR
    F[Frontend];
    B[Backend];
    C[Contract];
    D[(Cloudflare D1)];
    F -->|"factory.createTemplWithConfig"| C;
    F -->|"POST /templs"| B;
    B -->|"verify contract/priest (optional)"| C;
    B -->|"persist templ binding"| D;
    B -->|"register watcher"| C;
```

Sequence:

```mermaid
sequenceDiagram
    participant F as Frontend
    participant C as Contract
    participant B as Backend
    participant D as Cloudflare D1
    F->>C: createTemplWithConfig(...)
    C-->>F: templAddress
    F->>B: POST /templs {contract, priest, telegramChatId?, signature}
    B->>C: ensureContractDeployed (prod / REQUIRE_CONTRACT_VERIFY)
    B->>C: ensurePriestMatchesOnChain (prod / REQUIRE_CONTRACT_VERIFY)
    B->>D: upsert templ binding
    B->>C: start listening for events
    B-->>F: 200 { templ:{...}, bindingCode? }
```

## 2. Pay-to-join + verification

```mermaid
flowchart LR
    F[Frontend];
    B[Backend];
    C[Contract];
    F -->|"purchaseAccess"| C;
    F -->|"POST /join"| B;
    B -->|"hasAccess(member)"| C;
    C -->|"true/false"| B;
    B -->|"respond with templ links"| F;
```

Sequence:

```mermaid
sequenceDiagram
    participant F as Frontend
    participant C as Contract
    participant B as Backend
    F->>C: approve + purchaseAccess()
    C-->>F: tx receipt (member counted)
    F->>B: POST /join {contract, member, signature}
    B->>C: hasAccess(member)?
    C-->>B: true
    B-->>F: { member:{hasAccess:true}, templ:{...}, links:{...} }
```

`purchaseAccess` executes only when the templ is unpaused, no disband lock is active, and the membership cap has spare capacity. Attempts during an active disband (custom error `DisbandLockActive`) or when the cap is reached (`MemberLimitReached`) revert on-chain; frontend helpers surface these messages so members know to wait for governance to resolve the lock or raise the cap.

Expired disband proposals clear without manual intervention—`purchaseAccess` automatically refreshes disband locks and releases those whose voting window has lapsed, so membership resumes as soon as a failed or abandoned disband times out.

## 3. Telegram notifications

Whenever watchers detect events and the templ has a `telegramChatId`, the backend posts formatted messages. In addition to join/proposal/vote updates, the notifier announces quorum, flags when a voting window closes (including whether execution is possible), and emits a daily treasury/member-pool digest. No Telegram messages are sent if the bot token or chat id is missing.

```mermaid
sequenceDiagram
    participant C as Contract
    participant B as Backend
    participant T as Telegram
    C-->>B: AccessPurchased(purchaser, ..., purchaseId)
    B->>T: "New member joined" + join link
    C-->>B: ProposalCreated(id, proposer, endTime, title, description)
    B->>T: "Proposal created" + vote link
    C-->>B: VoteCast(id, voter, support)
    B->>T: "Vote recorded" + vote link
    C-->>B: PriestChanged(old, new)
    B->>T: "Priest updated" + overview link
```

Messages use `APP_BASE_URL` to build URLs such as `/templs/<address>` or `/templs/<address>/proposals/<id>/vote`.

## 4. Proposal creation

```mermaid
flowchart LR
    M[Member];
    C[Contract];
    B[Backend];
    T[Telegram];
    M -->|"createProposalX"| C;
    C -->|"emit ProposalCreated(id, proposer, endTime, title, description)"| B;
    B -->|"notifyProposalCreated"| T;
```

Sequence:

```mermaid
sequenceDiagram
    participant M as Member
    participant C as Contract
    participant B as Backend
    participant T as Telegram
    M->>C: createProposalSetPaused(...)
    C-->>B: ProposalCreated(id, proposer, endTime, title, description)
    B->>B: cache metadata (ensureProposalMeta)
    B->>T: message with id/proposer/endTime/link
```

## 5. Voting

```mermaid
flowchart LR
    M[Member];
    C[Contract];
    B[Backend];
    T[Telegram];
    M -->|"vote(id, support)"| C;
    C -->|"emit VoteCast(id, voter, support, timestamp)"| B;
    B -->|"notifyVoteCast (+ quorum checks)"| T;
```

Sequence:

```mermaid
sequenceDiagram
    participant M as Member
    participant C as Contract
    participant B as Backend
    participant T as Telegram
    M->>C: vote(proposalId, support)
    C-->>B: VoteCast(proposalId, voter, support, timestamp)
    B->>C: getProposal(proposalId) (best effort)
    C-->>B: Proposal details (optional)
    B->>T: notifyVoteCast(...)
    alt quorum just reached
        B->>C: getProposalSnapshots(proposalId)
        C-->>B: Snapshot data (optional)
        B->>T: notifyProposalQuorumReached(...)
    end
```

## 6. Execution

Execution remains on-chain only. Telegram notifications can be extended later to reflect `ProposalExecuted` events if desired.

```mermaid
sequenceDiagram
    participant M as Member
    participant C as Contract
    M->>C: executeProposal(id)
    C-->>M: ProposalExecuted(id, success)
```

## Data persistence summary

```mermaid
flowchart LR
    B[Backend];
    D[(Cloudflare D1)];
    B -->|"INSERT/UPDATE"| D;
    D -->|"rows restored on boot"| B;
```

- `templ_bindings` keeps the templ contract ↔ optional Telegram chat mapping plus the last-seen priest address so notifications resume after restarts (NULL chat ids indicate pending bindings). When persisted in D1/SQLite the mapping survives backend restarts without extra infrastructure.
- `used_signatures` records typed-request signatures for ~6 hours. The backend prefers D1 and only falls back to the in-memory cache when the database binding is unavailable.
- `leader_election` tracks which backend instance currently holds leadership (identified by `owner` and guarded by an `expiresAt` TTL). Multi-instance deployments refresh this row to ensure only one server keeps contract watchers and background tasks running; single-instance or in-memory setups effectively auto-elect themselves.

These flows should serve as the canonical reference for the Telegram-based architecture.
