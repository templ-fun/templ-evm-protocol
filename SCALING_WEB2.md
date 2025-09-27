# Web2 Scaling Plan for 1M Templs

## Reality Check
- Contract layer already handles scale, but even with Cloudflare D1 persistence the backend keeps every templ binding in memory (`backend/src/server.js`). At 1M templs this spawns one long-lived `ethers.Contract` listener per templ and stores the full record set in a single Node process, overwhelming memory and the upstream RPC provider.
- Background cron tasks iterate the entire in-memory map every 60s/5s (`checkProposals`, `sendDailyDigests`, `pollBindings`). With 1M templs these O(n) loops become CPU-bound and hammer the chain with `getProposal*`/balance calls.
- Startup restores all templs before serving requests, so a single instance must hydrate the complete dataset and connect listeners for every contract.
- Telegram delivery is a direct `fetch` per notification with no queues, rate limits, or retry policy. Any burst of events will breach Telegram's 30 msg/sec threshold and drop alerts.
- The frontend bootstraps by downloading the full templ list and refreshing on-chain stats for each contract during page load. That is millions of JSON rows plus millions of RPC calls in the browser.

## Notifications & Backend Scaling
- **Lean harder on the datastore we already have (Cloudflare D1).** Persist proposal state, scheduling fields, and watcher cursors instead of keeping the entire set in RAM so multiple Workers/cron jobs can shard the workload.
- **Swap per-contract listeners for log ingestion.** Use `eth_getLogs` batching, a dedicated indexer (The Graph, Substreams, custom worker), or a service like Alchemy Transfers to stream events into the datastore.
- **Introduce a queue-based notification pipeline.** Decode events upstream, push work items to a durable queue (Kafka, Redis Streams, SQS). Multiple worker processes pull, enrich from cached contract state, and dispatch messages.
- **Implement rate-aware Telegram dispatch.** Centralize send logic with per-chat/global throttles, exponential backoff, and dead-letter handling. Batch updates when possible.
- **Sharded background jobs.** Persist next-run timestamps for digests/quorum reminders. Use a scheduler to enqueue due jobs and let workers handle their shard, eliminating global Map scans.
- **Efficient binding handshakes.** Track pending binding codes in the database keyed by code. Telegram polling can then match in O(1) without scanning every templ record.
- **Horizontal scale.** With state in the database and work in queues, web instances can scale horizontally behind a load balancer, and worker fleets can grow independently.

## Frontend Scaling
- **Paginate and filter templ discovery.** Replace the single `/templs` dump with paginated, filterable endpoints. Add server-side search by contract/priest/home link.
- **Lazy-load details.** Fetch lightweight list rows first (contract, headline stats), then load deep stats when the user opens a templ. Consider pre-rendered summaries in the backend cache.
- **Virtualize long lists.** Combine pagination with virtual scrolling to keep DOM size manageable when browsing many templs.
- **Shared data layer.** Expose cached stats via the backend/indexer so the browser does not fan out to 1M on-chain reads. Coalesce requests with SWR/react-query style caching.

## Implementation Checklist
1. Design the event ingestion + queue architecture (data schema, sharding keys, worker concurrency, Telegram rate handling).
2. Introduce the durable datastore for templ metadata and migrate existing persistence.
3. Ship new backend APIs for paginated templ discovery and per-templ detail.
4. Update the frontend data layer to consume paginated feeds, add virtualization, and fetch detailed stats on demand.
5. Roll out monitoring: queue depth, notification lag, Telegram error rates, API latencies, and indexer catch-up lag.
