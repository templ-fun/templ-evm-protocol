# Broken Flows Analysis

The end-to-end test `frontend/src/core-flows.e2e.test.js` attempts to deploy the TEMPL contract, start the backend server, and exercise the full core flows using live XMTP messaging.

During execution, the suite fails while creating XMTP clients:

```
Error: fetch failed
    at Function.fromObject ... ApiClient.ts:56
```

This error arises when `@xmtp/xmtp-js` tries to reach the XMTP dev network. The request does not succeed, preventing the backend from creating a group and blocking all subsequent flows (join, messaging, moderation, proposals).

To enable full end-to-end validation, ensure the test environment has network access to the XMTP dev API and any required credentials. Once the XMTP client initializes successfully, the remaining flows can proceed against the deployed contract and backend server.
