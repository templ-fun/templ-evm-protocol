## `EchidnaTemplHarness`

Echidna property-based fuzzing harness for TEMPL.
- Exposes safe state-changing targets: joinFor and joinForWithReferral
- Asserts invariants over fee split and entry fee bounds




### `fuzzJoinFor(address recipient)` (external)

Pay for another wallet to join using the harness balance.



### `fuzzJoinForWithReferral(address recipient, address referral)` (external)

Pay for another wallet to join and attempt a referral credit.



### `echidna_fee_split_sums_to_10000() → bool` (external)

Fee split always sums to 10_000 bps including protocol share.



### `echidna_entry_fee_bounded() → bool` (external)

Entry fee never exceeds the uint128 saturation limit used in on-chain math.



### `echidna_membercount_respects_cap() → bool` (external)

Member count never exceeds configured cap (0 = uncapped).



### `echidna_cumulative_rewards_monotonic() → bool` (external)

Cumulative per-member rewards never decrease.



### `echidna_treasury_balance_monotonic() → bool` (external)

Treasury balance does not decrease during join operations.



### `echidna_membercount_monotonic() → bool` (external)

Member count never decreases (there is no member removal flow).



### `_syncTrackers()` (internal)








