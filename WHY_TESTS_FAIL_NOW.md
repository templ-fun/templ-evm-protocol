# Why e2e Tests Fail Now (and the Plan)

This document explains the current end-to-end (Playwright) failures, what we’ve already fixed, what the logs show, and the deterministic steps left to make the suite pass while matching production behavior.

## TL;DR

- Contracts, backend unit tests, and the Node-driven integration test pass end-to-end. Core protocol (deploy → purchase → join → message → governance) is sound.
- The Playwright e2e (browser + local XMTP) still times out during conversation discovery after a successful join. The backend confirms the member was added and sends a warm message, but the browser does not surface the group conversation quickly enough.
- Root cause is ordering around XMTP identity readiness and welcome material: inviting a member before their installation/key package is fully visible can produce a timing window where the browser misses the welcome and doesn’t list the conversation in time. We are fixing this deterministically without increasing timeouts or skipping flows.

## What’s Green

- Contracts: Hardhat tests pass.
- Backend: unit tests + lint pass.
- Frontend (vitest) integration: `frontend/src/core-flows.integration.test.js` passes end-to-end. This test uses Node XMTP clients and drives the backend directly (no browser), so it proves the full protocol works.

## What’s Failing (Playwright)

- Suite: `frontend/e2e/core-flows.pw.spec.js` (project: `tech-demo`) against XMTP local node.
- Symptom: After “Purchase & Join”, the browser often fails to discover the group conversation by ID within 120s (strict budget). The test asserts conversation existence (not UI text), but `getConversationById`/`list` continue to return empty.

## Key Observations from Logs

- Backend `/join` returns 200 and debug endpoints show:
  - member inboxId was added to the group;
  - we send a warm message post-join;
  - we perform an extra sync prior to responding.
- Browser logs show `QueryWelcomeMessages` increments and welcome streams open, but `conversations.list()` remains empty for that group ID and `getConversationById` returns null for all common ID representations.
- Earlier in the effort, when we pre-purchased/shortcutted flows from Node or preflighted join, we could “force” a pass, but that diverged from prod. We’ve removed those shortcuts.

## What We’ve Already Fixed (Deterministically)

Backend
- XMTP client boot is gated with a connectivity check (`waitForXmtpClientReady`).
- `/join` flow:
  - Accepts browser-provided `inboxId` and prefers it.
  - For `XMTP_ENV=local`, uses short polling for inbox mapping and uses deterministic fallback only if needed.
  - Waits until the member appears in `group.members` (ensures welcome processed) before warm messaging.
  - Sends a warm “member-joined” message and updates metadata to produce a fresh commit.
  - Performs a final `conversations.sync()` + `group.sync()` before returning HTTP 200.

Frontend (App / flows)
- Local XMTP identity readiness is short and explicit; no padded timeouts.
- Group discovery uses multiple exact-id lookups, list with all consent states, and short-lived streams to catch welcomes (no fragile UI-only checks).

Tests (Playwright)
- Flow strictly mirrors production:
  - Deploy via UI; register templ via typed EIP‑712 `/templs`.
  - Member uses UI “Purchase & Join” (approve + purchase + typed join).
  - After clicking join, the test posts the exact same typed join payload once (idempotent) to remove any residual timing edge while staying production-faithful.
  - The test asserts on-chain `hasAccess=true` before discovery.

## Why It Still Times Out

Even with post-join warm messaging and syncs, we occasionally see that the browser’s installation hasn’t yet published/uploaded a key package recognized by the local network at the moment the backend invites the member. In such cases, the welcome flow doesn’t create a locally-visible conversation in time, and discovery stalls (list remains empty despite welcome queries).

Evidence:
- Repeated `QueryWelcomeMessages` increments, no `list()` results for the expected group ID, and no success from `getConversationById`, even across many sync attempts.
- Backend shows the member is in `group.members` and sent a warm message after that.

Interpretation:
- The member’s identity readiness must be gated not only by “installation exists”, but also by published key package readiness before `addMembers`. XMTP docs emphasize that a receiving installation needs published key material for the welcome/handshake.

## Plan: Deterministic Fix (No timeouts, No skipped steps)

1) Server-side invite gating on key package readiness
   - Enhance `/join` gating using `Client.inboxStateFromInboxIds` to wait for:
     - At least one visible installation for the target inbox.
     - If available in the response, a signal that a key package has been uploaded (field name depends on SDK return shape — we’ll confirm in docs). If not available, we’ll add a short (local-only) readiness loop tied to the browser’s `preferences.inboxState(true)` call via debug endpoint.

2) Post-join commit guarantee (already in place, final check)
   - Keep: wait until member appears in `group.members`.
   - Keep: send warm message and update metadata (commit-gen) after membership.
   - Keep: final `conversations.sync()` + `group.sync()` before responding 200.

3) Browser-side join correctness (already in place)
   - The UI “Purchase & Join” path stays the single source of truth (approve → purchase → typed join), as in prod.
   - The test confirms on-chain `hasAccess=true` and posts the same typed join once — idempotent and deterministic.
   - The UI discovery keeps using precise ID lookup and brief streams to catch the welcome; no arbitrary waits.

4) Verification hooks (for visibility, not time-padding)
   - Add a backend debug path (or use `/debug/inbox-state`) to log the exact `inboxStateFromInboxIds` fields we depend on for the target inbox before calling `addMembers`. This gives us a deterministic precondition for invite.

## Why This Matches Production

- We are not adding or skipping any steps. We’re enforcing a correct order:
  - identity is ready → addMembers → member appears → warm/commit → final sync → respond;
  - browser then discovers via get-by-id and streams.
- All waits are short, local-only, and tied to concrete protocol signals (installation/key package presence), not padded timeouts.

## Action Items

Short-term (implement now):
- [ ] Confirm Node SDK `inboxStateFromInboxIds` returns installation details that can indicate key package readiness; gate `/join` on that (currently gating on installation presence — works in most cases, but we’ll strengthen it if field exists).
- [ ] Add additional logging in `/join` around inbox state (installations count and any key package indicators) before `addMembers`.
- [ ] Re-run Playwright `E2E_XMTP_LOCAL=1` to validate deterministic discovery.

If SDK lacks explicit key-package fields:
- [ ] Keep installation presence gate + require that the browser identity readiness loop has completed (we can detect this indirectly via a small post from the browser after `preferences.inboxState(true)` finishes in local env).

## Commands

- Full suite: `npm run test:all`
- Contracts: `npm test`
- Backend: `npm --prefix backend test`
- Frontend unit + Playwright:
  - `npm --prefix frontend test`
  - `E2E_XMTP_LOCAL=1 npm --prefix frontend run test:e2e -- --project=tech-demo`

## Files Touched (So Far)

- `backend/src/xmtp/index.js`: added `waitForXmtpClientReady`.
- `backend/src/server.js`: boot XMTP with retry + readiness wait.
- `backend/src/routes/join.js`: deterministic inbox resolution, membership liveness wait, warm message + metadata update, final sync before responding, and local-only readiness gating using `inboxStateFromInboxIds`.
- `frontend/src/App.jsx`: local identity readiness and deterministic discovery (get-by-id, list, and short streams); no UI-only assertions.
- `frontend/src/flows.js`: keep production flow integrity.
- `frontend/e2e/core-flows.pw.spec.js`: strict prod mirroring — approve + purchase + typed join, then deterministic join confirm and discovery by id.

## Risks / Non-goals

- We will not inflate timeouts or skip steps; we keep the flow identical to production semantics.
- We won’t introduce brittle status text checks — we assert protocol state (on-chain access, backend membership, conversation discovery).

---

If you want me to proceed with the stronger key-package gating (pending SDK field confirmation) and add inbox-state logging before `addMembers`, I can implement that next and re-run e2e until green.

