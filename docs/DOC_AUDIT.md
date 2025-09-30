# Documentation audit notes

## Summary

Two documentation discrepancies were identified during the audit, and the relevant docs already reflect the fixes:

1. `docs/PERSISTENCE.md` claims the backend persists only two tables in Cloudflare D1. The current persistence layer also creates and uses a `leader_election` table (plus index) for coordinating background jobs across replicas.
2. `docs/CORE_FLOW_DOCS.MD` omits the `leader_election` table from its data persistence summary even though the backend depends on it for leader election when D1/SQLite storage is configured.

## Evidence

- `backend/src/persistence/index.js` initialises `leader_election` alongside `templ_bindings` and `used_signatures`. It also exposes helpers such as `acquireLeadership` and `refreshLeadership` that operate on this table.
- `backend/src/persistence/schema.sql` creates `leader_election` (with `idx_leader_election_expires`).

## Status

- `docs/PERSISTENCE.md` documents the `leader_election` table and explains how the backend coordinates leadership when multiple replicas share the same persistence binding.
- `docs/CORE_FLOW_DOCS.MD` calls out the leader-election table in its data persistence summary so operators know when leadership comes into play.
