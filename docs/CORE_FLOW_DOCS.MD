# Core Flow Diagrams (Telegram Edition)

Use this reference to see how the contracts, backend API, frontend, and Telegram notifier interact today. Every section pairs a flowchart with a sequence diagram so you can choose the view that fits your debugging or onboarding moment.

## Actors

- **Frontend (F)** – Vite + React app in the browser.
- **Backend (B)** – Express server handling signatures, persistence, and Telegram notifications.
- **Contract (C)** – On-chain templ instance.
- **Telegram (T)** – Bot-backed delivery of templ events (optional).
- **SQLite (D)** – Backend binding store (contract ↔ Telegram chat id).
- **Member (M)** / **Priest (P)** – Participants initiating actions.

## 1. Templ creation

```mermaid
flowchart LR
    F[Frontend] -->|factory.createTemplWithConfig| C[Contract]
    F -->|POST /templs| B[Backend]
    B -->|verify contract/priest (optional)| C
    B -->|persist templ binding| D[(SQLite)]
    B -->|register watcher| C
```

Sequence:

```mermaid
sequenceDiagram
    participant F as Frontend
    participant C as Contract
    participant B as Backend
    participant D as SQLite
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
    F -->|purchaseAccess| C
    F -->|POST /join| B
    B -->|hasAccess(member)| C
    C -->|true/false| B
    B -->|respond with templ links| F
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
    M -->|createProposalX| C
    C -->|emit ProposalCreated(id, proposer, endTime, title, description)| B
    B -->|notifyProposalCreated| T[Telegram]
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
    M -->|vote(id, support)| C
    C -->|emit VoteCast(id, voter, support, timestamp)| B
    B -->|notifyVoteCast (+ quorum checks)| T[Telegram]
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
    B[Backend] -->|INSERT/UPDATE| D[(SQLite)]
    D -->|rows restored on boot| B
```

- `templ_bindings` table keeps the templ contract ↔ optional Telegram chat mapping so notifications resume after restarts (NULL chat ids indicate pending bindings).
- Replay protection for `/templs` and `/join` lives in an in-memory cache with a rolling retention window.

These flows should serve as the canonical reference for the Telegram-based architecture.
