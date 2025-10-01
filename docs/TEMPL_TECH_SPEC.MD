# Templ technical specification

Templ combines on-chain membership contracts, typed governance, and an off-chain notification stack. This document connects those pieces so you can reason about protocol behaviour end to end.

---

## 1. On-chain system

### 1.1 Factory

- **Contract** – [`TemplFactory`](../contracts/TemplFactory.sol) stores the immutable protocol fee recipient and percentage for every templ it mints.
- **Deployment helpers** – `createTemplFor(priest, token, entryFee)` uses defaults (with `createTempl(token, entryFee)` acting as a convenience wrapper that forwards the caller as priest); `createTemplWithConfig(CreateConfig)` allows custom percentages, quorum, execution delay, burn address, max members, dictatorship flag, and home link.
- **Defaults** – Burn/treasury/member splits each default to 3_000 BPS (30%), quorum to 3_300 BPS (33%), execution delay to 7 days, and the burn address to `0x0000…dEaD`. Callers can request defaults explicitly by passing `-1` for percentage fields.
- **Validation** – Entry fees must be ≥10 units of the access token and divisible by 10. Percentages must sum to 10_000 BPS once the factory’s `protocolPercent` is included.
- **Access control** – The deploying wallet is recorded as `factoryDeployer`. Until that address calls `setPermissionless(true)`, only it can mint templs; when permissionless mode is enabled any wallet may deploy templs, but each templ still inherits the factory’s immutable protocol recipient and percent.
- **Implementation detail** – The factory stores the `TEMPL` creation bytecode in SSTORE2 and concatenates constructor arguments during deployment to minimise gas.

### 1.2 Templ composition

Every templ instance is the [`TEMPL`](../contracts/TEMPL.sol) contract, which inherits four modules:

| Module | Responsibility |
| --- | --- |
| `TemplBase` | Shared storage, immutables, events, join pause flag, membership cap, quorum/execution delay, and the on-chain `templHomeLink`. Provides helpers for percentage validation, dictatorship toggles, and external reward bookkeeping. |
| `TemplMembership` | `join`/`joinFor`, reward accounting, `claimMemberRewards`, external reward claims, configuration views (`getConfig`, `getTreasuryInfo`, etc.), and member metadata (`getMemberCount`, `totalJoins`, `getJoinDetails`). |
| `TemplTreasury` | Governance hooks to withdraw funds, update fee splits, toggle joins, adjust caps, disband treasury balances, rotate priests, toggle dictatorship, and update the home link. Also tracks treasury balances credited from entry fees. |
| `TemplGovernance` | Proposal lifecycle, voting rules, execution router, pagination helpers, and quorum calculations. |

The constructor:

- Requires a non-zero priest, entry fee ≥10, and fee multiples of 10.
- Auto-enrols the priest as the founding member (with reward snapshot alignment) so the first paid join distributes rewards to them.
- Applies the configured cap (if any) and leaves joins unpaused.

### 1.3 Membership and economics

- **Joining** – `join()` lets a payer enroll themselves; `joinFor(address recipient)` gifts membership to another wallet. Both revert when joins are paused, the membership cap is reached, or the recipient already joined. Fee-on-transfer tokens are unsupported because the contract relies on exact transfers.
- **Fee routing** – Each join splits the entry fee into burn, treasury, member pool, and protocol allocations. The protocol share is forwarded immediately to the factory-wide recipient. Treasury and member pool balances accumulate on the contract; the burn share goes to the configured burn address. Percentages are stored in basis points.
- **Member rewards** – Existing members receive `floor(memberPoolShare / activeMembers)` tokens whenever a new member joins or treasury access-token balances are disbanded into the pool. Leftover remainders accumulate in `memberRewardRemainder` and are rolled into the next distribution. Members claim via `claimMemberRewards()`.
- **External rewards** – Treasury withdrawals or disbands involving non-access-token assets route through `externalRewards`. Each token (including ETH as `address(0)`) tracks its own cumulative rewards and remainder. The contract supports up to 256 concurrent external reward tokens; `cleanupExternalRewardToken(token)` removes empty pools.
- **Caps and pauses** – Governance can set a membership cap via `setMaxMembersDAO`. When active members reach the cap the contract automatically pauses joins (`joinPaused = true`). Removing or raising the cap leaves the templ paused until governance explicitly resumes joins.

### 1.4 Governance

- **Eligibility** – One member equals one vote. Members that join after a proposal’s snapshot block cannot vote on that proposal. Dictatorship mode disables new proposals (except to exit dictatorship) and voting on existing ones.
- **Proposal creation** – Members can open proposals to:
  - Pause or resume joins.
  - Update the entry fee and, optionally, the burn/treasury/member percentages (protocol share is immutable per factory).
  - Adjust the membership cap.
  - Update the templ home link.
  - Withdraw treasury or external funds to a recipient.
  - Disband treasury holdings into member or external reward pools.
  - Change the priest.
  - Enable or disable dictatorship mode.
- **Voting windows** – Each proposal can choose a voting period between 7 and 30 days (`0` defaults to 7). Once quorum is reached the contract enforces the per-templ `executionDelayAfterQuorum` (default 7 days) before allowing execution. Priest-authored disband proposals skip quorum but must wait for their voting window to close.
- **Quorum** – `quorumPercent` is set at deployment (default 33%). Proposals compute quorum against the number of eligible voters at snapshot time. Execution requires `yesVotes > noVotes` and the quorum percentage to be satisfied (unless the proposal is quorum-exempt).
- **Execution router** – `executeProposal(id)` calls the relevant governance hook (`_governanceSetJoinPaused`, `_governanceUpdateConfig`, etc.). Execution is non-reentrant and reverts if quorum/delay requirements are not met, the proposal already executed, or votes did not pass.
- **Active proposal guard** – Each address can have at most one active proposal at a time. Helpers such as `getActiveProposalsPaginated` and `pruneInactiveProposals` keep views bounded.

### 1.5 Events and errors

- Key events: `MemberJoined`, `MemberRewardsClaimed`, `ExternalRewardClaimed`, `ProposalCreated`, `VoteCast`, `ProposalExecuted`, `TreasuryAction`, `TreasuryDisbanded`, `JoinPauseUpdated`, `ConfigUpdated`, `PriestChanged`, `DictatorshipModeChanged`, `MaxMembersUpdated`, `TemplHomeLinkUpdated`.
- Errors: see [`TemplErrors.sol`](../contracts/TemplErrors.sol) for the canonical list (`EntryFeeTooSmall`, `InvalidPercentageSplit`, `MemberLimitReached`, `DictatorshipEnabled`, etc.).

---

## 2. Backend service

The backend (`backend/src`) is a Node 22 Express app packaged in `backend/Dockerfile` and designed to run as a long-lived process (Fly, Render, Railway, bare metal) while maintaining persistent SQLite storage and background event streams.

- **Signature verification** – `/templs`, `/templs/rebind`, and `/join` require EIP-712 signatures generated by the shared signing helpers. The backend maintains replay protection in persistence (`used_signatures`).
- **Templ registry** – Registrations store contract, priest, optional `templHomeLink`, and optional `telegramChatId`. Chat identifiers are never returned to clients unless they own the templ; listing endpoints deliberately omit them.
- **Membership checks** – `/join` calls `isMember(member)` on chain using the configured RPC endpoint. Failure to confirm membership surfaces as `403 Membership not found`.
- **Telegram notifier** – When a templ is bound to a chat and `TELEGRAM_BOT_TOKEN` is configured, the backend streams contract events (`MemberJoined`, `ProposalCreated`, `VoteCast`, `PriestChanged`, etc.) and delivers MarkdownV2-formatted messages. Daily digests summarise treasury and member pool balances once every 24 hours while the server holds the leader lease.
- **Background work** – Leader election (via D1) ensures exactly one replica runs watchers, polls Telegram binding codes, and triggers digests. Other replicas stay idle until the lease expires.
- **Persistence** – See [PERSISTENCE.md](PERSISTENCE.md) for table layouts and failover behaviour (Cloudflare D1, SQLite, or in-memory adapters).
- **Configuration** – `BACKEND.md` documents every environment variable (`RPC_URL`, `BACKEND_SERVER_ID`, `ALLOWED_ORIGINS`, `TRUSTED_FACTORY_*`, rate limiting, Telegram secrets, etc.) along with sample responses.

---

## 3. Frontend application

- **Stack** – Vite + React SPA served statically (Cloudflare Pages in production). Uses `ethers.BrowserProvider` for wallet interaction and shared signing helpers for typed data.
- **Key routes** –
  - `/` – Landing page that lists templs discovered via the configured factory and backend metadata.
  - `/templs/create` – Guided deployment, including fee split validation and registration with the backend.
  - `/templs/join` – Join or gift membership; handles approvals when required.
  - `/templs/:address` – Overview with priest info, Telegram binding status, treasury/member pool snapshots, and governance shortcuts.
  - `/templs/:address/proposals/new` – Proposal composer with typed action selection.
  - `/templs/:address/proposals/:id/vote` – Voting surface (YES/NO) and execution helpers.
  - `/templs/:address/claim` – Member rewards claim page (access-token and external pools).
- **Configuration** – Environment variables prefixed with `VITE_` control the backend URL, trusted factory metadata, protocol fee hints, and RPC providers. `VITE_BACKEND_SERVER_ID` must match the backend’s `BACKEND_SERVER_ID` so signatures verify.
- **Telegram binding UX** – After registering a templ the SPA surfaces the binding code returned by the backend. Priests can request new codes from the overview page to rotate chats.
- **Testing** – Vitest covers components and services; Playwright E2E scripts exercise deploy/join/governance flows.

---

## 4. Telegram integration

- Providing `TELEGRAM_BOT_TOKEN` enables delivery. Omitting it keeps all contract flows operational while disabling notifications.
- Chat IDs (positive for direct chats, negative for supergroups) live in persistence; only the backend sees them. Clients receive binding codes instead of raw IDs.
- Rebinding requires the current priest to sign a typed request. The backend revokes the previous binding immediately and listens for the new chat to issue `/templ <code>` or trigger the `startgroup` deep link.
- Messages use MarkdownV2 formatting, include deep links derived from `APP_BASE_URL`, and are resilient to transient Telegram errors (failures are logged, not fatal).

---

## 5. Operational guarantees and invariants

- **Protocol share immutability** – The protocol percentage and recipient are fixed per factory; governance cannot alter them.
- **Entry fee safety** – Entry fees stay ≥10 and divisible by 10. Governance proposals that violate these constraints revert.
- **Dictatorship exit hatch** – Even when dictatorship mode is active, members (including the priest) can always propose to disable it; all other proposal types are blocked until dictatorship is lifted.
- **Quorum escape hatch** – Priest-authored disband proposals (`quorumExempt = true`) provide a deterministic way to distribute funds when quorum can no longer be met.
- **Join availability** – Disbanding treasury funds never pauses joins. Only explicit pause proposals or hard member caps block new members.
- **Reward accounting** – Member and external reward calculations carry remainders forward to guarantee eventual distribution of every token.
- **Non-reentrancy** – `join`, reward claims, and `executeProposal` are guarded by `ReentrancyGuard`.

Use this spec alongside the source to audit behaviour, design new features, or run incident response without guesswork.
