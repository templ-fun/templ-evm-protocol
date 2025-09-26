# Templ Technical Spec

Use this spec to connect the canonical architecture: paid memberships, enforced fee splits, governance modules, and Telegram notifications that mirror on-chain activity.

## 1. Contracts

- `TemplFactory` deploys templ instances with configurable fee splits and protocol tithes.
- `TEMPL` instances manage:
  - entry fee (`purchaseAccess`),
  - configurable burn/treasury/member/protocol percentages,
  - optional member caps (`MAX_MEMBERS`),
  - one member = one vote proposals (each member wallet counts once) covering pause/unpause, priest changes, treasury moves, dictatorship toggles.

See inline NatSpec comments and Hardhat tests for state transitions.

## 2. Backend responsibilities

- Validate templ registrations (`POST /templs`) with EIP-712 signatures and optional Telegram chat ids.
- Issue new Telegram binding codes (`POST /templs/rebind`) after verifying the signed priest still owns the contract.
- Confirm membership via `hasAccess` (`POST /join`).
- Store templ ↔ Telegram chat bindings in SQLite so notifications survive restarts; priest/home-link data is refreshed from chain when watchers attach.
- Subscribe to templ events via `ethers.Contract` and forward them to Telegram:
  - `AccessPurchased` → “New member” message with join + claim links and live treasury/member-pool totals.
- `ProposalCreated` → “Proposal created” with link to `/proposals/:id/vote`, including the on-chain title & description supplied at creation time.
  - `VoteCast` → “Vote recorded” summary, echoing the proposal title when available.
  - `ProposalQuorumReached` (derived from snapshots) → one-off “Quorum reached” nudge so undecided members can still participate.
  - `ProposalVotingClosed` (time-based) → post-quorum notification explaining whether the proposal is executable.
  - `PriestChanged` → “Priest updated” alert.
  - Daily digest → recurring "gm" with treasury + unclaimed member pool balances and a CTA to claim.
- Log all failures but keep the HTTP surface responsive.

The notifier posts HTML (Telegram `parse_mode=HTML`). Links are constructed from `APP_BASE_URL` plus appropriate routes.

## 3. Frontend flows

- **Deploy** (`/templs/create`): gather config, call factory, register with backend, optionally bind Telegram chat id.
- **Join** (`/templs/join`): purchase (if needed), verify membership, display templ metadata + backend-provided deep links.
- **Governance**: create proposals via curated form, vote with YES/NO toggle, track results through Telegram or direct contract reads.

MetaMask/`window.ethereum` supplies the signer. All backend calls attach typed signatures with shared builders from `shared/signing.js`.

## 4. Telegram integration

- Bot token lives in `TELEGRAM_BOT_TOKEN` (backend env). Without it, the notifier short-circuits and no messages are sent.
- Chat ids are plain strings stored in SQLite (`templ_bindings.telegramChatId`). Use negative ids for supergroups.
- Rebinding requires the current priest wallet to sign the `rebind` typed data; once the new code is observed in Telegram the backend clears the previous binding and stores the replacement chat id.
- Messages include contract/member addresses in `<code>` blocks, the proposal title/description when present, and navigation links built from `APP_BASE_URL`.
- Failures are logged at `warn` level; the backend never throws based on Telegram API errors.

## 5. Security

- All state-changing endpoints demand typed signatures (with nonce/issued/expiry) and record them to block replays.
- Production mode (`NODE_ENV=production` or `REQUIRE_CONTRACT_VERIFY=1`) ensures the signed priest actually controls the templ contract and that chain ids match the configured provider.
- Telegram is additive; it never gatekeeps on-chain operations. Never embed secrets in chat ids.

## 6. Testing

- Hardhat test suite covers contract invariants and governance.
- Backend `node:test` suite validates templ registration, membership checks, and watcher wiring.
- Frontend Vitest suite focuses on services; Playwright smoke tests cover the create/join/vote flow with Telegram disabled.

## 7. Roadmap considerations

- Richer Telegram formatting (buttons, proposal summaries) once long-lived bot tokens are configured.
- Optional webhook that mirrors events to other tooling (Discord, Matrix).
- Automated pruning / archiving of templ entries when factories upgrade.
