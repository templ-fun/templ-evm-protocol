# Threat Model

## System Architecture
- **TEMPL Contract**: Governs memberships, proposals, and treasury.
- **Member Pool**: Distributes portions of entry fees to existing members.
- **Treasury**: Stores DAO funds released through successful proposals.
- **Protocol Fee Recipient**: Receives fixed sustainability fee.

```mermaid
graph TD
    User((User)) -->|Purchase| TEMPL[TEMPL Contract]
    TEMPL -->|Burn| Burn[0xdead]
    TEMPL -->|Treasury Share| Treasury[Treasury]
    TEMPL -->|Rewards| MemberPool[Member Pool]
    TEMPL -->|Protocol Fee| Protocol[Protocol Fee Recipient]
```

## Trust Assumptions
- Contract code is immutable after deployment.
- External ERC20 token used for entry fees maintains expected behavior.
- Off-chain users and signers act honestly when broadcasting transactions.

## Invariants
- Total supply of memberships is capped by economic cost per entry.
- Proposal execution is atomic; state reverts on failure.
- Treasury transfers only occur through approved proposals.

## Failure Modes
- **Economic**: Entry fee token may depeg or lose liquidity.
- **Governance**: Malicious majority can drain treasury via proposals.
- **Operational**: Network congestion may delay proposal execution.

## Membership Purchase Flow
```mermaid
sequenceDiagram
    participant User
    participant TEMPL
    participant Burn
    participant Treasury
    participant Members
    participant Protocol
    User->>TEMPL: purchaseAccess()
    TEMPL->>Burn: 30% burn
    TEMPL->>Treasury: 30% deposit
    TEMPL->>Members: 30% distributed
    TEMPL->>Protocol: 10% fee
    TEMPL-->>User: Membership granted
```

## Proposal Execution Flow
```mermaid
sequenceDiagram
    participant Member
    participant TEMPL
    participant Target
    Member->>TEMPL: executeProposal(id)
    TEMPL->>Target: call encoded action
    Target-->>TEMPL: success/failure
    alt success
        TEMPL-->>Member: Proposal marked executed
    else failure
        TEMPL-->>Member: State rolled back
    end
```

## Treasury Operation Flow
```mermaid
sequenceDiagram
    participant Member
    participant TEMPL
    participant Treasury
    Member->>TEMPL: createProposal(spend)
    TEMPL-->>Members: voting period
    Members-->>TEMPL: castVotes
    TEMPL-->>Member: proposal passes
    Member->>TEMPL: executeProposal(spend)
    TEMPL->>Treasury: transfer funds
```

