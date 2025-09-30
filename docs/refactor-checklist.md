# TEMPL Refactor Checklist

Derived from the latest review conversation with Luiz (OpenZeppelin) and Marcus (templ):

1. **Percent math precision**
   - `Math.mulDiv` minimises rounding drift and keeps accounting exact across burn, treasury, member pool, protocol, and treasury disbandments.
   - A basis-points denominator (`TOTAL_PERCENT = 10_000`) lets governance inputs and fee splits support two decimal places while remaining deterministic on chain.

2. **Trimmed on-chain storage**
   - Book-keeping fields that can be reconstructed off-chain (e.g. cumulative fee totals, purchase counters) are omitted.
   - Data needed for analytics emits through events so frontends index them instead of reading storage slots.
   - Member-level snapshots exist only where required for correctness (claim baselines); other totals derive lazily.

3. **Reward accounting**
   - Per-member reward snapshots stay minimal, basing claims on global cumulative counters captured at join time.
   - Distributions (member pool, external rewards) rely on consistent global snapshots rather than per-user tallies to reduce state churn and rounding "dust".

4. **Flattened module inheritance**
   - The contract hierarchy composes independent modules (`TemplMembership`, `TemplTreasury`, `TemplGovernance`, etc.) directly instead of chaining `A -> B -> C` inheritance.
   - Shared helpers live in libraries or base contracts with single inheritance to simplify the storage layout and auditing.

5. **Lean membership tracking**
   - `memberList` arrays are replaced with lightweight counters/mappings since iteration is never required on-chain.
   - Membership limit, quorum, and distribution logic use the new counters.

6. **General cleanup**
   - Repeated logic is removed, configuration validation is centralised, and codepaths stay focused on core on-chain responsibilities.
   - Docs/tests/frontends reflect the slimmed-down state surface.
