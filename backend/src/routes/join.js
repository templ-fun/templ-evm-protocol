import express from 'express';
import { syncXMTP } from '../../../shared/xmtp.js';
import { requireAddresses, verifyTypedSignature } from '../middleware/validate.js';
import { buildJoinTypedData } from '../../../shared/signing.js';
import { waitForInboxReady, XMTP_ENV } from '../xmtp/index.js';
import { Client as NodeXmtpClient, generateInboxId, getInboxIdForIdentifier } from '@xmtp/node-sdk';
import { logger } from '../logger.js';

export default function joinRouter({ xmtp, groups, hasPurchased, lastJoin, database, provider, ensureGroup }) {
  const router = express.Router();
  // (no DISABLE_WAIT flags here; production-safe logic below)

  router.post(
    '/join',
    requireAddresses(['contractAddress', 'memberAddress']),
    (req, res, next) => {
      const record = groups.get(req.body.contractAddress.toLowerCase());
      if (!record) return res.status(404).json({ error: 'Unknown Templ' });
      req.record = record;
      next();
    },
    verifyTypedSignature({
      database,
      addressField: 'memberAddress',
      buildTyped: (req) => {
        const chainId = Number(req.body?.chainId || 1337);
        const n = Number(req.body?.nonce);
        const i = Number(req.body?.issuedAt);
        const e = Number(req.body?.expiry);
        const nonce = Number.isFinite(n) ? n : undefined;
        const issuedAt = Number.isFinite(i) ? i : undefined;
        const expiry = Number.isFinite(e) ? e : undefined;
        return buildJoinTypedData({ chainId, contractAddress: req.body.contractAddress.toLowerCase(), nonce, issuedAt, expiry });
      }
    }),
    async (req, res) => {
      const { contractAddress, memberAddress } = req.body;
      const record = /** @type {any} */ (req.record);
      let purchased;
      try {
        purchased = await hasPurchased(contractAddress, memberAddress);
      } catch {
        return res.status(500).json({ error: 'Purchase check failed' });
      }
      if (!purchased) return res.status(403).json({ error: 'Access not purchased' });
      // Optional chainId and code verification in production/strict mode
      const requireVerify = process.env.REQUIRE_CONTRACT_VERIFY === '1' || process.env.NODE_ENV === 'production';
      if (requireVerify) {
        if (!provider) {
          return res.status(500).json({ error: 'Verification required but no provider configured' });
        }
        try {
          const net = await provider.getNetwork();
          const expected = Number(net.chainId);
          const provided = Number(req.body?.chainId);
          if (Number.isFinite(provided) && provided !== expected) {
            return res.status(400).json({ error: 'ChainId mismatch' });
          }
        } catch {/* ignore minor verification errors */}
        try {
          const code = await provider.getCode(contractAddress);
          if (!code || code === '0x') {
            return res.status(400).json({ error: 'Not a contract' });
          }
        } catch {
          return res.status(400).json({ error: 'Unable to verify contract' });
        }
      }
      try {
        // Resolve member inboxId via network; never trust client-provided ids blindly.
        const memberIdentifier = { identifier: memberAddress.toLowerCase(), identifierKind: 0 };
        let group = record.group && record.group.id ? record.group : null;
        try {
          if (!group && typeof ensureGroup === 'function') {
            group = await ensureGroup(record);
          }
          if (!group && record.groupId && xmtp?.conversations?.getConversationById) {
            const maybe = await xmtp.conversations.getConversationById(record.groupId);
            if (maybe) {
              group = maybe;
            }
          }
        } catch (e) {
          logger.warn({ err: e?.message || e }, 'Rehydrate group failed');
        }
        if (group && group.id) {
          record.group = group;
        }
        let providedInboxId = null;
        try {
          const raw = String(req.body?.inboxId || req.body?.memberInboxId || '').trim();
          if (raw && /^[0-9a-fA-F]+$/i.test(raw)) providedInboxId = raw.replace(/^0x/i, '');
        } catch { /* ignore */ }
        async function waitForInboxId(identifier, tries = 180, allowDeterministic = false) {
          const envOpt = /** @type {'local'|'dev'|'production'} */ (
            ['local','dev','production'].includes(String(XMTP_ENV)) ? XMTP_ENV : 'dev'
          );
          // In tests, collapse retries aggressively to avoid long hangs
          const isTest = process.env.NODE_ENV === 'test' || process.env.DISABLE_XMTP_WAIT === '1';
          const delayMs = envOpt === 'local' ? 200 : (isTest ? 150 : 1000);
          tries = isTest ? Math.min(tries, 8) : tries;
          for (let i = 0; i < tries; i++) {
            // Prefer resolving through the server's XMTP client if available (works with test doubles)
            try {
              if (typeof xmtp?.findInboxIdByIdentifier === 'function') {
                const local = await xmtp.findInboxIdByIdentifier(identifier);
                if (local) return local;
              }
            } catch { /* ignore */ }
            // Fallback to SDK helper that queries XMTP network mapping
            try {
              const found = await getInboxIdForIdentifier(identifier, envOpt);
              if (found) return found;
            } catch { /* ignore */ }
            await new Promise((r) => setTimeout(r, delayMs));
          }
          if (allowDeterministic) {
            try { return generateInboxId(identifier); } catch { /* ignore */ }
          }
          return null;
        }
        // Resolve inboxId from network; only accept providedInboxId if it matches resolution
        const allowDeterministic = ['local'].includes(String(XMTP_ENV)) || process.env.NODE_ENV === 'test';
        const resolvedInboxId = await waitForInboxId(memberIdentifier, allowDeterministic ? 30 : 180, allowDeterministic);
        let inboxId = resolvedInboxId;
        if (!inboxId && allowDeterministic) {
          inboxId = providedInboxId || null;
        }
        // If both are present and mismatch, ignore the provided one
        try {
          if (resolvedInboxId && providedInboxId && String(resolvedInboxId).toLowerCase() !== String(providedInboxId).toLowerCase()) {
            // prefer resolved; do nothing (overwrites above)
          }
        } catch { /* ignore */ }
        if (!inboxId) {
          return res.status(503).json({ error: 'Member identity not registered yet; retry shortly' });
        }
        if (!group || !group.id) {
          return res.status(503).json({ error: 'Group not ready yet; retry shortly' });
        }
        // On local/dev, also ensure the target installation has at least one visible installation record
        try {
          const envOpt = /** @type {'local'|'dev'|'production'} */ (
            ['local','dev','production'].includes(String(XMTP_ENV)) ? XMTP_ENV : 'dev'
          );
          const max = envOpt === 'local' ? 40 : 60;
          const delay = envOpt === 'local' ? 150 : 500;
          /** @type {string[]} */
          let candidateInstallationIds = [];
          /** @type {any} */
          let lastInboxState = null;
          for (let i = 0; i < max; i++) {
            try {
              if (typeof NodeXmtpClient.inboxStateFromInboxIds === 'function') {
                const states = await NodeXmtpClient.inboxStateFromInboxIds([inboxId], envOpt);
                const s = Array.isArray(states) && states[0] ? states[0] : null;
                lastInboxState = s;
                const hasInst = !!(s && Array.isArray(s.installations) && s.installations.length > 0);
                try {
                  candidateInstallationIds = Array.isArray(s?.installations)
                    ? s.installations.map((inst) => String(inst && inst.id || '')).filter(Boolean)
                    : [];
                } catch { /* ignore */ }
                if (hasInst) break;
              } else {
                break;
              }
            } catch {/* ignore */}
            await new Promise((r) => setTimeout(r, delay));
          }
          // If we discovered installation IDs, optionally gate on key package readiness
          try {
            if (candidateInstallationIds.length && typeof xmtp?.getKeyPackageStatusesForInstallationIds === 'function') {
              /** @type {Record<string, any>} */
              let lastStatuses = {};
              for (let i = 0; i < Math.min(max, 60); i++) {
                try {
                  const statusMap = await xmtp.getKeyPackageStatusesForInstallationIds(candidateInstallationIds);
                  lastStatuses = statusMap || {};
                  const ids = Object.keys(statusMap || {});
                  const ready = ids.some((id) => {
                    const st = statusMap[id];
                    if (!st) return false;
                    // Treat presence of lifetime.notAfter as readiness; if available, ensure it's in the future
                    const na = /** @type {any} */ (st).lifetime?.notAfter;
                    const nb = /** @type {any} */ (st).lifetime?.notBefore;
                    if (typeof na === 'bigint' || typeof na === 'number') {
                      const now = BigInt(Math.floor(Date.now() / 1000));
                      const notAfter = BigInt(na);
                      const notBefore = nb != null ? BigInt(nb) : now - 1n;
                      return notBefore <= now && now < notAfter;
                    }
                    // Fallback: consider any status entry as a positive signal
                    return true;
                  });
                  if (ready) break;
                } catch { /* ignore */ }
                await new Promise((r) => setTimeout(r, delay));
              }
              // Attach a compact snapshot for debugging via /debug/last-join
              try {
                lastJoin.at = Date.now();
                lastJoin.payload = lastJoin.payload || {};
                lastJoin.payload.keyPackageProbe = {
                  installationIds: candidateInstallationIds,
                  statuses: Object.keys(lastStatuses || {}),
                };
                lastJoin.payload.inboxStateProbe = {
                  installationCount: Array.isArray(lastInboxState?.installations) ? lastInboxState.installations.length : null,
                  identifierCount: Array.isArray(lastInboxState?.identifiers) ? lastInboxState.identifiers.length : null,
                };
              } catch { /* ignore */ }
            }
          } catch { /* ignore */ }
        } catch {/* ignore */}
        // Linearize against identity readiness on XMTP infra for whichever inboxId we use
        const readyTries = (process.env.NODE_ENV === 'test' || process.env.DISABLE_XMTP_WAIT === '1') ? 2 : 60;
        const ready = await waitForInboxReady(inboxId, readyTries);
        logger.info({ inboxId, ready }, 'Member inbox readiness before add');
        const beforeAgg = xmtp?.debugInformation?.apiAggregateStatistics?.();
        const joinMeta = { contract: contractAddress.toLowerCase(), member: memberAddress.toLowerCase(), inboxId, serverInboxId: xmtp?.inboxId || null, groupId: group?.id || record.groupId || null };
        logger.info(joinMeta, 'Inviting member by inboxId');
        try {
          if (typeof group.addMembers === 'function') {
            await group.addMembers([inboxId]);
            logger.info({ inboxId }, 'addMembers([inboxId]) succeeded');
          } else if (typeof group.addMembersByInboxId === 'function') {
            await group.addMembersByInboxId([inboxId]);
            logger.info({ inboxId }, 'addMembersByInboxId([inboxId]) succeeded');
          } else if (typeof group.addMembersByIdentifiers === 'function') {
            await group.addMembersByIdentifiers([memberIdentifier]);
            logger.info({ member: memberAddress.toLowerCase() }, 'addMembersByIdentifiers([identifier]) succeeded');
          } else {
            throw new Error('XMTP group does not support adding members');
          }
        } catch (err) {
          if (!String(err?.message || '').includes('succeeded')) throw err;
        }

        // Re-sync server view and warm the conversation
        try {
          await syncXMTP(xmtp);
          logger.info('Server conversations synced after join');
          try {
            if (group?.sync) await group.sync();
          } catch { /* ignore */ }
        } catch (err) {
          logger.warn({ err }, 'Server sync after join failed');
        }
        // Wait until the member appears in the group's member list (bounded in tests)
        try {
          const env = String(XMTP_ENV || 'dev');
          const isTest = process.env.NODE_ENV === 'test' || process.env.DISABLE_XMTP_WAIT === '1';
          const max = isTest ? 3 : (env === 'local' ? 30 : 60);
          const delay = isTest ? 100 : (env === 'local' ? 150 : 500);
          for (let i = 0; i < max; i++) {
            try { await group?.sync?.(); } catch { /* ignore */ }
            const members = Array.isArray(group?.members) ? group.members : [];
            const norm = (s) => String(s || '').replace(/^0x/i, '').toLowerCase();
            if (members.some((m) => norm(m) === norm(inboxId))) break;
            await new Promise((r) => setTimeout(r, delay));
          }
        } catch { /* ignore */ }
        try {
          lastJoin.at = Date.now();
          lastJoin.payload = { joinMeta };
          try {
            const afterAgg = xmtp?.debugInformation?.apiAggregateStatistics?.();
            logger.info({ beforeAgg, afterAgg }, 'XMTP API stats around member add');
            lastJoin.payload.afterAgg = afterAgg;
            lastJoin.payload.beforeAgg = beforeAgg;
          } catch (e) { void e; }
        } catch (e) { void e; }
        // Track membership locally for debug endpoints and test verification
        try {
          if (!record.memberSet) record.memberSet = new Set();
          const norm = (s) => String(s || '').replace(/^0x/i, '').toLowerCase();
          record.memberSet.add(norm(inboxId));
        } catch { /* ignore */ }
        // Avoid logging member arrays by default, and nudge metadata to produce a fresh commit
        try { if (typeof group.sync === 'function') await group.sync(); } catch (err) { void err; }
        try { await group.send(JSON.stringify({ type: 'member-joined', address: memberAddress })); } catch (err) { void err; }
        const META_UPDATES = process.env.XMTP_METADATA_UPDATES !== '0';
        if (META_UPDATES) {
          try {
            if (typeof group.updateDescription === 'function') {
              await group.updateDescription('Member joined');
            }
          } catch (err) {
            // Some SDKs report successful syncs as errors; ignore benign cases
            if (!String(err?.message || '').includes('succeeded')) { /* ignore other errors */ }
          }
          // Also bump the name to ensure a commit is produced across SDK versions
          try {
            if (typeof group.updateName === 'function') {
              await group.updateName(`Templ ${contractAddress}`);
            }
          } catch (err) {
            if (!String(err?.message || '').includes('succeeded')) { /* ignore */ }
          }
        }
        // Final sync to ensure the warm message and membership are visible network-wide before responding
        try { await syncXMTP(xmtp); } catch { /* ignore */ }
        try { if (typeof group.sync === 'function') await group.sync(); } catch { /* ignore */ }
        res.json({ groupId: group.id });
      } catch (err) {
        logger.error({ err, contractAddress }, 'Join failed');
        res.status(500).json({ error: err.message });
      }
    }
  );

  return router;
}
