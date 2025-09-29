# Documentation Index

Use this page as your map through the repo. It suggests a learning path and links to focused docs so you can go deep only when you need to.

## Learning Path

1. Templ at a glance – [TEMPL_TECH_SPEC.MD](TEMPL_TECH_SPEC.MD)
2. How the parts talk – [CORE_FLOW_DOCS.MD](CORE_FLOW_DOCS.MD)
3. What’s on-chain – [CONTRACTS.md](CONTRACTS.md)
4. APIs and persistence – [BACKEND.md](BACKEND.md) + [PERSISTENCE.md](PERSISTENCE.md)
5. UI routes and env – [FRONTEND.md](FRONTEND.md)
6. Run it – [TEST_LOCALLY.md](TEST_LOCALLY.md) → [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

## Quick Links

- Architecture: [TEMPL_TECH_SPEC.MD](TEMPL_TECH_SPEC.MD)
- Flow diagrams: [CORE_FLOW_DOCS.MD](CORE_FLOW_DOCS.MD)
- Contracts reference: [CONTRACTS.md](CONTRACTS.md)
- Backend API + env: [BACKEND.md](BACKEND.md)
- Persistence (D1/SQLite): [PERSISTENCE.md](PERSISTENCE.md)
- Frontend routes + env: [FRONTEND.md](FRONTEND.md)
- Deploy to prod: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- Production readiness: [PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md)
- Local dev walkthrough: [TEST_LOCALLY.md](TEST_LOCALLY.md)

## Glossary

- Templ – A deployed membership contract instance (type `TEMPL`).
- Priest – The address with special governance powers (changeable by proposal).
- Member – A wallet that has purchased access in the templ’s access token.
- Factory – `TemplFactory` contract that mints templ instances and fixes the protocol fee recipient/percent.
- Home link – On-chain string (`templHomeLink`) used in the UI and Telegram messages as the canonical URL for a community.
- Dictatorship mode – When enabled, the priest can execute the otherwise DAO-governed actions without proposals.

## Shortcuts

- Just want to run it locally? Open `TEST_LOCALLY.md`.
- Ready to ship? Open `DEPLOYMENT_GUIDE.md`, then double-check `PRODUCTION_CHECKLIST.md`.
