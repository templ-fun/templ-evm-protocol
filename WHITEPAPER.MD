# TEMPL Protocol — Technical Whitepaper

## Abstract
TEMPL is a DAO‑governed, token‑gated private group system that combines:

- On‑chain membership with a fixed ERC‑20 entry fee (one‑time, non‑transferable)
- Automatic fee split 30/30/30/10 (burn/treasury/member‑pool/protocol)
- One‑member‑one‑vote governance over an allowlisted set of safe actions
- Views and signatures that let a backend enforce access to an XMTP group chat

This document explains the technical surface, constraints, and operations end‑to‑end.

## Design Goals
- Simple governance: one member = one vote; typed actions only.
- Fair onboarding: each new member rewards existing members via a claimable member pool.
- Safety: no arbitrary external calls; reentrancy guards; proposal allowlist.
- Clear separation: on‑chain membership/treasury; off‑chain group messaging and moderation.
- Operational clarity: explicit environment, signatures, and persistence for backend/frontend.

## System Overview
- Smart contracts (Solidity 0.8.23) gate membership and manage the treasury and member pool.
- Backend (Node/Express) creates the XMTP group with a short‑lived ephemeral key, then uses a persistent invite‑bot identity to invite on‑chain members. No persistent owner/admin keys are retained; the bot is not used for banning. It also mirrors governance events and enforces moderation via signatures.
- Frontend (Vite + React) deploys contracts, buys access, requests invites, and surfaces governance and chat.

High‑level flow (deploy → join → chat):
1) Deploy: Frontend deploys a TEMPL; backend creates an XMTP group bound to the contract using an ephemeral creator key (discarded after).
2) Join: User purchases on‑chain; frontend requests invite; backend verifies and invites.
3) Chat/Govern: Members chat on XMTP and govern with on‑chain proposals/votes.

## On‑Chain Protocol (contracts/TEMPL.sol)

### Core Data Model
- Configuration: `protocolFeeRecipient` (10% of entry fee, immutable), `accessToken` (ERC‑20 used for entry, immutable), `entryFee` (≥10, divisible by 10; updatable via governance).
- Membership: `members[address]` with `purchased`, `timestamp`, `block`, and `rewardSnapshot`. `memberList[]` stores all members. Membership is one‑time and non‑transferable.
- Economics: `treasuryBalance`, `memberPoolBalance`, `totalBurned`, `totalToTreasury`, `totalToMemberPool`, `totalToProtocol`, `memberRewardRemainder`, `cumulativeMemberRewards`.
- Governance: proposals indexed by `proposalCount`. A proposal records proposer, action, parameters, votes, timing, quorum metadata, and an optional `quorumExempt` flag.

### Economic Model (per `purchaseAccess()`)
- Split of `entryFee`:
  - 30% Burn → `0x000000000000000000000000000000000000dEaD`
  - 30% Treasury → retained by contract, tracked in `treasuryBalance`
  - 30% Member Pool → retained by contract, tracked in `memberPoolBalance`
  - 10% Protocol → transferred to `protocolFeeRecipient`
- Member rewards: When a new member joins, the contract increments `cumulativeMemberRewards` by `floor(30% / (n-1))` for existing members (where `n` is new member count). Remainder accumulates in `memberRewardRemainder`.
- Donations: Anyone may send ETH/ERC‑20 directly to the contract address. Governance may later withdraw donated assets; the member pool balance remains reserved for members.

### Membership Lifecycle
- `purchaseAccess()` — one‑time, guarded by `whenNotPaused` and `notSelf` (DAO cannot purchase). Transfers tokens using SafeERC20 and emits `AccessPurchased` with counters.
- `hasAccess(address)` — returns membership boolean.
- `getPurchaseDetails(address)` — returns `(purchased, timestamp, block)`.
- Member rewards:
  - `getClaimablePoolAmount(address)` — accrued rewards since join/last claim.
  - `claimMemberPool()` — transfers claimable amount; reverts `NoRewardsToClaim` or `InsufficientPoolBalance` when applicable. Updates snapshot and `memberPoolBalance`.

### Governance Model
- Voting power: one member = one vote. Proposer auto‑YES. Votes can be changed until eligibility windows close.
- Proposal bounds: exactly one live proposal per address. A new proposal clears a previous one when it is expired or executed; otherwise creation reverts `ActiveProposalExists`.
- Voting windows: default `7 days` if `0` is provided; allowed range `[7, 30] days`.
- Quorum and eligibility:
  - Quorum: `quorumPercent = 33` of `eligibleVoters` (tracked over time).
  - Before quorum:
    - Any member may vote
    - `eligibleVoters = memberList.length`
  - After quorum:
    - Eligibility freezes at `quorumReachedAt`
    - Only members who joined before `quorumReachedAt` may vote
    - Late joiners revert `JoinedAfterProposal`
  - Execution:
    - Majority required: `yesVotes > noVotes`
    - Quorum‑exempt: execute after `endTime`
    - Requires quorum: execute after `executionDelayAfterQuorum = 7 days` since `quorumReachedAt`
- Quorum exemption: `createProposalDisbandTreasury` proposed by the `priest` sets `quorumExempt = true` and respects only `endTime`.

### Allowed Actions (typed; no arbitrary calls)
- `setPausedDAO(bool)` — pause/unpause purchases.
- `updateConfigDAO(address,uint256)` — update entry fee only; token changes are disabled (`TokenChangeDisabled`). `_token` must be `address(0)` or the current token.
- `withdrawTreasuryDAO(address token, address recipient, uint256 amount, string reason)` — move a specific amount of any asset held by the contract. For the access token, only the treasury portion is withdrawable; the member pool is preserved.
- `disbandTreasuryDAO()` / `disbandTreasuryDAO(address)` — move the full available balance of the access token into the member pool equally. Only the access token can be pooled.
- `changePriestDAO(address)` — change the on‑chain `priest` address.

Creation helpers (`createProposalX`) initialize proposals with normalized timing, proposer auto‑YES, and optional quorum exemption for priest‑proposed disband.

### Views and Introspection
- `getTreasuryInfo()` — available treasury (excludes reserved member pool), current pool, totals, protocol recipient.
- `getConfig()` — token, entry fee, paused flag, member count, available treasury, pool.
- `getMemberCount()` — number of members.
- `getVoteWeight(address)` — `1` for members, `0` for non‑members.
- `getProposal(id)` — proposer, yes/no votes, endTime, executed flag, computed `passed`.
- `hasVoted(id, voter)` — whether and how a voter voted (`support`).
- `getActiveProposals()` / `getActiveProposalsPaginated(offset, limit)` — active proposal ids, with pagination support.

### Safety and Invariants
- Non‑reentrant: `purchaseAccess`, `claimMemberPool`, `executeProposal`.
- `onlyDAO` guards administration to self‑calls via `executeProposal`.
- `notSelf` prevents DAO from purchasing membership.
- `paused` blocks new purchases; proposing/voting continue while paused.
- Token change disabled in governance; entry fee constrained (≥10 and multiple of 10).
- No arbitrary external calls; proposal execution is internal and typed.
- Member pool is preserved: withdrawals of access token are limited to the available treasury (excludes pool). Disband operations increase the pool for equitable member distribution.

## Off‑Chain Protocol (Backend API + XMTP)

### Responsibilities
- Owns the XMTP group tied to a TEMPL contract, invites paid members by resolving inbox identities.
- Verifies EIP‑712 signatures for all state‑changing requests and enforces replay protection.
- Mirrors on‑chain governance events (`ProposalCreated`, `VoteCast`) into the group as JSON messages.
- Enforces chat moderation via escalating mutes and optional delegated moderators.

### Group Creation and Invites
- `POST /templs` — create/register a group for a deployed contract.
  - Production checks: verify contract code, `chainId`, and that `priestAddress` equals on‑chain `priest()` (when `REQUIRE_CONTRACT_VERIFY=1`).
  - Signature: EIP‑712 `{ action:'create', contract, server, nonce, issuedAt, expiry }` bound to `BACKEND_SERVER_ID`.
  - Response and persistence: `{ groupId }`; store `{ contract, groupId, priest }` in SQLite.
- `POST /join` — verify `hasAccess(member)` and invite by inboxId.
  - Signature: EIP‑712 `{ action:'join', contract, server, nonce, issuedAt, expiry }` signed by the member.
  - Identity: server resolves inboxIds and waits for readiness; client‑supplied ids are ignored except in explicit local/test fallback.

### Moderation Endpoints
- `POST /delegateMute` — grant mute rights (priest EIP‑712 `{ action:'delegateMute', ... }`).
- `DELETE /delegateMute` — revoke mute rights (same typed signature).
- `POST /mute` — record escalating mute strike (priest or delegate EIP‑712 `{ action:'mute', ... }`).
- `GET /mutes` — list active mutes for a contract.

### Identity, Persistence, and Operations
- XMTP environments: `local`, `dev`, `production` (`XMTP_ENV` / `VITE_XMTP_ENV`).
- Group ownership: An ephemeral creator key is used at creation; the persistent invite‑bot identity manages invites thereafter (no need for admin powers like banning).
- Persistence (SQLite `backend/groups.db`):
  - `groups(contract, groupId, priest)`; `delegates(contract, delegate)`; `mutes(contract, target, count, until)`; `signatures(sig, usedAt)`; and `kv` (stores generated bot key when `BOT_PRIVATE_KEY` not provided).
- XMTP Node DB: SQLCipher‑encrypted `xmtp-<env>-<inboxId>.db3` using `BACKEND_DB_ENC_KEY` (required in production). Browser DB lives in OPFS per origin (not encrypted).
- CORS and rate limiting: `ALLOWED_ORIGINS` defines allowed frontends; Redis is auto‑used when `REDIS_URL` is set, otherwise in‑memory store (not recommended for production).

## Client (Frontend)
- Deploy TEMPL, purchase & join, chat, propose, vote, and execute from a React app.
- Governance UI composes the typed proposal actions (pause/unpause, entry fee update, specific treasury transfer, disband to pool, change priest). Titles/descriptions are not on‑chain; they are shared as XMTP messages adjacent to the on‑chain proposal id.
- `VITE_BACKEND_SERVER_ID` must match backend `BACKEND_SERVER_ID` to bind EIP‑712 signatures to your deployment.

## Persistence Overview
- On‑chain: membership, treasury/pool balances, governance proposals, votes, and events.
- Backend SQLite: contract→group mapping, priest, moderation, replay‑protection signatures, bot key (when generated).
- XMTP Node DB (server): encrypted client identity and conversation metadata.
- XMTP Browser DB: OPFS identity and metadata; advise one client per page to avoid OPFS access‑handle contention.

## Capabilities and Constraints

What a TEMPL can do:
- Gate membership by paid entry with an ERC‑20 token and a fixed fee.
- Automatically split entry fees among burn/treasury/member pool/protocol.
- Let members claim accrued rewards from the member pool.
- Govern via typed proposals with one‑member‑one‑vote and quorum rules.
- Move treasury/donated assets via proposal; disband the entire available access‑token balance into the member pool.
- Pause new purchases; change the priest; reprice the entry fee (token unchanged).
- Run a private XMTP group where only on‑chain members are invited.

What a TEMPL cannot do (by design):
- Change the access token via governance (`TokenChangeDisabled`).
- Execute arbitrary external calls; all actions are typed and internal.
- Revoke or transfer membership on‑chain; membership is a one‑time purchase recorded in a mapping.
- Withdraw the member pool directly; it is only claimable by members or increased via disband.
- Pool non‑access tokens; disband only supports the access token.
- Bypass the backend to join the group; invitations require backend resolution and add.

## Security Model and Operational Notes
- Contracts: guarded by `ReentrancyGuard`; internal, typed execution only; pool preservation; entry fee constraints; proposal one‑at‑a‑time per address.
- Governance safety: quorum gating and post‑quorum delay; priest disband exception is time‑bound but majority‑gated.
- Backend: all state‑changing endpoints use EIP‑712 signatures bound to `BACKEND_SERVER_ID`/`VITE_BACKEND_SERVER_ID` with replay protection. In production, backend enforces contract code, chainId, and priest checks for `/templs`.
- Data at rest: XMTP Node DB requires `BACKEND_DB_ENC_KEY` in production; browser DB is OPFS and not encrypted.
- XMTP network constraints: dev network caps installs at 10 per inbox and limits total actions; tests rotate wallets or reuse DBs accordingly.
- RPC trust: provider responses are assumed honest; use a trusted RPC.

## Deployment and Local Testing
- Prereqs: Node 22.18+. Install with `npm ci` (plus `npm --prefix backend ci`, `npm --prefix frontend ci`).
- Contracts: `npm run compile`, `npm test`, `npm run slither`, `npm run coverage`.
- Backend: `npm --prefix backend start` (requires env); `npm --prefix backend test`.
- Frontend: `npm --prefix frontend run dev`; Playwright E2E `npm --prefix frontend run test:e2e`.
- Local stack: `npm run node` (Hardhat), backend on `:3001`, frontend on `:5173`. Use Hardhat accounts for priest/member; deploy a test ERC‑20; create TEMPL; purchase & join; chat and govern.
- Environment variables of note:
  - `RPC_URL` — on‑chain provider endpoint
  - `BOT_PRIVATE_KEY` — XMTP invite‑bot identity (server)
  - `ALLOWED_ORIGINS` — CORS origins for backend
  - `BACKEND_DB_ENC_KEY` — 32‑byte SQLCipher key for XMTP Node DB
  - `BACKEND_SERVER_ID` / `VITE_BACKEND_SERVER_ID` — must match (binds EIP‑712)
  - `XMTP_ENV` / `VITE_XMTP_ENV` — `local` | `dev` | `production`

## Glossary
- Priest: Contract’s designated address with limited special power (its disband proposals are quorum‑exempt; priest can be changed via DAO).
- Treasury: Portion of access token and any donations held by the contract, withdrawable via proposals.
- Member Pool: Accrual bucket distributed equally to members; claimable pro‑rata by address.
- Disband: Governance action moving the entire available access‑token treasury into the member pool equally.
- Quorum: 33% of eligible voters; eligibility freezes after quorum.
- XMTP Group: Off‑chain chat space owned by the backend’s bot identity; only invited members participate.

## Appendix: Events and Errors (selected)
- Events:
  - `AccessPurchased`
  - `MemberPoolClaimed`
  - `ProposalCreated`
  - `VoteCast`
  - `ProposalExecuted`
  - `TreasuryAction`
  - `ConfigUpdated`
  - `ContractPaused`
  - `PriestChanged`
  - `TreasuryDisbanded`

- Errors:
  - `NotMember`, `NotDAO`, `ContractPausedError`, `AlreadyPurchased`
  - `InsufficientBalance`, `ActiveProposalExists`, `VotingPeriodTooShort`, `VotingPeriodTooLong`
  - `InvalidProposal`, `VotingEnded`, `JoinedAfterProposal`, `AlreadyExecuted`
  - `ProposalNotPassed`, `ProposalExecutionFailed`, `InvalidRecipient`, `AmountZero`
  - `InsufficientTreasuryBalance`, `NoTreasuryFunds`, `EntryFeeTooSmall`, `InvalidEntryFee`
  - `NoRewardsToClaim`, `InsufficientPoolBalance`, `LimitOutOfRange`, `InvalidSender`
  - `InvalidCallData`, `TokenChangeDisabled`, `NoMembers`, `QuorumNotReached`, `ExecutionDelayActive`

---
This whitepaper consolidates the repository documentation into a single, linear reference. For implementation details and environment specifics, see `README.md`, `CONTRACTS.md`, `BACKEND.md`, `FRONTEND.md`, `CORE_FLOW_DOCS.MD`, and `PERSISTENCE.md` in the repo.
