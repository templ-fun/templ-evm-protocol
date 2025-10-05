import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Client } from '@xmtp/browser-sdk';
import templArtifact from '../contracts/TEMPL.json';
import { BACKEND_URL } from '../config.js';
import { syncXMTP, waitForConversation } from '../../../shared/xmtp.js';
import { sanitizeLink } from '../../../shared/linkSanitizer.js';
import { verifyMembership, fetchMemberPoolStats, claimMemberPool } from '../services/membership.js';
import { proposeVote, voteOnProposal, executeProposal, watchProposals } from '../services/governance.js';
import { fetchTemplStats } from '../services/templs.js';
import { button, colorTokens, form, layout, palette, surface, text } from '../ui/theme.js';

const sortBySentAt = (a, b) => a.sentAt.getTime() - b.sentAt.getTime();

const XMTP_ENV = import.meta.env?.VITE_XMTP_ENV || globalThis?.process?.env?.XMTP_ENV || 'production';

function resolveXmtpEnv() {
  try {
    const forced = import.meta.env?.VITE_XMTP_ENV;
    if (typeof forced === 'string' && forced.trim()) {
      return forced.trim();
    }
  } catch {}
  if (typeof window !== 'undefined') {
    const host = window.location?.hostname || '';
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'dev';
    }
  }
  return 'production';
}

const PROPOSAL_ACTIONS = [
  { value: 'setJoinPaused', label: 'Pause / Resume Joins' },
  { value: 'setDictatorship', label: 'Toggle Dictatorship' },
  { value: 'changePriest', label: 'Change Priest' },
  { value: 'setMaxMembers', label: 'Set Max Members' },
  { value: 'withdrawTreasury', label: 'Withdraw Treasury' },
  { value: 'updateConfig', label: 'Update Config & Fee Split' },
  { value: 'setHomeLink', label: 'Update Home Link' },
  { value: 'setEntryFeeCurve', label: 'Update Entry Fee Curve' },
  { value: 'disbandTreasury', label: 'Disband Treasury' },
  { value: 'customCallData', label: 'Custom callData (advanced)' }
];

function shortAddress(value) {
  if (!value) return '';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return date.toISOString();
  }
}

function parseAmountRaw(value) {
  if (value === undefined || value === null || value === '') return null;
  try {
    const asBig = BigInt(value);
    if (asBig < 0n) throw new Error('Amount must be positive');
    return asBig.toString();
  } catch {
    throw new Error('Enter amount in wei (numeric string)');
  }
}

function renderStat(label, primary, secondary) {
  if (!primary) return null;
  return (
    <div className="flex flex-col">
      <span className={text.meta}>{label}</span>
      <span className={`${text.mono} text-sm`}>{primary}</span>
      {secondary ? <span className={text.hint}>{secondary}</span> : null}
    </div>
  );
}

export function ChatPage({
  ethers,
  signer,
  walletAddress,
  onConnectWallet,
  templAddress,
  pushMessage,
  readProvider
}) {
  const walletAddressLower = walletAddress?.toLowerCase() || '';
  const templAddressLower = useMemo(() => (templAddress ? templAddress.toLowerCase() : ''), [templAddress]);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [xmtpClient, setXmtpClient] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [groupId, setGroupId] = useState('');
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [stats, setStats] = useState(null);
  const [proposalComposerOpen, setProposalComposerOpen] = useState(false);
  const [proposalAction, setProposalAction] = useState('setJoinPaused');
  const [proposalTitle, setProposalTitle] = useState('');
  const [proposalDescription, setProposalDescription] = useState('');
  const [proposalParams, setProposalParams] = useState({});
  const [proposals, setProposals] = useState(new Map());
  const [votedChoices, setVotedChoices] = useState(new Map());
  const [claimModalOpen, setClaimModalOpen] = useState(false);
  const [claimInfo, setClaimInfo] = useState(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [chainTimeMs, setChainTimeMs] = useState(() => Date.now());
  const [debugSteps, setDebugSteps] = useState([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [pendingNewMessages, setPendingNewMessages] = useState(0);

  const messageIdsRef = useRef(new Set());
  const proposalMessageRef = useRef(new Map());
  const streamAbortRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const creatingXmtpPromiseRef = useRef(null);
  const identityReadyRef = useRef(false);
  const identityReadyPromiseRef = useRef(null);

  const templStatsKey = `${templAddressLower}-${walletAddressLower}`;

  const scrollToLatest = useCallback((behavior = 'auto') => {
    const anchor = messagesEndRef.current;
    if (!anchor) return;
    const execute = () => anchor.scrollIntoView({ behavior, block: 'end' });
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(execute);
    } else {
      execute();
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setChainTimeMs(now);
      setDebugSteps((prev) => [...prev, `heartbeat:${now}`].slice(-20));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const recordDebug = useCallback((step) => {
    setDebugSteps((prev) => [...prev, step].slice(-20));
  }, []);

  const appendMessage = useCallback((entry) => {
    setMessages((prev) => {
      if (messageIdsRef.current.has(entry.id)) return prev;
      messageIdsRef.current.add(entry.id);

      if (entry.kind === 'proposal-meta') {
        const proposalIdRaw = entry.payload?.id ?? entry.payload?.proposalId ?? entry.proposalId;
        const proposalId = Number(proposalIdRaw ?? 0);
        if (Number.isFinite(proposalId) && proposalId >= 0) {
          const existing = proposalMessageRef.current.get(proposalId) || {};
          proposalMessageRef.current.set(proposalId, {
            id: existing.id || '',
            synthetic: Boolean(existing.synthetic),
            meta: true
          });
        }
        return prev;
      }

      if (entry.kind === 'proposal') {
        const proposalIdRaw = entry.payload?.id ?? entry.payload?.proposalId ?? entry.proposalId;
        const proposalId = Number(proposalIdRaw ?? 0);
        if (Number.isFinite(proposalId) && proposalId >= 0) {
          const normalizedEntry = {
            ...entry,
            proposalId,
            meta: false,
            synthetic: Boolean(entry.synthetic)
          };
          const existing = proposalMessageRef.current.get(proposalId);
          if (existing && existing.id) {
            if (existing.synthetic || existing.meta) {
              const next = prev.map((message) => (message.id === existing.id ? normalizedEntry : message));
              proposalMessageRef.current.set(proposalId, {
                id: normalizedEntry.id,
                synthetic: false,
                meta: false
              });
              return next.sort(sortBySentAt);
            }
            return prev;
          }
          proposalMessageRef.current.set(proposalId, {
            id: normalizedEntry.id,
            synthetic: Boolean(normalizedEntry.synthetic),
            meta: false
          });
          return [...prev, normalizedEntry].sort(sortBySentAt);
        }
      }

      return [...prev, entry].sort(sortBySentAt);
    });
  }, []);

  const ensureProposalRecord = useCallback((proposalId) => {
    setProposals((prev) => {
      const next = new Map(prev);
      const existing = next.get(proposalId) || {};
      next.set(proposalId, {
        id: proposalId,
        title: existing.title || '',
        description: existing.description || '',
        proposer: existing.proposer || '',
        yesVotes: existing.yesVotes ?? 0,
        noVotes: existing.noVotes ?? 0,
        endTime: existing.endTime ?? 0,
        executed: existing.executed ?? false,
        passed: existing.passed ?? false
      });
      return next;
    });
  }, []);

  const refreshProposalDetails = useCallback(async (proposalId) => {
    if (!ethers || !readProvider || !templAddressLower) return;
    try {
      const contract = new ethers.Contract(templAddressLower, templArtifact.abi, readProvider);
      const details = await contract.getProposal(proposalId);
      const [proposer, yesVotes, noVotes, endTime, executed, passed, title, description] = details;
      setProposals((prev) => {
        const next = new Map(prev);
        next.set(proposalId, {
          id: proposalId,
          proposer: proposer ? String(proposer).toLowerCase() : '',
          yesVotes: Number(yesVotes ?? 0),
          noVotes: Number(noVotes ?? 0),
          endTime: Number(endTime ?? 0),
          executed: Boolean(executed),
          passed: Boolean(passed),
          title: title || '',
          description: description || ''
        });
        return next;
      });

      // Ensure proposal appears in the conversation even before XMTP sync finishes.
      const syntheticId = `proposal-${proposalId}`;
      setMessages((prev) => {
        if (messageIdsRef.current.has(syntheticId)) return prev;
        const syntheticEntry = {
          id: syntheticId,
          proposalId,
          senderAddress: templAddressLower,
          sentAt: new Date(),
          kind: 'proposal',
          payload: { id: proposalId },
          synthetic: true,
          meta: false
        };
        messageIdsRef.current.add(syntheticId);
        proposalMessageRef.current.set(proposalId, { id: syntheticId, synthetic: true, meta: false });
        return [...prev, syntheticEntry].sort(sortBySentAt);
      });

      if (walletAddressLower) {
        try {
          const [hasVoted, support] = await contract.hasVoted(proposalId, walletAddressLower);
          setVotedChoices((prev) => {
            if (!hasVoted) {
              if (!prev.has(proposalId)) return prev;
              const next = new Map(prev);
              next.delete(proposalId);
              return next;
            }
            const normalizedSupport = Boolean(support);
            if (prev.get(proposalId) === normalizedSupport) {
              return prev;
            }
            const next = new Map(prev);
            next.set(proposalId, normalizedSupport);
            return next;
          });
        } catch (voteErr) {
          console.warn('[templ] Failed to read vote status', proposalId, voteErr);
        }
      }
    } catch (err) {
      console.warn('[templ] Failed to refresh proposal details', proposalId, err);
    }
  }, [ethers, readProvider, templAddressLower, walletAddressLower]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.templTestHooks = window.templTestHooks || {};
    window.templTestHooks.refreshProposal = (id) => {
      const numericId = Number(id);
      if (Number.isNaN(numericId)) return Promise.resolve();
      return refreshProposalDetails(numericId);
    };
    window.templTestHooks.setChainTime = (timestampMs) => {
      const parsed = Number(timestampMs);
      if (!Number.isFinite(parsed)) return;
      setChainTimeMs(parsed);
    };
    return () => {
      if (window.templTestHooks) {
        delete window.templTestHooks.refreshProposal;
        delete window.templTestHooks.setChainTime;
      }
    };
  }, [refreshProposalDetails, setChainTimeMs]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const env = resolveXmtpEnv();
    window.templTestHooks = window.templTestHooks || {};
    window.templTestHooks.getGroupId = () => groupId;
    window.templTestHooks.isConversationReady = () => Boolean(conversation);
    window.templTestHooks.getDebugSteps = () => [...debugSteps];
    window.templTestHooks.getChatError = () => error;
    window.templTestHooks.getXmtpEnv = () => env;
    window.templTestHooks.getMemberInboxId = () => xmtpClient?.inboxId || '';
    window.templTestHooks.listMemberConversations = async () => {
      if (!xmtpClient?.conversations?.list) return [];
      try {
        const convs = await xmtpClient.conversations.list({ consentStates: ['allowed', 'unknown', 'denied'], conversationType: 1 });
        return (convs || []).map((c) => c?.id).filter(Boolean);
      } catch {
        return [];
      }
    };
    window.templTestHooks.getRenderedMessages = () => {
      const toText = (entry) => {
        if (!entry) return null;
        if (entry.synthetic && entry.kind === 'proposal') return entry.payload?.description || null;
        if (typeof entry.payload === 'string') return entry.payload;
        if (entry.payload && typeof entry.payload === 'object') {
          if (typeof entry.payload.text === 'string') return entry.payload.text;
          if (typeof entry.payload.content === 'string') return entry.payload.content;
        }
        return null;
      };
      return messages.map((entry) => ({ id: entry.id, text: toText(entry) })).filter((item) => item.text);
    };
    window.templTestHooks.getConversationSnapshot = async (wantedId) => {
      try {
        const normalize = (value) => (value || '').toString().replace(/^0x/i, '').toLowerCase();
        const target = normalize(wantedId);
        if (!target) return { id: '', messages: [] };
        let conv = null;
        if (conversation && normalize(conversation.id) === target) {
          conv = conversation;
        } else if (typeof xmtpClient?.conversations?.getConversationById === 'function') {
          const direct = await xmtpClient.conversations.getConversationById(target);
          if (direct && normalize(direct.id) === target) conv = direct;
          if (!conv && target && typeof xmtpClient.conversations.getConversationById === 'function') {
            const alt = await xmtpClient.conversations.getConversationById(`0x${target}`);
            if (alt && normalize(alt.id) === target) conv = alt;
          }
        }
        if (!conv) return { id: '', messages: [] };
        const XMTP_LIMIT = 20;
        const history = await conv.messages({ direction: 'descending', limit: XMTP_LIMIT });
        const toText = (msg) => {
          if (!msg) return null;
          if (typeof msg.content === 'string') return msg.content;
          if (msg.content && typeof msg.content === 'object') {
            if (typeof msg.content.text === 'string') return msg.content.text;
            if (typeof msg.content.content === 'string') return msg.content.content;
            if (Array.isArray(msg.content.parts)) {
              const part = msg.content.parts.find((entry) => typeof entry === 'string' || typeof entry?.text === 'string');
              if (typeof part === 'string') return part;
              if (part?.text) return part.text;
            }
          }
          if (typeof msg.fallback === 'string') return msg.fallback;
          const asString = msg.content?.toString?.();
          if (asString && asString !== '[object Object]') return asString;
          return null;
        };
        const messages = history.map((msg) => ({ id: msg.id, sentAt: msg.sentAt?.toISOString?.() || null, text: toText(msg) })).filter((entry) => entry.text);
      return { id: conv.id, messages };
    } catch {
      return { id: '', messages: [] };
    }
  };
    return () => {
      if (window.templTestHooks) {
        delete window.templTestHooks.getGroupId;
        delete window.templTestHooks.isConversationReady;
        delete window.templTestHooks.getDebugSteps;
        delete window.templTestHooks.getChatError;
        delete window.templTestHooks.getXmtpEnv;
        delete window.templTestHooks.getMemberInboxId;
        delete window.templTestHooks.listMemberConversations;
        delete window.templTestHooks.getRenderedMessages;
        delete window.templTestHooks.getConversationSnapshot;
      }
    };
  }, [groupId, conversation, debugSteps, error, xmtpClient, messages]);

  const interpretMessage = useCallback((msg) => {
    const sender = msg.senderAddress ? String(msg.senderAddress).toLowerCase() : '';
    const sentAt = msg.sentAt instanceof Date ? msg.sentAt : new Date(msg.sentAt);
    let kind = 'text';
    let payload = msg.content;

    if (typeof msg.content === 'string') {
      try {
        const parsed = JSON.parse(msg.content);
        if (parsed && typeof parsed === 'object' && typeof parsed.type === 'string') {
          kind = parsed.type;
          payload = parsed;
        }
      } catch {
        kind = 'text';
      }
    } else if (msg.content && typeof msg.content === 'object' && msg.content.type) {
      kind = msg.content.type;
      payload = msg.content;
    }

    if (kind === 'proposal') {
      const proposalId = Number(payload.id ?? payload.proposalId ?? 0);
      ensureProposalRecord(proposalId);
      refreshProposalDetails(proposalId);
    }
    if (kind === 'proposal-meta') {
      const proposalId = Number(payload.id ?? payload.proposalId ?? 0);
      setProposals((prev) => {
        const next = new Map(prev);
        const existing = next.get(proposalId) || {};
        next.set(proposalId, {
          ...existing,
          id: proposalId,
          title: payload.title || existing.title || '',
          description: payload.description || existing.description || ''
        });
        return next;
      });
    }
    if (kind === 'vote') {
      const proposalId = Number(payload.id ?? payload.proposalId ?? 0);
      ensureProposalRecord(proposalId);
      refreshProposalDetails(proposalId);
      if (payload.voter && payload.voter.toLowerCase() === walletAddressLower) {
        setVotedChoices((prev) => {
          const next = new Map(prev);
          next.set(proposalId, Boolean(payload.support));
          return next;
        });
      }
    }

    appendMessage({
      id: msg.id,
      senderAddress: sender,
      sentAt,
      kind,
      payload
    });
  }, [appendMessage, ensureProposalRecord, refreshProposalDetails, walletAddressLower]);

  useEffect(() => {
    if (!signer || !walletAddress) {
      try { xmtpClient?.close?.(); } catch {}
      setXmtpClient(null);
      setConversation(null);
      setGroupId('');
      setMessages([]);
      setPendingNewMessages(0);
      setIsAtBottom(true);
      messageIdsRef.current.clear();
      proposalMessageRef.current.clear();
      identityReadyRef.current = false;
      creatingXmtpPromiseRef.current = null;
      identityReadyPromiseRef.current = null;
      return;
    }

    let cancelled = false;
    setError('');
    setLoading(true);
    setConversation(null);
    setGroupId('');
    setMessages([]);
    setPendingNewMessages(0);
    setIsAtBottom(true);
    messageIdsRef.current.clear();
    proposalMessageRef.current.clear();
    identityReadyRef.current = false;

    try { xmtpClient?.close?.(); } catch {}
    setXmtpClient(null);

    const xmtpEnv = resolveXmtpEnv();

    const createClient = async () => {
      const address = await signer.getAddress();
      const normalized = (address || '').toLowerCase();
      recordDebug(`xmtp:create:start:${normalized}`);

      const storageKey = `xmtp:nonce:${normalized}`;
      let stableNonce = 1;
      if (typeof window !== 'undefined') {
        try {
          const saved = Number.parseInt(window.localStorage?.getItem(storageKey) || '1', 10);
          if (Number.isFinite(saved) && saved > 0) stableNonce = saved;
        } catch {}
      }

      const buildSigner = (nonce) => ({
        type: 'EOA',
        getAddress: () => address,
        getIdentifier: () => ({
          identifier: normalized,
          identifierKind: 'Ethereum',
          nonce
        }),
        signMessage: async (message) => {
          let toSign = message;
          if (message instanceof Uint8Array) {
            try { toSign = ethers.toUtf8String(message); }
            catch { toSign = ethers.hexlify(message); }
          } else if (typeof message !== 'string') {
            toSign = String(message);
          }
          const signature = await signer.signMessage(toSign);
          return ethers.getBytes(signature);
        }
      });

      let attemptNonce = stableNonce;
      let lastError = null;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        recordDebug(`xmtp:create:attempt:${attemptNonce}`);
        try {
          const client = await Client.create(buildSigner(attemptNonce), {
            env: xmtpEnv,
            appVersion: 'templ/0.0.1'
          });
          if (typeof window !== 'undefined') {
            try { window.localStorage?.setItem(storageKey, String(attemptNonce)); } catch {}
          }
          return client;
        } catch (err) {
          lastError = err;
          const message = String(err?.message || err || '');
          recordDebug(`xmtp:create:error:${message.slice(0, 80)}`);
          if (message.includes('already registered 10/10 installations')) {
            attemptNonce += 1;
            continue;
          }
          throw err;
        }
      }
      throw lastError || new Error('Failed to initialise XMTP client.');
    };

    const ensureIdentityReady = async (client) => {
      if (!client) return false;
      const fastMode = import.meta.env?.VITE_E2E_DEBUG === '1';
      const attempts = xmtpEnv === 'local' ? 20 : fastMode ? 120 : 90;
      const delay = xmtpEnv === 'local' ? 200 : fastMode ? 250 : 1000;
      for (let i = 0; i < attempts; i += 1) {
        try { await client.preferences?.inboxState?.(true); } catch (prefErr) {
          recordDebug(`xmtp:identity:pref-error:${prefErr?.message || prefErr}`);
        }
        try { await syncXMTP(client, 1, Math.min(delay, 500)); } catch (syncErr) {
          recordDebug(`xmtp:identity:sync-error:${syncErr?.message || syncErr}`);
        }
        try { await client.contacts?.sync?.(); } catch (contactsErr) {
          recordDebug(`xmtp:identity:contacts-error:${contactsErr?.message || contactsErr}`);
        }
        let aggregateReady = false;
        try {
          const aggregate = await client.debugInformation?.apiAggregateStatistics?.();
          if (typeof aggregate === 'string') {
            recordDebug(`xmtp:identity:agg:${aggregate.slice(0, 80)}`);
            if (!aggregate.includes('UploadKeyPackage')) {
              aggregateReady = true;
            } else {
              const match = aggregate.match(/UploadKeyPackage\s+(\d+)/);
              const uploads = match ? Number(match[1]) : 0;
              if (Number.isFinite(uploads) && uploads >= 1) {
                aggregateReady = true;
              }
            }
          }
        } catch (aggErr) {
          recordDebug(`xmtp:identity:agg-error:${aggErr?.message || aggErr}`);
        }
        if (aggregateReady || client?.inboxId) {
          recordDebug('xmtp:identity:ready');
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
      recordDebug('xmtp:identity:timeout');
      return Boolean(client?.inboxId);
    };

    const launch = async () => {
      if (creatingXmtpPromiseRef.current) {
        return creatingXmtpPromiseRef.current;
      }
      const promise = (async () => {
        const client = await createClient();
        if (cancelled) {
          try { client?.close?.(); } catch {}
          throw new Error('XMTP init cancelled');
        }
        recordDebug(`xmtp:create:ready:${client?.inboxId || ''}`);
        identityReadyRef.current = false;
        const ready = await ensureIdentityReady(client);
        identityReadyRef.current = ready;
        return client;
      })()
        .finally(() => {
          creatingXmtpPromiseRef.current = null;
        });
      creatingXmtpPromiseRef.current = promise;
      return promise;
    };

    const run = async () => {
      try {
        const client = await launch();
        if (cancelled) {
          try { client?.close?.(); } catch {}
          return;
        }
        if (!identityReadyRef.current) {
          throw new Error('XMTP identity not ready');
        }
        setXmtpClient(client);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to initialise XMTP client.');
          setLoading(false);
        }
      }
    };

    identityReadyPromiseRef.current = (async () => {
      try {
        await launch();
        return identityReadyRef.current;
      } catch {
        return false;
      }
    })();

    run();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signer, walletAddress, recordDebug]);

  useEffect(() => {
    if (!xmtpClient || !templAddressLower || !signer) return;
    let cancelled = false;
    const xmtpEnv = resolveXmtpEnv();

    async function connectConversation() {
      setLoading(true);
      setError('');
      try {
        setDebugSteps((prev) => [...prev, 'verify:start'].slice(-20));
        let identityOk = identityReadyRef.current;
        if (!identityOk) {
          const waitPromise = identityReadyPromiseRef.current;
          if (waitPromise) {
            try { identityOk = await waitPromise; } catch { identityOk = false; }
          }
        }
        if (!identityOk) {
          throw new Error('XMTP identity not ready. Please retry.');
        }
        setDebugSteps((prev) => [...prev, 'identity:ready'].slice(-20));

        let membership = null;
        let lastMembershipError = null;
        const membershipAttempts = xmtpEnv === 'local' ? 8 : 24;
        for (let attempt = 0; attempt < membershipAttempts; attempt += 1) {
          recordDebug(`verify:request:${attempt + 1}:start`);
          try {
            membership = await verifyMembership({
              signer,
              templAddress: templAddressLower,
              walletAddress,
              backendUrl: BACKEND_URL,
              ethers,
              templArtifact,
              readProvider
            });
            recordDebug(`verify:request:${attempt + 1}:ok`);
            if (membership?.groupId) break;
            lastMembershipError = new Error('Chat group is not ready yet. Try again shortly.');
          } catch (verifyErr) {
            const errSnippet = String(verifyErr?.message || verifyErr || '').slice(0, 120);
            recordDebug(`verify:request:${attempt + 1}:err:${errSnippet}`);
            lastMembershipError = verifyErr;
          }
          if (cancelled) return;
          recordDebug(`verify:retry:${attempt + 1}`);
          await new Promise((resolve) => setTimeout(resolve, xmtpEnv === 'local' ? 200 : 1000));
        }
        if (!membership?.groupId) {
          throw lastMembershipError || new Error('Chat group is not ready yet. Try again shortly.');
        }
        setDebugSteps((prev) => [...prev, `verify:group:${membership.groupId}`].slice(-20));
        setGroupId(membership.groupId);
        try { await syncXMTP(xmtpClient, 2, 500); } catch (syncErr) {
          recordDebug(`conversation:sync-error:${syncErr?.message || syncErr}`);
        }
        const convo = await waitForConversation({
          xmtp: xmtpClient,
          groupId: membership.groupId,
          retries: 120,
          delayMs: 500
        });
        if (!convo) {
          throw new Error('Unable to locate chat conversation. Please retry soon.');
        }
        if (cancelled) return;
        setDebugSteps((prev) => [...prev, `conversation-found:${convo.id}`].slice(-20));
        setConversation(convo);
        setDebugSteps((prev) => [...prev, `conversation-ready:${convo.id}`].slice(-20));
        setStats((prev) => ({ ...prev, priest: membership.templ?.priest || '', templHomeLink: membership.templ?.templHomeLink || '' }));
        setLoading(false);
      } catch (err) {
        setDebugSteps((prev) => [...prev, `error:${err?.message || err}`].slice(-20));
        if (!cancelled) {
          setError(err?.message || 'Failed to join chat.');
          setLoading(false);
        }
      }
    }

    connectConversation();
    return () => {
      cancelled = true;
    };
  }, [xmtpClient, templAddressLower, signer, walletAddress, ethers, readProvider, recordDebug]);

  useEffect(() => {
    if (!conversation) return;
    let cancelled = false;
    messageIdsRef.current.clear();
    setMessages([]);
    setPendingNewMessages(0);
    setIsAtBottom(true);

    async function loadHistory() {
      try {
        const history = await conversation.messages();
        if (cancelled) return;
        history.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
        for (const msg of history) {
          interpretMessage(msg);
        }
      } catch (err) {
        console.warn('[templ] Failed to load chat history', err);
      }
    }

    async function streamMessages() {
      try {
        const stream = await conversation.stream();
        streamAbortRef.current = stream;
        for await (const msg of stream) {
          if (cancelled) break;
          interpretMessage(msg);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[templ] Message stream closed', err);
        }
      }
    }

    loadHistory();
    streamMessages();

    return () => {
      cancelled = true;
      try { streamAbortRef.current?.return?.(); } catch {}
      streamAbortRef.current = null;
    };
  }, [conversation, interpretMessage]);

  useEffect(() => {
    if (!ethers || !readProvider || !templAddressLower) return;
    let cancelled = false;
    async function loadSummary() {
      try {
        const statsResponse = await fetchTemplStats({ ethers, provider: readProvider, templAddress: templAddressLower });
        if (!cancelled) {
          setStats((prev) => ({ ...statsResponse, priest: statsResponse.priest || prev?.priest || '', templHomeLink: statsResponse.templHomeLink || prev?.templHomeLink || '' }));
        }
      } catch (err) {
        console.warn('[templ] Failed to load templ stats', err);
      }
    }
    loadSummary();
    return () => { cancelled = true; };
  }, [ethers, readProvider, templAddressLower, templStatsKey]);

  useEffect(() => {
    if (!ethers || !readProvider || !templAddressLower) return;
    const stop = watchProposals({
      ethers,
      provider: readProvider,
      templAddress: templAddressLower,
      templArtifact,
      onProposal: ({ id, title, description, proposer, endTime }) => {
        setProposals((prev) => {
          const next = new Map(prev);
          const existing = next.get(id) || {};
          next.set(id, {
            ...existing,
            id,
            title: title || existing.title || '',
            description: description || existing.description || '',
            proposer: proposer ? String(proposer).toLowerCase() : existing.proposer || '',
            endTime: endTime || existing.endTime || 0
          });
          return next;
        });
        refreshProposalDetails(id);
      },
      onVote: ({ id, voter, support }) => {
        if (voter && voter.toLowerCase() === walletAddressLower) {
          setVotedChoices((prev) => {
            const next = new Map(prev);
            next.set(id, Boolean(support));
            return next;
          });
        }
        refreshProposalDetails(id);
      }
    });
    return () => {
      try { stop?.(); } catch {}
    };
  }, [ethers, readProvider, templAddressLower, walletAddressLower, refreshProposalDetails]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return undefined;
    const handleScroll = () => {
      const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
      const nearBottom = remaining <= 80;
      setIsAtBottom(nearBottom);
      if (nearBottom) {
        setPendingNewMessages(0);
      }
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    if (!messages.length) return;
    const latest = messages[messages.length - 1];
    if (!latest) return;
    const fromSelf = latest.senderAddress?.toLowerCase() === walletAddressLower;
    if (isAtBottom || fromSelf) {
      scrollToLatest(latest.synthetic ? 'auto' : 'smooth');
      setPendingNewMessages(0);
      return;
    }
    if (!latest.synthetic) {
      setPendingNewMessages((count) => Math.min(count + 1, 99));
    }
  }, [messages, walletAddressLower, isAtBottom, scrollToLatest]);

  useEffect(() => {
    if (conversation) {
      scrollToLatest('auto');
    }
  }, [conversation, scrollToLatest]);

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!conversation) {
      pushMessage?.('Chat not ready yet.');
      return;
    }
    const trimmed = messageInput.trim();
    if (!trimmed) return;
    try {
      await conversation.send(trimmed);
      setMessageInput('');
    } catch (err) {
      pushMessage?.(`Failed to send message: ${err?.message || err}`);
    }
  };

  const handleVote = async (proposalId, support) => {
    if (!signer) {
      onConnectWallet?.();
      return;
    }
    try {
      await voteOnProposal({
        ethers,
        signer,
        templAddress: templAddressLower,
        templArtifact,
        proposalId,
        support
      });
      setVotedChoices((prev) => {
        const next = new Map(prev);
        next.set(proposalId, support);
        return next;
      });
      await refreshProposalDetails(proposalId);
      pushMessage?.(`Vote submitted for proposal #${proposalId}`);
    } catch (err) {
      pushMessage?.(`Vote failed: ${err?.message || err}`);
    }
  };

  const handleExecute = async (proposalId) => {
    if (!signer) {
      onConnectWallet?.();
      return;
    }
    try {
      await executeProposal({
        ethers,
        signer,
        templAddress: templAddressLower,
        templArtifact,
        proposalId
      });
      await refreshProposalDetails(proposalId);
      pushMessage?.(`Execution submitted for proposal #${proposalId}`);
    } catch (err) {
      pushMessage?.(`Execution failed: ${err?.message || err}`);
    }
  };

  const handlePropose = async (event) => {
    event.preventDefault();
    if (!signer) {
      onConnectWallet?.();
      return;
    }
    if (!proposalTitle.trim()) {
      pushMessage?.('Proposal title required.');
      return;
    }
    const params = { ...proposalParams };
    try {
      if (proposalAction === 'setJoinPaused') {
        params.paused = params.paused === undefined ? true : params.paused;
      } else if (proposalAction === 'setDictatorship') {
        params.enable = Boolean(params.enable);
      } else if (proposalAction === 'setMaxMembers') {
        params.newMaxMembers = BigInt(params.newMaxMembers ?? 0).toString();
      } else if (proposalAction === 'withdrawTreasury') {
        params.amount = parseAmountRaw(params.amount ?? '0');
      } else if (proposalAction === 'updateConfig') {
        if (params.newEntryFee) params.newEntryFee = parseAmountRaw(params.newEntryFee);
        if (params.newBurnPercent) params.newBurnPercent = Number(params.newBurnPercent);
        if (params.newTreasuryPercent) params.newTreasuryPercent = Number(params.newTreasuryPercent);
        if (params.newMemberPoolPercent) params.newMemberPoolPercent = Number(params.newMemberPoolPercent);
        params.updateFeeSplit = params.updateFeeSplit !== undefined ? Boolean(params.updateFeeSplit) : true;
      } else if (proposalAction === 'setEntryFeeCurve') {
        if (typeof params.curve === 'string') {
          params.curve = JSON.parse(params.curve);
        }
        if (!params.curve) {
          throw new Error('Curve configuration required (JSON)');
        }
        params.baseEntryFee = parseAmountRaw(params.baseEntryFee ?? '0');
      } else if (proposalAction === 'disbandTreasury') {
        if (params.token === undefined || params.token === null || params.token === '') {
          params.token = ethers.ZeroAddress;
        }
      } else if (proposalAction === 'customCallData') {
        if (!params.callData || typeof params.callData !== 'string') {
          throw new Error('Provide callData hex string');
        }
      }

      const response = await proposeVote({
        ethers,
        signer,
        templAddress: templAddressLower,
        templArtifact,
        action: proposalAction === 'customCallData' ? undefined : proposalAction,
        callData: proposalAction === 'customCallData' ? params.callData : undefined,
        params: proposalAction === 'customCallData' ? undefined : params,
        title: proposalTitle.trim(),
        description: proposalDescription.trim()
      });
      if (response?.proposalId !== undefined && conversation) {
        try {
          await conversation.send(JSON.stringify({
            type: 'proposal-meta',
            id: Number(response.proposalId),
            title: proposalTitle.trim(),
            description: proposalDescription.trim()
          }));
        } catch {}
        refreshProposalDetails(Number(response.proposalId));
      }
      setProposalDescription('');
      setProposalTitle('');
      setProposalParams({});
      setProposalComposerOpen(false);
      pushMessage?.('Proposal submitted');
    } catch (err) {
      pushMessage?.(`Proposal failed: ${err?.message || err}`);
    }
  };

  const openClaimModal = useCallback(async () => {
    if (!signer) {
      onConnectWallet?.();
      return;
    }
    setClaimModalOpen(true);
    setClaimLoading(true);
    setClaimError('');
    try {
      const info = await fetchMemberPoolStats({
        ethers,
        signer,
        templAddress: templAddressLower,
        templArtifact,
        memberAddress: walletAddressLower
      });
      setClaimInfo(info);
    } catch (err) {
      setClaimError(err?.message || 'Failed to load claimable rewards');
    } finally {
      setClaimLoading(false);
    }
  }, [signer, onConnectWallet, ethers, templAddressLower, walletAddressLower]);

  const handleClaimRewards = async () => {
    if (!signer) {
      onConnectWallet?.();
      return;
    }
    setClaimLoading(true);
    setClaimError('');
    try {
      await claimMemberPool({ ethers, signer, templAddress: templAddressLower, templArtifact });
      pushMessage?.('Rewards claimed');
      const info = await fetchMemberPoolStats({
        ethers,
        signer,
        templAddress: templAddressLower,
        templArtifact,
        memberAddress: walletAddressLower
      });
      setClaimInfo(info);
    } catch (err) {
      setClaimError(err?.message || 'Claim failed');
    } finally {
      setClaimLoading(false);
    }
  };

  const renderMessage = (message) => {
    if (message.kind === 'proposal' || message.kind === 'proposal-meta') {
      const proposalId = Number(message.payload?.id ?? message.payload?.proposalId ?? 0);
      const record = proposals.get(proposalId);
      const yesVotes = record?.yesVotes ?? 0;
      const noVotes = record?.noVotes ?? 0;
      const endTime = record?.endTime ? new Date(record.endTime * 1000) : null;
      const nowMs = chainTimeMs;
      const expired = endTime ? endTime.getTime() <= nowMs : false;
      const executed = record?.executed;
      const voted = votedChoices.get(proposalId);
      const voteOptionBase = `rounded-xl border ${colorTokens.border} ${colorTokens.surfaceBg} px-3 py-2`;
      const voteOptionYesActive = `border-[${palette.accent}] ${colorTokens.accentSoftBg}`;
      const voteOptionNoActive = `${colorTokens.surfaceTintBg} border-[${palette.borderStrong}]`;
      return (
        <div key={message.id} className="mb-4" data-testid={`proposal-card-${proposalId}`}>
          <div className={`flex items-center justify-between text-xs ${colorTokens.textMuted}`}>
            <span className={`font-semibold ${colorTokens.textSecondary}`}>{shortAddress(message.senderAddress)}</span>
            <span>{formatTimestamp(message.sentAt)}</span>
          </div>
          <div className={`${surface.card} mt-2 p-4`}>
            <div className="flex items-center justify-between gap-3">
              <h3 className={`text-base font-semibold ${colorTokens.textPrimary}`}>#{proposalId} {record?.title || 'Proposal'}</h3>
              {endTime ? (
                <span className={text.hint}>{expired ? 'Voting closed' : `Ends ${endTime.toLocaleString()}`}</span>
              ) : null}
            </div>
            {record?.description ? (
              <p className={`mt-2 whitespace-pre-wrap text-sm ${colorTokens.textSecondary}`}>{record.description}</p>
            ) : null}
            <div className={`mt-3 grid gap-2 text-xs ${colorTokens.textSecondary} sm:grid-cols-2`}>
              <div className={`${voteOptionBase} ${voted === true ? voteOptionYesActive : ''}`}>
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${colorTokens.link}`}>YES</span>
                  <span className={`${text.mono} text-sm`}>{yesVotes}</span>
                </div>
              </div>
              <div className={`${voteOptionBase} ${voted === false ? voteOptionNoActive : ''}`}>
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${colorTokens.textMuted}`}>NO</span>
                  <span className={`${text.mono} text-sm`}>{noVotes}</span>
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={button.primary}
                onClick={() => handleVote(proposalId, true)}
                disabled={executed || expired || voted === true}
              >
                Vote Yes
              </button>
              <button
                type="button"
                className={button.muted}
                onClick={() => handleVote(proposalId, false)}
                disabled={executed || expired || voted === false}
              >
                Vote No
              </button>
              <button
                type="button"
                className={button.base}
                onClick={() => handleExecute(proposalId)}
                disabled={executed || !expired}
              >
                Execute
              </button>
            </div>
            <div className={`mt-3 flex flex-wrap items-center gap-3 text-xs ${colorTokens.textMuted}`}>
              <span>Proposer: {record?.proposer ? shortAddress(record.proposer) : 'unknown'}</span>
              <span>Status: {executed ? (record?.passed ? 'Executed ✅' : 'Executed ❌') : expired ? 'Awaiting execution' : 'Voting open'}</span>
            </div>
          </div>
        </div>
      );
    }

    if (message.kind === 'vote') {
      return (
        <div key={message.id} className={`${surface.systemMessage} ${colorTokens.textSecondary} flex items-center gap-2`}>
          <span className={`font-semibold ${colorTokens.textPrimary}`}>{shortAddress(message.senderAddress)}</span>
          <span>voted {message.payload?.support ? 'YES' : 'NO'} on proposal #{message.payload?.id}</span>
        </div>
      );
    }

    if (message.kind === 'priest-changed') {
      return (
        <div key={message.id} className={`${surface.systemMessage} ${colorTokens.textSecondary}`}>
          Priest changed to {shortAddress(message.payload?.newPriest)}
        </div>
      );
    }

    if (message.kind === 'proposal-executed') {
      return (
        <div key={message.id} className={`${surface.systemMessage} ${colorTokens.textSecondary}`}>
          Proposal #{message.payload?.id} executed ({message.payload?.success ? 'success' : 'failed'})
        </div>
      );
    }

    if (message.kind === 'member-joined') {
      return (
        <div key={message.id} className={`${surface.systemMessage} ${colorTokens.textSecondary}`}>
          {shortAddress(message.payload?.member)} joined the templ
        </div>
      );
    }

    const messageText = typeof message.payload === 'string'
      ? message.payload
      : message.payload?.toString?.() || '';
    const isSelf = message.senderAddress?.toLowerCase() === walletAddressLower;
    if (!messageText) {
      return (
        <div key={message.id} className={`${surface.systemMessage} ${colorTokens.textSecondary}`}>
          (unsupported message)
        </div>
      );
    }

    return (
      <div key={message.id} className={`flex w-full ${isSelf ? 'justify-end' : 'justify-start'}`}>
        <div className="flex max-w-full flex-col gap-1">
          <div className={`${text.hint} px-1 ${isSelf ? 'text-right' : ''}`}>
            {isSelf ? 'You' : shortAddress(message.senderAddress)}
          </div>
          <div className={`${isSelf ? surface.bubbleOwn : surface.bubbleOther}`}>
            <p className="whitespace-pre-wrap leading-relaxed">{messageText}</p>
          </div>
          <div className={`flex items-center gap-2 px-1 ${isSelf ? 'justify-end' : 'justify-start'} ${text.hint}`}>
            <span>{formatTimestamp(message.sentAt)}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderProposalComposer = () => (
    <div className={`fixed inset-0 z-40 flex items-center justify-center ${surface.overlay} p-4`}>
      <div className={`${surface.panel} w-full max-w-2xl p-6 shadow-2xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className={text.dialogTitle}>New Proposal</h2>
          <button type="button" className={button.link} onClick={() => setProposalComposerOpen(false)}>Close</button>
        </div>
        <form className="space-y-4" onSubmit={handlePropose}>
          <label className={form.label}>
            Action
            <select
              className={form.select}
              value={proposalAction}
              onChange={(e) => {
                setProposalAction(e.target.value);
                setProposalParams({});
              }}
            >
              {PROPOSAL_ACTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className={form.label}>
            Title
            <input
              className={form.input}
              value={proposalTitle}
              onChange={(e) => setProposalTitle(e.target.value)}
              placeholder="Short title"
              required
            />
          </label>
          <label className={form.label}>
            Description
            <textarea
              className={form.textarea}
              value={proposalDescription}
              onChange={(e) => setProposalDescription(e.target.value)}
              placeholder="Optional details"
            />
          </label>
          {(() => {
            switch (proposalAction) {
              case 'setJoinPaused':
                return (
                  <label className={form.label}>
                    Pause joins?
                    <select
                      className={form.select}
                      value={String(proposalParams.paused ?? true)}
                      onChange={(e) => setProposalParams((prev) => ({ ...prev, paused: e.target.value === 'true' }))}
                    >
                      <option value="true">Pause new joins</option>
                      <option value="false">Resume joins</option>
                    </select>
                  </label>
                );
              case 'setDictatorship':
                return (
                  <label className={form.label}>
                    Dictatorship mode
                    <select
                      className={form.select}
                      value={String(proposalParams.enable ?? true)}
                      onChange={(e) => setProposalParams((prev) => ({ ...prev, enable: e.target.value === 'true' }))}
                    >
                      <option value="true">Enable dictatorship</option>
                      <option value="false">Disable dictatorship</option>
                    </select>
                  </label>
                );
              case 'changePriest':
                return (
                  <label className={form.label}>
                    New priest address
                    <input
                      className={form.input}
                      value={proposalParams.newPriest || ''}
                      onChange={(e) => setProposalParams((prev) => ({ ...prev, newPriest: e.target.value }))}
                      placeholder="0x..."
                    />
                  </label>
                );
              case 'setMaxMembers':
                return (
                  <label className={form.label}>
                    Member limit (0 for unlimited)
                    <input
                      className={form.input}
                      type="number"
                      value={proposalParams.newMaxMembers || ''}
                      onChange={(e) => setProposalParams((prev) => ({ ...prev, newMaxMembers: e.target.value }))}
                    />
                  </label>
                );
              case 'withdrawTreasury':
                return (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className={form.label}>
                      Token (leave blank for native)
                      <input
                        className={form.input}
                        value={proposalParams.token || ''}
                        onChange={(e) => setProposalParams((prev) => ({ ...prev, token: e.target.value }))}
                        placeholder="0x..."
                      />
                    </label>
                    <label className={form.label}>
                      Recipient
                      <input
                        className={form.input}
                        value={proposalParams.recipient || ''}
                        onChange={(e) => setProposalParams((prev) => ({ ...prev, recipient: e.target.value }))}
                        placeholder="0x..."
                      />
                    </label>
                    <label className={form.label}>
                      Amount (wei)
                      <input
                        className={form.input}
                        value={proposalParams.amount || ''}
                        onChange={(e) => setProposalParams((prev) => ({ ...prev, amount: e.target.value }))}
                        placeholder="1000000000000000000"
                      />
                    </label>
                    <label className={form.label}>
                      Reason
                      <textarea
                        className={form.textarea}
                        value={proposalParams.reason || ''}
                        onChange={(e) => setProposalParams((prev) => ({ ...prev, reason: e.target.value }))}
                        placeholder="Optional context"
                      />
                    </label>
                  </div>
                );
              case 'updateConfig':
                return (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className={form.label}>
                      New entry fee (wei)
                      <input
                        className={form.input}
                        value={proposalParams.newEntryFee || ''}
                        onChange={(e) => setProposalParams((prev) => ({ ...prev, newEntryFee: e.target.value }))}
                      />
                    </label>
                    <label className={form.label}>
                      Burn percent (bps)
                      <input
                        className={form.input}
                        type="number"
                        value={proposalParams.newBurnPercent || ''}
                        onChange={(e) => setProposalParams((prev) => ({ ...prev, newBurnPercent: e.target.value }))}
                      />
                    </label>
                    <label className={form.label}>
                      Treasury percent (bps)
                      <input
                        className={form.input}
                        type="number"
                        value={proposalParams.newTreasuryPercent || ''}
                        onChange={(e) => setProposalParams((prev) => ({ ...prev, newTreasuryPercent: e.target.value }))}
                      />
                    </label>
                    <label className={form.label}>
                      Member pool percent (bps)
                      <input
                        className={form.input}
                        type="number"
                        value={proposalParams.newMemberPoolPercent || ''}
                        onChange={(e) => setProposalParams((prev) => ({ ...prev, newMemberPoolPercent: e.target.value }))}
                      />
                    </label>
                    <label className={form.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={proposalParams.updateFeeSplit !== false}
                        onChange={(e) => setProposalParams((prev) => ({ ...prev, updateFeeSplit: e.target.checked }))}
                      />
                      Apply new fee split values
                    </label>
                  </div>
                );
              case 'setHomeLink':
                return (
                  <label className={form.label}>
                    New home link
                    <input
                      className={form.input}
                      value={proposalParams.newHomeLink || ''}
                      onChange={(e) => setProposalParams((prev) => ({ ...prev, newHomeLink: e.target.value }))}
                      placeholder="https://"
                    />
                  </label>
                );
              case 'setEntryFeeCurve':
                return (
                  <div className="grid gap-4">
                    <label className={form.label}>
                      Curve JSON
                      <textarea
                        className={form.textarea}
                        value={proposalParams.curve || ''}
                        onChange={(e) => setProposalParams((prev) => ({ ...prev, curve: e.target.value }))}
                        placeholder='{"primary":{"style":1,"rateBps":11000}}'
                      />
                    </label>
                    <label className={form.label}>
                      Base entry fee (wei)
                      <input
                        className={form.input}
                        value={proposalParams.baseEntryFee || ''}
                        onChange={(e) => setProposalParams((prev) => ({ ...prev, baseEntryFee: e.target.value }))}
                      />
                    </label>
                  </div>
                );
              case 'disbandTreasury':
                return (
                  <label className={form.label}>
                    Token address (leave blank for access token)
                    <input
                      className={form.input}
                      value={proposalParams.token || ''}
                      onChange={(e) => setProposalParams((prev) => ({ ...prev, token: e.target.value }))}
                    />
                  </label>
                );
              case 'customCallData':
                return (
                  <label className={form.label}>
                    callData (hex)
                    <textarea
                      className={form.textarea}
                      value={proposalParams.callData || ''}
                      onChange={(e) => setProposalParams((prev) => ({ ...prev, callData: e.target.value }))}
                      placeholder="0x..."
                    />
                  </label>
                );
              default:
                return null;
            }
          })()}
          <div className="flex justify-end gap-2">
            <button type="button" className={button.base} onClick={() => setProposalComposerOpen(false)}>Cancel</button>
            <button type="submit" className={button.primary}>Submit proposal</button>
          </div>
        </form>
      </div>
    </div>
  );

  const renderClaimModal = () => (
    <div className={`fixed inset-0 z-40 flex items-center justify-center ${surface.overlay} p-4`}>
      <div className={`${surface.panel} w-full max-w-md p-6 shadow-2xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className={text.dialogTitle}>Claim rewards</h2>
          <button type="button" className={button.link} onClick={() => setClaimModalOpen(false)}>Close</button>
        </div>
        {claimLoading ? (
          <p className={text.subtle}>Loading claimable rewards…</p>
        ) : claimError ? (
          <p className={`text-sm ${colorTokens.link}`}>{claimError}</p>
        ) : claimInfo ? (
          <div className={`space-y-2 text-sm ${colorTokens.textSecondary}`}>
            <div>
              <span className={text.hint}>Member pool balance:</span>
              <div className={`${text.mono} text-sm`}>{claimInfo.poolBalance?.toString?.() || claimInfo.poolBalanceFormatted || claimInfo.poolBalanceRaw || '0'}</div>
            </div>
            <div>
              <span className={text.hint}>Claimable:</span>
              <div className={`${text.mono} text-sm`}>{claimInfo.claimable?.toString?.() || claimInfo.claimableFormatted || claimInfo.claimableWei || '0'}</div>
            </div>
            <div>
              <span className={text.hint}>Already claimed:</span>
              <div className={`${text.mono} text-sm`}>{claimInfo.memberClaimed?.toString?.() || claimInfo.memberClaimedFormatted || '0'}</div>
            </div>
          </div>
        ) : (
          <p className={text.subtle}>No reward data available.</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={button.base} onClick={() => setClaimModalOpen(false)}>Close</button>
          <button type="button" className={button.primary} onClick={handleClaimRewards} disabled={claimLoading}>Claim rewards</button>
        </div>
      </div>
    </div>
  );

  if (!templAddressLower) {
    return (
      <div className={layout.page}>
        <div className={surface.panel}>Invalid templ address.</div>
      </div>
    );
  }

  if (!walletAddress) {
    return (
      <div className={layout.page}>
        <div className={surface.panel}>
          <h2 className={text.sectionHeading}>Connect Wallet</h2>
          <p className={`mt-2 ${text.body}`}>Connect your member wallet to enter the templ chat.</p>
          <button type="button" className={`${button.primary} mt-4`} onClick={onConnectWallet}>
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  const statsItems = [
    renderStat('Priest', stats?.priest ? shortAddress(stats.priest) : null),
    renderStat('XMTP group', groupId ? `${groupId.slice(0, 8)}…${groupId.slice(-4)}` : 'pending'),
    renderStat('Members', stats?.memberCount != null ? String(stats.memberCount) : null),
    renderStat('Treasury', stats?.treasuryBalanceFormatted, stats?.tokenSymbol),
    renderStat('Member pool', stats?.memberPoolBalanceFormatted, stats?.tokenSymbol)
  ].filter(Boolean);

  return (
    <div className={layout.page}>
      <div className="flex flex-col gap-6">
        <div className={`${surface.panel} p-6`}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={text.pageTitle}>Templ Chat</h1>
              <p className={text.body}>{shortAddress(templAddressLower)}</p>
            </div>
          </div>
          {statsItems.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {statsItems}
            </div>
          ) : null}
          {(() => {
            if (!stats?.templHomeLink) return null;
            const { href, text: safeText } = sanitizeLink(stats.templHomeLink);
            if (!safeText) return null;
            return (
              <div className={`mt-3 ${text.hint}`}>
                Home:{' '}
                {href ? (
                  <a className={text.link} href={href} target="_blank" rel="noreferrer">{safeText}</a>
                ) : (
                  <span>{safeText}</span>
                )}
              </div>
            );
          })()}
        </div>

        {error && (
          <div className={`${surface.card} px-4 py-3 text-sm ${colorTokens.textPrimary}`}>
            ⚠️ {error}
          </div>
        )}

        <section className={`${surface.panel} ${layout.conversation}`}>
          <div className={`flex flex-wrap items-center justify-between gap-3 border-b ${colorTokens.border} px-4 py-4 sm:px-6`}>
            <h2 className={text.sectionHeading}>Conversation</h2>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={button.base} onClick={() => setProposalComposerOpen(true)}>
                New proposal
              </button>
              <button type="button" className={button.base} onClick={openClaimModal}>
                Claim rewards
              </button>
            </div>
          </div>
          <div className="relative flex-1">
            <div
              ref={messagesContainerRef}
              className="flex h-full flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-6"
            >
              {loading && !conversation ? (
                <p className={text.subtle}>Connecting to chat…</p>
              ) : messages.length === 0 ? (
                <p className={text.subtle}>No messages yet. Say hello!</p>
              ) : (
                messages.map((message) => renderMessage(message))
              )}
              <div ref={messagesEndRef} />
            </div>
            {pendingNewMessages > 0 ? (
              <button
                type="button"
                className={`${button.pill} absolute bottom-24 right-4 shadow-lg sm:bottom-20`}
                onClick={() => {
                  scrollToLatest('smooth');
                  setPendingNewMessages(0);
                  setIsAtBottom(true);
                }}
              >
                {pendingNewMessages} new message{pendingNewMessages > 1 ? 's' : ''}
              </button>
            ) : null}
          </div>
          <form onSubmit={handleSendMessage} className={`flex items-end gap-3 border-t ${colorTokens.border} px-4 py-4 sm:px-6`}>
            <input
              className={`${surface.input} flex-1 rounded-full border ${colorTokens.border} bg-transparent px-5 py-3 text-sm ${colorTokens.textPrimary} placeholder:text-[#7087bb] focus:outline-none focus:ring-2 ${colorTokens.inputRing}`}
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder={conversation ? 'Message templ members…' : 'Waiting for chat…'}
              disabled={!conversation}
            />
            <button type="submit" className={`${button.primary} shrink-0 px-5 py-3`} disabled={!conversation || !messageInput.trim()}>
              Send
            </button>
          </form>
        </section>
      </div>
      {proposalComposerOpen && renderProposalComposer()}
      {claimModalOpen && renderClaimModal()}
    </div>
  );
}

export default ChatPage;
