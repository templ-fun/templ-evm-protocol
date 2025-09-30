# Documentation Index

This folder is the canonical reference for templ. Use the sections below to pick the depth you need.

## Suggested path

1. Big-picture spec – [TEMPL_TECH_SPEC.MD](TEMPL_TECH_SPEC.MD)
2. Flow diagrams – [CORE_FLOW_DOCS.MD](CORE_FLOW_DOCS.MD)
3. Smart contracts – [CONTRACTS.md](CONTRACTS.md)
4. Backend API + persistence – [BACKEND.md](BACKEND.md) and [PERSISTENCE.md](PERSISTENCE.md)
5. Frontend routes – [FRONTEND.md](FRONTEND.md)
6. Local setup → prod rollout – [TEST_LOCALLY.md](TEST_LOCALLY.md) then [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

## Quick links

- Architecture overview – [TEMPL_TECH_SPEC.MD](TEMPL_TECH_SPEC.MD)
- Sequence diagrams – [CORE_FLOW_DOCS.MD](CORE_FLOW_DOCS.MD)
- Contract reference – [CONTRACTS.md](CONTRACTS.md)
- Backend configuration – [BACKEND.md](BACKEND.md)
- Persistence adapters – [PERSISTENCE.md](PERSISTENCE.md)
- Frontend routes + env – [FRONTEND.md](FRONTEND.md)
- Local development checklist – [TEST_LOCALLY.md](TEST_LOCALLY.md)
- Deployment checklist – [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

## Glossary

- Templ – A deployed membership contract instance (type `TEMPL`).
- Priest – Address with elevated governance powers.
- Member – Wallet that purchased access in the templ’s access token.
- Factory – `TemplFactory` contract that mints templ instances and locks the protocol fee share.
- Home link – On-chain string exported by `templHomeLink` and surfaced across the app and Telegram messages.
- Dictatorship mode – Governance flag that lets the priest execute the usual DAO actions directly.

## Shortcuts

- Need a local environment fast? Open `TEST_LOCALLY.md`.
- Ready for production? Go straight to `DEPLOYMENT_GUIDE.md`.
