# Templ Technical Spec

This spec connects the core architecture: fee-gated memberships on chain, typed governance, and Telegram notifications that mirror contract activity.

## 1. Contracts

- **Factory.** `TemplFactory` deploys templ instances and locks the protocol rake shared by every templ it mints.
- **Entry fees.** `TEMPL` contracts accept ERC-20 fees via `purchaseAccess`, split tribute across burn/treasury/member/protocol slices, and auto-enrol the deploying priest so the pioneer pool accrues to them.
- **Caps and pauses.** Optional `MAX_MEMBERS` enforces an upper bound; hitting the cap pauses new joins with `MemberLimitReached` until governance raises or clears the limit and resumes the contract.
- **Governance scope.** One-wallet-one-vote proposals manage pause/unpause, fee config, treasury withdrawals/disbands, priest rotation, dictatorship toggles, and the on-chain `templHomeLink` string. Disbanding keeps joins open so communities cannot brick new entrants mid-vote.
- **Quorum escape hatch.** A priest-authored `disbandTreasury` proposal skips quorum so an inactive templ that can no longer meet the threshold still has a deterministic path to dissolve and distribute funds via the priest.
- **External rewards.** Up to 256 reward tokens can be tracked at once. `cleanupExternalRewardToken(token)` frees a slot after distributions settle to keep gas predictable.
- **NatSpec + tests.** Hardhat tests and inline comments document state transitions and edge cases.

## 2. Backend responsibilities

- Validate templ registrations (`POST /templs`) and rebinds with EIP-712 signatures.
- Confirm membership via `hasAccess` on chain (`POST /join`).
- Persist templ ↔ Telegram chat bindings in Cloudflare D1 (or SQLite/in-memory) so notifications survive restarts while keeping the registry templ-scoped only (contract + optional chat).
- Subscribe to templ events with `ethers.Contract` and emit Telegram MarkdownV2 messages for joins, proposals, quorum, voting closure, priest changes, home-link updates, daily digests, and binding acknowledgements.
- Run background jobs for proposal deadlines, digests, and Telegram binding polls while keeping HTTP responses fast.

## 3. Frontend flows

- **Deploy** (`/templs/create`): collect config, call the factory, sign the registration payload, and post to the backend (optional Telegram chat id).
- **Join** (`/templs/join`): approve + purchase access when needed, then sign a `join` payload for backend verification.
- **Governance** (`/templs/:address/...`): create proposals with on-chain title/description, cast YES/NO votes, execute outcomes, and manage Telegram bindings.
- Shared signing helpers in `shared/` build the typed data used across frontend and backend.

## 4. Telegram integration

- `TELEGRAM_BOT_TOKEN` enables delivery; leaving it unset disables notifications without impacting contract flows.
- Chat ids live in persistence (`templ_bindings.telegramChatId`). Supergroups use negative ids as returned by the Telegram API.
- Rebinds require the current priest to sign typed data; the backend issues a fresh code and revokes the previous binding as soon as the new chat posts `templ <code>`.
- MarkdownV2 formatting keeps alerts readable (bold headings, inline code for addresses, deep links sourced from `APP_BASE_URL`). Failures are logged but never crash the service.

## 5. Security

- Every state-changing endpoint requires typed signatures with nonce/issued/expiry checks; signatures are recorded to prevent replays.
- Production mode (`NODE_ENV=production` or `REQUIRE_CONTRACT_VERIFY=1`) ensures the signer actually controls the templ and that chain ids match the configured provider.
- Telegram is additive: it never gates on-chain operations and never stores secrets on chain.

## 6. Testing hooks

- Hardhat covers contract invariants and governance transitions.
- Backend `node:test` suite verifies registration, membership checks, watchers, and persistence adapters.
- Frontend Vitest focuses on services; Playwright smoke tests cover deploy/join/vote flows with Telegram disabled by default.
