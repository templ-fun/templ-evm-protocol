# Protocol handbook

Every document in this folder describes the current templ protocol and its supporting services. Read everything here as an authoritative reference—the codebase aligns with these docs, and the docs are written to make you productive without additional context.

## How to study templ

| Step | When to read | Why it matters |
| --- | --- | --- |
| 1. [TEMPL_TECH_SPEC.MD](TEMPL_TECH_SPEC.MD) | First pass | End-to-end architecture: factory → templ → backend → frontend → Telegram. |
| 2. [CORE_FLOW_DOCS.MD](CORE_FLOW_DOCS.MD) | When you need visuals | Flowcharts + sequence diagrams that show how contracts, the API, and Telegram interact. |
| 3. [CONTRACTS.md](CONTRACTS.md) | Before auditing or extending Solidity | Module-by-module contract behaviour, governance rules, and error surface. |
| 4. [BACKEND.md](BACKEND.md) & [PERSISTENCE.md](PERSISTENCE.md) | When operating or modifying the API | HTTP interface, environment variables, background jobs, and database schema. |
| 5. [FRONTEND.md](FRONTEND.md) | Before touching the SPA | Route catalogue, configuration, and wallet flows. |
| 6. [TEST_LOCALLY.md](TEST_LOCALLY.md) → [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Running templ end-to-end | Local stack bootstrap followed by the production Cloudflare rollout checklist. |

## Quick reference

- Need every command to boot the stack locally? Jump to [TEST_LOCALLY.md](TEST_LOCALLY.md).
- Troubleshooting Telegram bindings or backend leadership? Start with [BACKEND.md](BACKEND.md) and [PERSISTENCE.md](PERSISTENCE.md).
- Auditing a templ deployment? Pair [CONTRACTS.md](CONTRACTS.md) with the flow diagrams in [CORE_FLOW_DOCS.MD](CORE_FLOW_DOCS.MD).
- Shipping a release? Walk through [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) and keep it open until each checkbox is complete.

## Glossary

- **Templ** – A deployed membership contract (`TEMPL`) produced by the factory.
- **Priest** – Wallet with elevated governance powers; auto-enrolled as the founding member.
- **Member** – Wallet that joined by paying the templ’s entry fee in the access token.
- **Factory** – `TemplFactory` contract that deploys templ instances and enforces the protocol fee share.
- **Home link** – Canonical templ URL stored on-chain (`templHomeLink`) and surfaced throughout the app + Telegram.
- **Dictatorship mode** – Governance flag that lets the priest execute the usual DAO actions directly.

## Next steps

- Local environment ready? Follow the step-by-step checklist in [TEST_LOCALLY.md](TEST_LOCALLY.md).
- Preparing for production? Go straight to [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).
