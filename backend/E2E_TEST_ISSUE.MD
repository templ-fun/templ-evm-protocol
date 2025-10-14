# E2E Join Flow Reference

The Playwright suite exercises the full templ journey—deploy, join, govern, claim—using the harness in `frontend/e2e/core-flows.pw.spec.js`. Use this note as the authoritative description of how the scripted flow interacts with the stack.

## Test bootstrap

1. **Contracts.** Each run deploys a fresh `TestToken` and `TemplFactory` with the priest wallet supplied by the fixture. The factory is immediately switched to permissionless mode (`setPermissionless(true)`) so any funded wallet can create templs during the browser session.
2. **Wallet bridge.** The harness provisions a dedicated UI wallet (random by default, falling back to other funded accounts) and pipes JSON-RPC calls through Hardhat. `window.ethereum.request` handles `eth_sendTransaction`, `eth_signTypedData_v4`, and basic chain queries so the SPA behaves as if MetaMask were present.
3. **XMTP readiness.** Before each attempt, the script clears OPFS and IndexedDB to remove prior XMTP state, then rotates through the candidate wallets until the app publishes `window.__templReady.xmtp = true`.
4. **Auto deploy.** Once the SPA reports the signer + XMTP clients are ready, the harness triggers the built-in auto-deploy effect (`window.__templSetAutoDeploy(true)`). The UI submits `factory.createTemplWithConfig` using the test token and waits for the status banner to display `✅ Templ deployed`.

## Join + verification

1. The test wallet calls `join()` on the newly deployed templ.
2. After the transaction confirms, the browser signs the EIP-712 join payload via the bridge and POSTs `/join` to the backend.
3. The backend verifies `isMember` on chain, returns templ metadata + links, and (when XMTP is enabled) adds the member to the templ’s XMTP group.

The harness asserts both the backend response and the XMTP invitation by polling the UI for success indicators and reading browser logs when `PW_E2E_VERBOSE=1`.

## Debug checklist

- **Permissionless creation.** Ensure `setPermissionless(true)` runs during setup; otherwise Hardhat reverts templ deployment for non-deployer wallets.
- **Nonce alignment.** The bridge uses Hardhat’s pending nonce each time it sends a transaction. If you modify the harness, keep pending/confirmed nonces in sync to avoid `Nonce too low` errors.
- **Storage reset.** XMTP maintains OPFS/IndexedDB state. The existing helper clears both before each wallet attempt; retain that logic if you tweak the harness.
- **Backend visibility.** Run Playwright with `PW_E2E_VERBOSE=1` to surface `/join` requests and XMTP status updates in the test log.

With these pieces in place, `npm run test:all` exercises the join flow reliably on every run.
