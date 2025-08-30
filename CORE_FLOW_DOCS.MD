# Core Flow Service Diagrams

This document illustrates which service each core flow uses in TEMPL.

## 1. Templ creation
```mermaid
flowchart LR
    F[Frontend] -->|deploy contract| C[Smart Contract]
    F -->|POST /templs| B[Backend]
    B -->|newGroup| X[XMTP]
```

During Templ creation the backend's bot wallet creates and owns the XMTP group:

- The frontend sends the deployed contract address and the priest's inbox ID to the backend via `POST /templs`.
- The backend calls `newGroup` on XMTP, adds the priest as a member, and records the resulting group ID.
- Group ownership remains with the backend service; the priest does not control the group.

## 2. Pay-to-join
```mermaid
flowchart LR
    F[Frontend] -->|purchaseAccess| C[Smart Contract]
    F -->|POST /join| B[Backend]
    B -->|addMembers| X[XMTP]
```

## 3. Messaging
```mermaid
flowchart LR
    M[Member] -->|send message| X[XMTP Group]
```

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

## 5. Proposal creation
```mermaid
flowchart LR
    F[Member] -->|createProposal| C[Smart Contract]
    C -->|ProposalCreated event| B[Backend]
    B -->|send proposal JSON| X[XMTP Group]
```

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
    C -->|execute callData| T[Target Contract]
```

