# TEMPL Refactor Checklist

Derived from the latest review conversation with Luiz (OpenZeppelin) and Marcus (templ):

1. **Improve percent math precision**
   - Use `Math.mulDiv` to minimise rounding drift and ensure exact accounting (burn, treasury, member pool, protocol, treasury disbandments).
   - Revisit the fractional basis for fee splits (`TOTAL_PERCENT`) and only increase it beyond 100 if a deployment actually needs sub-percentage precision, keeping the default simple otherwise.

2. **Trim on-chain storage to the essentials**
   - Remove book-keeping fields that can be reconstructed off-chain (e.g. cumulative fee totals, purchase counters).
   - Compute or emit data needed for analytics via events so frontends index them instead of reading storage slots.
   - Prefer keeping member-level snapshots only where required for correctness (claim baselines), otherwise derive totals lazily.

3. **Refine reward accounting**
   - Keep per-member reward snapshots minimal, basing claims on global cumulative counters captured at join-time.
   - Ensure distributions (member pool, external rewards) rely on consistent global snapshots rather than per-user tallies to reduce state churn and rounding "dust".

4. **Flatten module inheritance**
   - Restructure the contract hierarchy so `TEMPL` composes independent modules (`TemplMembership`, `TemplTreasury`, `TemplGovernance`, etc.) directly instead of chaining `A -> B -> C` inheritance.
   - Move shared helpers into libraries or base contracts with single inheritance to simplify the storage layout and auditing.

5. **Avoid storage-heavy member lists**
   - Drop `memberList` arrays in favour of lightweight counters/mappings since iteration is never required on-chain.
   - Update membership limit, quorum, and distribution logic to use the new counters.

6. **General cleanup**
   - Remove repeated logic, centralise configuration validation, and keep codepaths focused on core on-chain responsibilities.
   - Update docs/tests/frontends to reflect the slimmed-down state surface.
