// @ts-check
import { useState, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { Client } from '@xmtp/browser-sdk';
import templArtifact from './contracts/TEMPL.json';
import {
  deployTempl,
  purchaseAndJoin,
  sendMessage,
  proposeVote,
  voteOnProposal,
  executeProposal,
  claimMemberPool,
  watchProposals,
  fetchActiveMutes,
  listTempls,
  getTreasuryInfo,
  getClaimable
} from './flows.js';
import { syncXMTP, waitForConversation } from '../../shared/xmtp.js';
import './App.css';

function App() {
  // Minimal client-side router (no external deps)
  const [path, setPath] = useState(() => window.location.pathname || '/');
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search));
  useEffect(() => {
    const onPop = () => {
      setPath(window.location.pathname || '/');
      setQuery(new URLSearchParams(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  function navigate(to) {
    try {
      const url = new URL(to, window.location.origin);
      window.history.pushState({}, '', url.toString());
      setPath(url.pathname);
      setQuery(url.searchParams);
    } catch {
      // Fallback to hash navigation
      window.location.assign(to);
    }
  }
  const [walletAddress, setWalletAddress] = useState();
  const [signer, setSigner] = useState();
  const [xmtp, setXmtp] = useState();
  const [group, setGroup] = useState();
  const [groupConnected, setGroupConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState([]);
  const [messages, setMessages] = useState([]); // [{ kind:'text'|'proposal'|'system', content, senderAddress, proposalId, title, yes, no }]
  const [messageInput, setMessageInput] = useState('');
  const [proposals, setProposals] = useState([]);
  const [proposalsById, setProposalsById] = useState({});
  const [profilesByAddress, setProfilesByAddress] = useState({}); // { [addressLower]: { name, avatar } }
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [mutes, setMutes] = useState([]);
  const [templList, setTemplList] = useState([]);
  const [treasuryInfo, setTreasuryInfo] = useState(null);
  const [claimable, setClaimable] = useState(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeTitle, setProposeTitle] = useState('');
  const [proposeDesc, setProposeDesc] = useState('');
  const [proposeAction, setProposeAction] = useState('none'); // none | pause | unpause
  const [toast, setToast] = useState('');
  const messagesRef = useRef(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const oldestNsRef = useRef(null); // bigint
  
  // muting form
  const [isPriest, setIsPriest] = useState(false);

  // deployment form
  const [tokenAddress, setTokenAddress] = useState('');
  const [protocolFeeRecipient, setProtocolFeeRecipient] = useState('');
  const [entryFee, setEntryFee] = useState('');
  const [priestVoteWeight, setPriestVoteWeight] = useState('10');
  const [priestWeightThreshold, setPriestWeightThreshold] = useState('10');

  // joining form
  const [templAddress, setTemplAddress] = useState('');
  const [groupId, setGroupId] = useState('');
  const joinedLoggedRef = useRef(false);
  const lastProfileBroadcastRef = useRef(0);

  function pushStatus(msg) {
    setStatus((s) => [...s, String(msg)]);
    try {
      setToast(String(msg));
      window.clearTimeout(window.__templToastT);
      window.__templToastT = window.setTimeout(() => setToast(''), 1800);
    } catch {}
  }

  // Minimal debug logger: prints only in dev or when explicitly enabled for e2e
  const dlog = (...args) => {
    try {
      if (import.meta.env?.DEV || import.meta.env?.VITE_E2E_DEBUG === '1') {
        console.log(...args);
      }
    } catch {}
  };

  async function connectWallet() {
    if (!window.ethereum) return;
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    const signer = await provider.getSigner();
    setSigner(signer);
    const address = await signer.getAddress();
    setWalletAddress(address);
    pushStatus('✅ Wallet connected');
    
    // Proactively close any existing XMTP client before switching identities to avoid
    // OPFS/db handle contention and duplicate streams across wallets during e2e runs.
    try {
      if (xmtp && typeof xmtp.close === 'function') {
        await xmtp.close();
      }
    } catch {}

    // Use an XMTP-compatible signer wrapper for the browser SDK with inbox rotation
    const forcedEnv = import.meta.env.VITE_XMTP_ENV?.trim();
    const xmtpEnv = forcedEnv || (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'dev' : 'production');
    async function createXmtpStable() {
      // Use a stable installation nonce per wallet to avoid exhausting the
      // XMTP dev network's 10-installation cap and to prevent OPFS handle
      // conflicts from repeated Client.create() attempts.
      const storageKey = `xmtp:nonce:${address.toLowerCase()}`;
      let stableNonce = 1;
      try {
        const saved = Number.parseInt(localStorage.getItem(storageKey) || '1', 10);
        if (Number.isFinite(saved) && saved > 0) stableNonce = saved;
      } catch {}

      const xmtpSigner = {
        type: 'EOA',
        getAddress: () => address,
        getIdentifier: () => ({
          identifier: address.toLowerCase(),
          identifierKind: 'Ethereum',
          nonce: stableNonce
        }),
        signMessage: async (message) => {
          let toSign;
          if (message instanceof Uint8Array) {
            try { toSign = ethers.toUtf8String(message); }
            catch { toSign = ethers.hexlify(message); }
          } else if (typeof message === 'string') {
            toSign = message;
          } else {
            toSign = String(message);
          }
          const signature = await signer.signMessage(toSign);
          return ethers.getBytes(signature);
        }
      };

      try {
        dlog('[app] Creating XMTP client with stable nonce', stableNonce);
        const client = await Client.create(xmtpSigner, { env: xmtpEnv, appVersion: 'templ/0.1.0' });
        // Persist the nonce we successfully used so future runs reuse the same installation
        try { localStorage.setItem(storageKey, String(stableNonce)); } catch {}
        return client;
      } catch (err) {
        const msg = String(err?.message || err);
        // If the identity already has 10/10 installations, do not spin — surface a clear error.
        // Re-running with the same nonce avoids creating new installations.
        if (msg.includes('already registered 10/10 installations')) {
          throw new Error('XMTP installation limit reached for this wallet. Please revoke older installations for dev or switch account.');
        }
        throw err;
      }
    }
    // Reset conversation state so the new identity discovers and streams afresh
    setGroup(null);
    setGroupConnected(false);
    const client = await createXmtpStable();
    setXmtp(client);
    dlog('[app] XMTP client created', { env: xmtpEnv, inboxId: client.inboxId });
    // Optional: emit aggregate network stats in e2e/local runs to aid debugging
    try {
      if (import.meta.env.VITE_E2E_DEBUG === '1' || xmtpEnv === 'local') {
        const agg = await client.debugInformation?.apiAggregateStatistics?.();
        if (agg) dlog('[app] XMTP aggregate stats at init:\n' + agg);
      }
    } catch {}
      try {
        if (import.meta.env.VITE_E2E_DEBUG === '1') {
        // Expose limited debug helpers for tests only (built via Vite env)
          window.__XMTP = client;
          window.__xmtpList = async () => {
            try { await syncXMTP(client); } catch {}
            const list = await client.conversations.list();
            return list.map(c => c.id);
          };
          window.__xmtpGetById = async (id) => {
            try { await syncXMTP(client); } catch {}
            try { return Boolean(await client.conversations.getConversationById(id)); }
            catch { return false; }
          };
          window.__xmtpSendById = async (id, content) => {
            try { await syncXMTP(client); } catch {}
            try {
              const conv = await client.conversations.getConversationById(String(id).replace(/^0x/i, ''));
              if (conv) { await conv.send(String(content)); return true; }
              return false;
            } catch { return false; }
          };
          // Create a temporary XMTP client using a raw private key string (hex), optionally
          // send a message to a specific conversation id, and return success. For e2e only.
          window.__xmtpEnsureIdentity = async (privHex) => {
            try {
              const w = new ethers.Wallet(String(privHex));
              const signer = {
                getAddress: async () => w.address,
                signMessage: async (message) => {
                  let toSign;
                  if (message instanceof Uint8Array) {
                    try { toSign = ethers.toUtf8String(message); } catch { toSign = ethers.hexlify(message); }
                  } else if (typeof message === 'string') {
                    toSign = message;
                  } else {
                    toSign = String(message);
                  }
                  const sig = await w.signMessage(toSign);
                  return ethers.getBytes(sig);
                }
              };
              const tmp = await Client.create(signer, { env: xmtpEnv, appVersion: 'templ-e2e/0.1.0' });
              const id = tmp.inboxId;
              try { await tmp.close?.(); } catch {}
              return id || '';
            } catch { return ''; }
          };
          window.__xmtpSendAs = async ({ privHex, id, content }) => {
            try {
              const w = new ethers.Wallet(String(privHex));
              const signer = {
                getAddress: async () => w.address,
                signMessage: async (message) => {
                  let toSign;
                  if (message instanceof Uint8Array) {
                    try { toSign = ethers.toUtf8String(message); } catch { toSign = ethers.hexlify(message); }
                  } else if (typeof message === 'string') {
                    toSign = message;
                  } else {
                    toSign = String(message);
                  }
                  const sig = await w.signMessage(toSign);
                  return ethers.getBytes(sig);
                }
              };
              const tmp = await Client.create(signer, { env: xmtpEnv, appVersion: 'templ-e2e/0.1.0' });
              const wanted = String(id).replace(/^0x/i, '');
              let conv = null;
              const end = Date.now() + 120_000;
              while (Date.now() < end && !conv) {
                try { await tmp.preferences?.inboxState?.(true); } catch {}
                try { await syncXMTP(tmp); } catch {}
                try {
                  conv = await tmp.conversations.getConversationById(wanted);
                  if (!conv) {
                    const list = await tmp.conversations.list?.({ consentStates: ['allowed','unknown','denied'] }) || [];
                    conv = list.find((c) => c.id === wanted) || null;
                  }
                } catch {}
                if (!conv) await new Promise(r => setTimeout(r, 1000));
              }
              if (!conv) { try { await tmp.close?.(); } catch {}; return false; }
              await conv.send(String(content));
              try { await tmp.close?.(); } catch {}
              return true;
            } catch { return false; }
          };
          window.__pushMessage = (from, content) => {
            try {
              setMessages((m) => [...m, { kind: 'text', senderAddress: String(from || '').toLowerCase(), content: String(content || '') }]);
            } catch {}
          };
        }
      } catch {}
      pushStatus('✅ Messaging client ready');
  }

  // Load persisted profile for this XMTP inbox and seed local cache
  useEffect(() => {
    if (!xmtp) return;
    try {
      const raw = localStorage.getItem(`templ:profile:${xmtp.inboxId}`);
      if (raw) {
        const saved = JSON.parse(raw);
        const me = (walletAddress || xmtp.address || '').toLowerCase();
        setProfileName(saved.name || '');
        setProfileAvatar(saved.avatar || '');
        if (me) setProfilesByAddress((p) => ({ ...p, [me]: { name: saved.name || '', avatar: saved.avatar || '' } }));
      }
    } catch {}
  }, [xmtp, walletAddress]);

  async function handleDeploy() {
    dlog('[app] handleDeploy clicked', { signer: !!signer, xmtp: !!xmtp });
    if (!signer) return;
    if (!ethers.isAddress(tokenAddress)) return alert('Invalid token address');
    if (!ethers.isAddress(protocolFeeRecipient))
      return alert('Invalid protocol fee recipient address');
    const nums = [entryFee, priestVoteWeight, priestWeightThreshold];
    if (!nums.every((n) => /^\d+$/.test(n))) return alert('Invalid numeric input');
    try {
      dlog('[app] deploying templ with', { tokenAddress, protocolFeeRecipient, entryFee, priestVoteWeight, priestWeightThreshold });
      const result = await deployTempl({
        ethers,
        xmtp,
        signer,
        walletAddress,
        tokenAddress,
        protocolFeeRecipient,
        entryFee,
        priestVoteWeight,
        priestWeightThreshold,
        templArtifact
      });
      dlog('[app] deployTempl returned', result);
      dlog('[app] deployTempl groupId details', { groupId: result.groupId, has0x: String(result.groupId).startsWith('0x'), len: String(result.groupId).length });
      setTemplAddress(result.contractAddress);
      setGroup(result.group);
      setGroupId(result.groupId);
      pushStatus('✅ Templ deployed');
      if (result.group) {
        pushStatus('✅ Group created and connected');
        setGroupConnected(true);
      } else {
        pushStatus('🔄 Group created, waiting for connection');
      }
      // Move priest to chat interface
      try {
        localStorage.setItem('templ:lastAddress', result.contractAddress);
        if (result.groupId) localStorage.setItem('templ:lastGroupId', String(result.groupId));
      } catch {}
      navigate('/chat');
    } catch (err) {
      console.error('[app] deploy failed', err);
      alert(err.message);
    }
  }

  async function handlePurchaseAndJoin() {
    if (!signer || !xmtp || !templAddress) return;
    if (!ethers.isAddress(templAddress)) return alert('Invalid contract address');
    try {
      dlog('[app] starting purchaseAndJoin', { inboxId: xmtp?.inboxId, address: walletAddress, templAddress });
      const result = await purchaseAndJoin({
        ethers,
        xmtp,
        signer,
        walletAddress,
        templAddress,
        templArtifact
      });
      dlog('[app] purchaseAndJoin returned', result);
      dlog('[app] purchaseAndJoin groupId details', { groupId: result.groupId, has0x: String(result.groupId).startsWith('0x'), len: String(result.groupId).length });
      if (result) {
        setGroup(result.group);
        setGroupId(result.groupId);
        // Clarify semantics: membership confirmed, then discovery may take time
        pushStatus('✅ Membership confirmed; connecting to group');
        if (result.group) {
          pushStatus('✅ Group connected');
          setGroupConnected(true);
        } else {
          pushStatus('🔄 Waiting for group discovery');
        }
        try {
          localStorage.setItem('templ:lastAddress', templAddress);
          if (result.groupId) localStorage.setItem('templ:lastGroupId', String(result.groupId));
        } catch {}
        navigate('/chat');
      }
    } catch (err) {
      alert(err.message);
    }
  }

  // As soon as we have a groupId, surface a visible success status
  useEffect(() => {
    if (groupId && !joinedLoggedRef.current) {
      // Avoid implying the group stream is ready; discovery can lag.
      pushStatus('✅ Group ID received; discovering conversation');
      joinedLoggedRef.current = true;
    }
  }, [groupId]);

  useEffect(() => {
    if (!group || !xmtp) return;
    let cancelled = false;
    // Load initial history (last 100)
    (async () => {
      try {
        setHistoryLoading(true);
        const batch = await group.messages?.({ limit: BigInt(100) });
        const list = Array.isArray(batch) ? batch.slice() : [];
        // sort ascending by time so chronology is natural
        list.sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : a.sentAtNs > b.sentAtNs ? 1 : 0));
        // track earliest
        if (list.length > 0) oldestNsRef.current = list[0].sentAtNs;
        setHasMoreHistory(list.length === 100);
        // transform and seed messages
        const transformed = list.map((dm) => {
          const from = (dm.senderAddress || '').toLowerCase();
          let raw = '';
          try { raw = (typeof dm.content === 'string') ? dm.content : (dm.fallback || ''); } catch {}
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch {}
          if (parsed && parsed.type === 'proposal') {
            const id = Number(parsed.id);
            const title = String(parsed.title || `Proposal #${id}`);
            setProposalsById((prev) => ({ ...prev, [id]: { ...(prev[id]||{}), id, title, yes: (prev[id]?.yes || 0), no: (prev[id]?.no || 0) } }));
            return { mid: dm.id, kind: 'proposal', senderAddress: from, proposalId: id, title };
          }
          if (parsed && parsed.type === 'vote') {
            const id = Number(parsed.id);
            const support = Boolean(parsed.support);
            setProposalsById((prev) => ({ ...prev, [id]: { ...(prev[id]||{ id, yes:0, no:0 }), yes: (prev[id]?.yes || 0) + (support ? 1 : 0), no: (prev[id]?.no || 0) + (!support ? 1 : 0) } }));
            return null;
          }
          if (parsed && (parsed.type === 'templ-created' || parsed.type === 'member-joined')) {
            return { mid: dm.id, kind: 'system', senderAddress: from, content: parsed.type === 'templ-created' ? 'Templ created' : 'Member joined' };
          }
          return { mid: dm.id, kind: 'text', senderAddress: from, content: raw };
        }).filter(Boolean);
        setMessages((prev) => {
          if (prev.length === 0) return transformed;
          // Merge without dup by mid or by proposal id
          const seen = new Set(prev.map((m) => m.mid).filter(Boolean));
          const merged = [...prev];
          for (const m of transformed) {
            if (m.mid && seen.has(m.mid)) continue;
            if (m.kind === 'proposal' && merged.some((it) => it.kind === 'proposal' && Number(it.proposalId) === Number(m.proposalId))) continue;
            merged.push(m);
          }
          return merged;
        });
      } catch {}
      finally { setHistoryLoading(false); }
    })();
    const stream = async () => {
      try {
        const wanted = String(group.id || '').replace(/^0x/i, '');
        const s = await xmtp.conversations.streamAllMessages({
          onError: () => {},
        });
        for await (const msg of s) {
          if (cancelled) break;
          const convId = String(msg?.conversationId || '').replace(/^0x/i, '');
          if (!wanted || convId !== wanted) continue;
          const from = (msg.senderAddress || '').toLowerCase();
          if (mutes.includes(from)) continue;
          const raw = String(msg.content || '');
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch {}
          if (parsed && parsed.type === 'profile') {
            const name = String(parsed.name || '').slice(0, 64);
            const avatar = String(parsed.avatar || '').slice(0, 512);
            setProfilesByAddress((prev) => ({ ...prev, [from]: { name, avatar } }));
            continue;
          }
          if (parsed && parsed.type === 'proposal') {
            const id = Number(parsed.id);
            const title = String(parsed.title || `Proposal #${id}`);
            setProposalsById((prev) => ({ ...prev, [id]: { ...(prev[id]||{}), id, title, yes: (prev[id]?.yes || 0), no: (prev[id]?.no || 0) } }));
            setMessages((m) => {
              if (m.some((it) => it.kind === 'proposal' && Number(it.proposalId) === id)) return m;
              return [...m, { kind: 'proposal', senderAddress: from, proposalId: id, title }];
            });
            continue;
          }
          if (parsed && parsed.type === 'vote') {
            const id = Number(parsed.id);
            const support = Boolean(parsed.support);
            setProposalsById((prev) => ({ ...prev, [id]: { ...(prev[id]||{ id, yes:0, no:0 }), yes: (prev[id]?.yes || 0) + (support ? 1 : 0), no: (prev[id]?.no || 0) + (!support ? 1 : 0) } }));
            continue;
          }
          if (parsed && (parsed.type === 'templ-created' || parsed.type === 'member-joined')) {
            setMessages((m) => [...m, { kind: 'system', senderAddress: from, content: parsed.type === 'templ-created' ? 'Templ created' : `${shorten(parsed.address)} joined` }]);
            continue;
          }
          setMessages((m) => [...m, { kind: 'text', senderAddress: from, content: raw }]);
        }
      } catch {}
    };
    stream();
    setGroupConnected(true);
    pushStatus('✅ Connected to group messages');
    return () => {
      cancelled = true;
    };
  }, [group, xmtp, mutes]);

  // When we know the `groupId`, keep trying to resolve the group locally until found.
  useEffect(() => {
    if (!xmtp || !groupId || group) return;
    let cancelled = false;
    let attempts = 0;
    const norm = (id) => (id || '').replace(/^0x/i, '');
    const wanted = norm(groupId);
    async function logAgg(label) {
      try {
        if (import.meta.env.VITE_E2E_DEBUG === '1') {
          const agg = await xmtp.debugInformation?.apiAggregateStatistics?.();
          if (agg) dlog('[app] XMTP stats ' + label + '\n' + agg);
        }
      } catch {}
    }
    async function poll() {
      while (!cancelled && attempts < 120 && !group) {
        attempts++;
        dlog('[app] finding group', { groupId, wanted, attempt: attempts, inboxId: xmtp?.inboxId });
        try {
          // Fetch new conversations (welcome messages) from the network
          if (import.meta.env.VITE_E2E_DEBUG === '1') {
            try { await xmtp.debugInformation?.clearAllStatistics?.(); } catch {}
          }
          await syncXMTP(xmtp);
          await logAgg('after syncXMTP #' + attempts);
        } catch (e) { console.warn('[app] sync error', e?.message || e); }
        try {
          // Force inbox state refresh from network
          await xmtp.preferences?.inboxState?.(true);
        } catch (e) { console.warn('[app] preferences.inboxState error', e?.message || e); }
        try {
          const maybe = await xmtp.conversations.getConversationById(wanted);
          if (maybe) {
            dlog('[app] found group by id');
            setGroup(maybe);
            pushStatus('✅ Group discovered');
            setGroupConnected(true);
            break;
          }
        } catch (e) { console.warn('[app] getById error', e?.message || e); }
        try {
          const list = await xmtp.conversations.list?.({ consentStates: ['allowed','unknown','denied'] }) || [];
          dlog('[app] list size=', list?.length, 'firstIds=', (list||[]).slice(0,3).map(c=>c.id));
          const found = list.find((c) => norm(c.id) === wanted);
          if (found) {
            dlog('[app] found group by list');
            setGroup(found);
            pushStatus('✅ Group discovered');
            setGroupConnected(true);
            await logAgg('post-discovery');
            break;
          }
        } catch (e) { console.warn('[app] list error', e?.message || e); }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    poll();
    // In parallel, open a short-lived stream to pick up welcome/conversation events
    (async () => {
      try {
        // Proactively sync once before opening streams
        try { await syncXMTP(xmtp); } catch {}
        const convStream = await xmtp.conversations.streamGroups?.();
        const stream = await xmtp.conversations.streamAllMessages?.({ consentStates: ['allowed','unknown','denied'] });
        const endAt = Date.now() + 60_000; // 60s assist window
        const onConversation = async (conv) => {
          if (cancelled || group) return;
          const cid = norm(conv?.id || '');
          if (cid && cid === wanted) {
            dlog('[app] streamGroups observed conversation id=', cid);
            const maybe = await xmtp.conversations.getConversationById(wanted);
            if (maybe) {
              setGroup(maybe);
              pushStatus('✅ Group discovered');
              setGroupConnected(true);
            }
          }
        };
        (async () => { try { for await (const c of convStream) { await onConversation(c); if (group) break; if (Date.now()>endAt) break; } } catch {} })();
        for await (const evt of stream) {
          if (cancelled || group) break;
          if (Date.now() > endAt) break;
          try {
            const cid = norm(evt?.conversationId || '');
            if (cid && cid === wanted) {
              dlog('[app] streamAllMessages observed event in conversation id=', cid);
              const maybe = await xmtp.conversations.getConversationById(wanted);
              if (maybe) {
                setGroup(maybe);
                pushStatus('✅ Group discovered');
                setGroupConnected(true);
                break;
              }
            }
          } catch {}
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [xmtp, groupId, group]);

  useEffect(() => {
    if (!templAddress || !signer) return;
    const provider = signer.provider;
    const stopWatching = watchProposals({
      ethers,
      provider,
      templAddress,
      templArtifact,
      onProposal: (p) => {
        setProposals((prev) => {
          if (prev.some((x) => x.id === p.id)) return prev;
          return [...prev, { ...p, yes: 0, no: 0 }];
        });
        setProposalsById((map) => ({ ...map, [p.id]: { id: p.id, title: p.title, yes: map[p.id]?.yes || 0, no: map[p.id]?.no || 0 } }));
        setMessages((m) => {
          if (m.some((it) => it.kind === 'proposal' && Number(it.proposalId) === p.id)) return m;
          return [...m, { kind: 'proposal', senderAddress: p.proposer?.toLowerCase?.() || '', proposalId: p.id, title: p.title }];
        });
      },
      onVote: (v) => {
        setProposals((prev) => prev.map((p) => p.id === v.id ? { ...p, [v.support ? 'yes' : 'no']: (p[v.support ? 'yes' : 'no'] || 0) + 1 } : p));
        setProposalsById((map) => ({ ...map, [v.id]: { ...(map[v.id] || { id: v.id, yes:0, no:0 }), yes: (map[v.id]?.yes || 0) + (v.support ? 1 : 0), no: (map[v.id]?.no || 0) + (!v.support ? 1 : 0) } }));
      }
    });
    // Poll on-chain proposal tallies to keep UI in sync even if events are missed
    const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
    const pollTallies = async () => {
      try {
        const count = Number(await contract.proposalCount());
        for (let i = 0; i < count; i++) {
          try {
            const p = await contract.getProposal(i);
            const yes = Number(p.yesVotes ?? p[3] ?? 0);
            const no = Number(p.noVotes ?? p[4] ?? 0);
            const title = String(p.title ?? p[1] ?? `Proposal #${i}`);
            if (cancelled) return;
            setProposalsById((map) => ({ ...map, [i]: { ...(map[i] || { id: i }), id: i, title: (map[i]?.title || title), yes, no } }));
            setProposals((prev) => prev.map((it) => it.id === i ? { ...it, yes, no } : it));
            // Ensure a poll bubble exists in chat
            setMessages((m) => {
              if (m.some((it) => it.kind === 'proposal' && Number(it.proposalId) === i)) return m;
              return [...m, { kind: 'proposal', senderAddress: '', proposalId: i, title }];
            });
          } catch {}
        }
      } catch {}
    };
    pollTallies();
    // Poll paused state for display
    let cancelled = false;
    const checkPaused = async () => {
      try {
        const c = new ethers.Contract(templAddress, templArtifact.abi, signer);
        const p = await c.paused();
        if (!cancelled) setPaused(Boolean(p));
      } catch {}
    };
    checkPaused();
    const id = setInterval(checkPaused, 3000);
    const idTallies = setInterval(pollTallies, 3000);
    return () => {
      stopWatching();
      cancelled = true;
      clearInterval(id);
      clearInterval(idTallies);
    };
  }, [templAddress, signer]);

  useEffect(() => {
    if (!templAddress) return;
    let cancelled = false;
    const load = async () => {
      const data = await fetchActiveMutes({ contractAddress: templAddress });
      if (!cancelled)
        setMutes(data.map((m) => m.address.toLowerCase()));
    };
    load();
    const id = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [templAddress]);

  // Load templ list for landing/join
  useEffect(() => {
    (async () => {
      try { setTemplList(await listTempls()); } catch {}
    })();
  }, []);

  // Restore last used templ address on reload so chat and watchers initialize
  useEffect(() => {
    if (templAddress && groupId) return;
    try {
      const last = localStorage.getItem('templ:lastAddress');
      if (last && ethers.isAddress(last)) setTemplAddress(last);
      const lastG = localStorage.getItem('templ:lastGroupId');
      if (lastG && !groupId) setGroupId(lastG.replace(/^0x/i, ''));
    } catch {}
  }, [templAddress, groupId]);

  // Sync query param for join prefill
  useEffect(() => {
    if (path === '/join') {
      const addr = String(query.get('address') || '').trim();
      if (addr && addr !== templAddress) setTemplAddress(addr);
    }
  }, [path, query, templAddress]);

  // Fetch treasury and claimable stats when context is ready
  useEffect(() => {
    (async () => {
      if (!signer || !templAddress) return;
      try {
        const info = await getTreasuryInfo({ ethers, providerOrSigner: signer, templAddress, templArtifact });
        setTreasuryInfo(info);
      } catch {}
      try {
        if (walletAddress) {
          const c = await getClaimable({ ethers, providerOrSigner: signer, templAddress, templArtifact, memberAddress: walletAddress });
          setClaimable(c);
        }
      } catch {}
    })();
  }, [signer, templAddress, walletAddress, proposals, groupConnected]);

  // Persist and restore chat state (messages + proposals) per group/templ for quick reloads
  useEffect(() => {
    // restore when groupId or templAddress available
    try {
      const gid = (groupId || '').toLowerCase();
      if (gid) {
        const raw = localStorage.getItem(`templ:messages:${gid}`);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) setMessages(arr);
        }
      }
    } catch {}
    try {
      const addr = (templAddress || '').toLowerCase();
      if (addr) {
        const raw = localStorage.getItem(`templ:proposals:${addr}`);
        if (raw) {
          const map = JSON.parse(raw);
          if (map && typeof map === 'object') setProposalsById(map);
        }
      }
    } catch {}
  }, [groupId, templAddress]);

  useEffect(() => {
    try {
      const gid = (groupId || '').toLowerCase();
      if (!gid) return;
      const toSave = messages.slice(-200); // cap
      localStorage.setItem(`templ:messages:${gid}`, JSON.stringify(toSave));
    } catch {}
  }, [messages, groupId]);

  useEffect(() => {
    try {
      const addr = (templAddress || '').toLowerCase();
      if (!addr) return;
      localStorage.setItem(`templ:proposals:${addr}`, JSON.stringify(proposalsById));
    } catch {}
  }, [proposalsById, templAddress]);

  async function handleSend() {
    if (!messageInput) return;
    try {
      let activeGroup = group;
      // If discovery lags, resolve the conversation on demand before sending
      if (!activeGroup && xmtp && groupId) {
        try {
          activeGroup = await waitForConversation({ xmtp, groupId, retries: 30, delayMs: 1000 });
          if (activeGroup) {
            setGroup(activeGroup);
            setGroupConnected(true);
            pushStatus('✅ Group discovered');
          }
        } catch {}
      }
      if (!activeGroup) {
        pushStatus('⏳ Connecting to group; please retry');
        return;
      }
      const body = messageInput;
      await sendMessage({ group: activeGroup, content: body });
      // Local echo to ensure immediate UI feedback (stream may take time)
      setMessages((m) => [...m, { senderAddress: walletAddress, content: body }]);
      setMessageInput('');
      pushStatus('✅ Message sent');
    } catch (err) {
      console.error('Send failed', err);
    }
  }

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    try {
      const el = messagesRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } catch {}
  }, [messages]);

  function saveProfileLocally({ name, avatar }) {
    try {
      if (!xmtp) return;
      const data = { name: String(name || '').slice(0, 64), avatar: String(avatar || '').slice(0, 512) };
      localStorage.setItem(`templ:profile:${xmtp.inboxId}`, JSON.stringify(data));
      const me = (walletAddress || xmtp.address || '').toLowerCase();
      if (me) setProfilesByAddress((p) => ({ ...p, [me]: data }));
    } catch {}
  }

  async function broadcastProfileToGroup() {
    try {
      if (!group || !profileName) return;
      const now = Date.now();
      if (now - lastProfileBroadcastRef.current < 10_000) return; // throttle 10s
      lastProfileBroadcastRef.current = now;
      const payload = JSON.stringify({ type: 'profile', name: profileName, avatar: profileAvatar });
      await sendMessage({ group, content: payload });
    } catch {}
  }

  // When joining or switching groups, broadcast profile once for discovery
  useEffect(() => {
    if (!group || !profileName) return;
    (async () => { try { await broadcastProfileToGroup(); } catch {} })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, profileName]);

  async function handleVote(id, support) {
    if (!templAddress || !signer) return;
    await voteOnProposal({
      ethers,
      signer,
      templAddress,
      templArtifact,
      proposalId: id,
      support
    });
  }

  // moderation actions are available via contract-level APIs and backend endpoints,
  // but there is no dedicated form in the chat UI anymore

  async function handleExecuteProposal(proposalId) {
    if (!templAddress || !signer) return;
    try {
      await executeProposal({
        ethers,
        signer,
        templAddress,
        templArtifact,
        proposalId
      });
      alert(`Executed proposal ${proposalId}`);
      pushStatus(`✅ Proposal ${proposalId} executed`);
    } catch (err) {
      alert('Execution failed: ' + err.message);
    }
  }

  async function handleClaimFees() {
    if (!templAddress || !signer) return;
    setClaimLoading(true);
    try {
      await claimMemberPool({ ethers, signer, templAddress, templArtifact });
      // Refresh claimable and treasury info after claim
      try {
        const info = await getTreasuryInfo({ ethers, providerOrSigner: signer, templAddress, templArtifact });
        setTreasuryInfo(info);
      } catch {}
      try {
        if (walletAddress) {
          const c = await getClaimable({ ethers, providerOrSigner: signer, templAddress, templArtifact, memberAddress: walletAddress });
          setClaimable(c);
        }
      } catch {}
      pushStatus('✅ Rewards claimed');
    } catch (err) {
      alert('Claim failed: ' + (err?.message || String(err)));
    } finally {
      setClaimLoading(false);
    }
  }

  // Check if user is priest
  useEffect(() => {
    async function checkPriest() {
      if (!templAddress || !walletAddress || !signer) return;
      try {
        const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
        const priestAddr = await contract.priest();
        setIsPriest(priestAddr?.toLowerCase() === walletAddress.toLowerCase());
      } catch (err) {
        console.error('Error checking priest status:', err);
      }
    }
    checkPriest();
  }, [templAddress, walletAddress, signer]);

  function shorten(addr) {
    try {
      const a = String(addr);
      if (a.length <= 12) return a;
      return a.slice(0, 6) + '...' + a.slice(-6);
    } catch {
      return addr;
    }
  }
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard?.writeText(text);
      pushStatus('📋 Copied to clipboard');
    } catch {
      try {
        const el = document.createElement('textarea');
        el.value = text;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        pushStatus('📋 Copied to clipboard');
      } catch {}
    }
  }

  return (
    <div className="App min-h-screen flex flex-col overflow-x-hidden">
      {/* Header / Nav */}
      <div className="w-full border-b border-black/10">
        <div className="max-w-screen-md mx-auto px-4 py-2 flex items-center justify-between">
          <div className="flex gap-2">
            <button className="px-3 py-1 rounded border border-black/20" onClick={() => navigate('/')}>Home</button>
            <button className="px-3 py-1 rounded border border-black/20" onClick={() => navigate('/create')}>Create</button>
            <button className="px-3 py-1 rounded border border-black/20" onClick={() => navigate('/join')}>Join</button>
            <button className="px-3 py-1 rounded border border-black/20" onClick={() => navigate('/chat')}>Chat</button>
          </div>
          <div className="flex items-center gap-2">
            {walletAddress && (
              <button className="px-3 py-1 rounded border border-black/20" onClick={() => setProfileOpen(true)}>Profile</button>
            )}
            <button className="px-3 py-1 rounded bg-primary text-black font-semibold" onClick={connectWallet}>Connect Wallet</button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-md w-full mx-auto px-4 py-4 flex-1 flex flex-col min-h-0">
        {/* Hidden debug payloads for tooling if needed */}
        {templAddress && (
          <div
            data-testid="deploy-info"
            data-contract-address={templAddress}
            data-group-id={groupId}
            style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: 0 }}
          />
        )}

        {/* Contract info block removed from main view; accessible via Info drawer in Chat */}

        {/* Routes */}
        {path === '/' && (
          <div data-testid="templ-list" className="space-y-3">
            <h2 className="text-xl font-semibold">Templs</h2>
            {templList.length === 0 && <p>No templs yet</p>}
            {templList.map((t) => (
              <div key={t.contract} className="flex flex-col sm:flex-row sm:items-center gap-2">
                <button type="button" title="Copy address" data-address={String(t.contract).toLowerCase()} className="text-left underline underline-offset-4 font-mono text-sm flex-1 break-words" onClick={() => copyToClipboard(t.contract)}>
                  {shorten(t.contract)}
                </button>
                <button className="px-3 py-1 rounded bg-primary text-black font-semibold w-full sm:w-auto" onClick={() => navigate(`/join?address=${t.contract}`)}>Join</button>
              </div>
            ))}
            <div className="pt-2">
              <button className="px-4 py-2 rounded bg-primary text-black font-semibold" onClick={() => navigate('/create')}>Create Templ</button>
            </div>
          </div>
        )}

        {path === '/create' && (
          <div className="forms space-y-3">
            <div className="deploy space-y-2">
              <h2 className="text-xl font-semibold">Create Templ</h2>
              <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Token address" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} />
              <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Protocol fee recipient" value={protocolFeeRecipient} onChange={(e) => setProtocolFeeRecipient(e.target.value)} />
              <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Entry fee" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} />
              <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Priest vote weight (default 10)" value={priestVoteWeight} onChange={(e) => setPriestVoteWeight(e.target.value)} />
              <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Priest weight threshold (default 10)" value={priestWeightThreshold} onChange={(e) => setPriestWeightThreshold(e.target.value)} />
              <button className="px-4 py-2 rounded bg-primary text-black font-semibold w-full sm:w-auto" onClick={handleDeploy}>Deploy</button>
            </div>
          </div>
        )}

        {path === '/join' && (
          <div className="join space-y-3">
            <h2 className="text-xl font-semibold">Join Existing Templ</h2>
            <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Contract address" value={templAddress} onChange={(e) => setTemplAddress(e.target.value)} />
            <button className="px-4 py-2 rounded bg-primary text-black font-semibold w-full sm:w-auto" onClick={handlePurchaseAndJoin}>Purchase & Join</button>
            {/* Optional list if no prefill */}
            {(!templAddress || templAddress.trim() === '') && (
              <div className="space-y-2">
                {templList.map((t) => (
                  <div key={t.contract} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <button type="button" title="Copy address" data-address={String(t.contract).toLowerCase()} className="text-left underline underline-offset-4 font-mono text-sm flex-1 break-words" onClick={() => copyToClipboard(t.contract)}>
                      {shorten(t.contract)}
                    </button>
                    <button className="px-3 py-1 rounded border border-black/20 w-full sm:w-auto" onClick={() => navigate(`/join?address=${t.contract}`)}>Select</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {path === '/chat' && (
          <div className="chat-shell">
            <div className="chat-header flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="avatar avatar--group" aria-hidden />
                <div>
                  <div className="text-lg font-semibold">Group Chat</div>
                  {templAddress && (
                    <div className="text-xs text-black/60">{shorten(templAddress)}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {groupConnected && <span className="text-xs text-green-600" data-testid="group-connected">● Connected</span>}
                {!groupConnected && <span className="text-xs text-black/60">Connecting…</span>}
                <button className="btn" onClick={() => setProposeOpen(true)}>Propose vote</button>
                <button className="btn" onClick={() => {
                  try {
                    const el = messagesRef.current;
                    if (!el) return;
                    const poll = el.querySelector('.chat-item--poll');
                    if (poll && poll.scrollIntoView) poll.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  } catch {}
                }}>See open votes</button>
                <button className="btn" onClick={() => setShowInfo((v) => !v)}>{showInfo ? 'Hide' : 'Info'}</button>
              </div>
            </div>

            {/* Always-on brief stats */}
            {templAddress && (
              <div className="text-xs text-black/70 px-1 py-1">
                Treasury: {treasuryInfo?.treasury || '0'} · Burned: {treasuryInfo?.totalBurnedAmount || '0'} · Claimable: <span data-testid="claimable-amount">{claimable || '0'}</span>
              </div>
            )}

            {showInfo && (
              <div className="drawer my-2">
                <div className="drawer-title">Group Info</div>
                <div className="drawer-grid">
                  <div className="text-sm text-black/70">DAO Status: {paused ? 'Paused' : 'Active'}</div>
                  {templAddress && (
                    <>
                      <div className="text-sm">Treasury: {treasuryInfo?.treasury || '0'}</div>
                      <div className="text-sm">Total Burned: {treasuryInfo?.totalBurnedAmount || '0'}</div>
                      <div className="text-sm flex items-center gap-2">
                        <span>Claimable (you): <span data-testid="claimable-amount-info">{claimable || '0'}</span></span>
                        <button className="btn btn-primary" data-testid="claim-fees" disabled={claimLoading || !claimable || claimable === '0'} onClick={handleClaimFees}>{claimLoading ? 'Claiming…' : 'Claim'}</button>
                      </div>
                      <div className="flex gap-2 items-center">
                        <input className="flex-1 border border-black/20 rounded px-3 py-2" readOnly value={`${window.location.origin}/join?address=${templAddress}`} />
                        <button className="btn" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/join?address=${templAddress}`).catch(()=>{}); pushStatus('📋 Invite link copied'); }}>Copy Invite</button>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn btn-primary" onClick={() => navigate('/create')}>Create Proposal</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesRef} className="messages chat-main chat-list border border-black/10 rounded">
            {hasMoreHistory && (
              <div className="w-full flex justify-center py-1">
                <button className="btn" disabled={historyLoading} onClick={async () => {
                  if (!group || historyLoading) return;
                  setHistoryLoading(true);
                  const el = messagesRef.current;
                  const prevHeight = el ? el.scrollHeight : 0;
                  try {
                    const before = oldestNsRef.current;
                    const opts = before ? { limit: BigInt(100), sentBeforeNs: before } : { limit: BigInt(100) };
                    const batch = await group.messages?.(opts);
                    const list = Array.isArray(batch) ? batch.slice() : [];
                    list.sort((a, b) => (a.sentAtNs < b.sentAtNs ? -1 : a.sentAtNs > b.sentAtNs ? 1 : 0));
                    if (list.length > 0) oldestNsRef.current = list[0].sentAtNs;
                    setHasMoreHistory(list.length === 100);
                    const transformed = list.map((dm) => {
                      let raw = '';
                      try { raw = (typeof dm.content === 'string') ? dm.content : (dm.fallback || ''); } catch {}
                      let parsed = null;
                      try { parsed = JSON.parse(raw); } catch {}
                      if (parsed && parsed.type === 'proposal') {
                        const id = Number(parsed.id);
                        const title = String(parsed.title || `Proposal #${id}`);
                        setProposalsById((prev) => ({ ...prev, [id]: { ...(prev[id]||{}), id, title, yes: (prev[id]?.yes || 0), no: (prev[id]?.no || 0) } }));
                        return { mid: dm.id, kind: 'proposal', senderAddress: '', proposalId: id, title };
                      }
                      if (parsed && parsed.type === 'vote') {
                        const id = Number(parsed.id);
                        const support = Boolean(parsed.support);
                        setProposalsById((prev) => ({ ...prev, [id]: { ...(prev[id]||{ id, yes:0, no:0 }), yes: (prev[id]?.yes || 0) + (support ? 1 : 0), no: (prev[id]?.no || 0) + (!support ? 1 : 0) } }));
                        return null;
                      }
                      if (parsed && (parsed.type === 'templ-created' || parsed.type === 'member-joined')) {
                        return { mid: dm.id, kind: 'system', senderAddress: '', content: parsed.type === 'templ-created' ? 'Templ created' : 'Member joined' };
                      }
                      return { mid: dm.id, kind: 'text', senderAddress: '', content: raw };
                    }).filter(Boolean);
                    setMessages((prev) => {
                      const seen = new Set(prev.map((m) => m.mid).filter(Boolean));
                      const merged = [...transformed, ...prev.filter((m) => !m.mid || !seen.has(m.mid))];
                      return merged;
                    });
                  } catch {}
                  finally {
                    setHistoryLoading(false);
                    // maintain scroll position after prepending
                    setTimeout(() => {
                      const afterEl = messagesRef.current;
                      if (el && afterEl) {
                        const delta = afterEl.scrollHeight - prevHeight;
                        afterEl.scrollTop = delta + afterEl.scrollTop;
                      }
                    }, 0);
                  }
                }}>Load previous</button>
              </div>
            )}
            {messages.map((m, i) => {
              if (m.kind === 'proposal') {
                const pid = m.proposalId;
                const poll = proposalsById[pid] || { yes: 0, no: 0 };
                const total = (poll.yes || 0) + (poll.no || 0);
                const yesPct = total ? Math.round((poll.yes || 0) * 100 / total) : 0;
                const noPct = total ? 100 - yesPct : 0;
                return (
                  <div key={i} className="chat-item chat-item--poll">
                    <div className="chat-poll">
                      <div className="chat-poll__title">{m.title || `Proposal #${pid}`}</div>
                      <div className="chat-poll__bars">
                        <div className="chat-poll__bar is-yes" style={{ width: `${yesPct}%` }} />
                        <div className="chat-poll__bar is-no" style={{ width: `${noPct}%` }} />
                      </div>
                      <div className="chat-poll__legend" data-testid="poll-legend">Yes <span data-testid="poll-yes-count">{poll.yes || 0}</span> · No <span data-testid="poll-no-count">{poll.no || 0}</span></div>
                      <div className="chat-poll__actions">
                        <button className="btn" onClick={() => handleVote(pid, true)}>Vote Yes</button>
                        <button className="btn" onClick={() => handleVote(pid, false)}>Vote No</button>
                        {isPriest && (
                          <button className="btn btn-primary" onClick={() => handleExecuteProposal(pid)}>Execute</button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }
              if (m.kind === 'system') {
                return (
                  <div key={i} className="chat-item chat-item--system">{m.content}</div>
                );
              }
              const mine = walletAddress && m.senderAddress && m.senderAddress.toLowerCase() === walletAddress.toLowerCase();
              const addr = (m.senderAddress || '').toLowerCase();
              const prof = profilesByAddress[addr] || {};
              const display = (mine ? (profileName || 'You') : (prof.name || shorten(m.senderAddress)));
              return (
                <div key={i} className={`chat-item ${mine ? 'is-mine' : ''}`}>
                  {!mine && (
                    <div className="chat-ava" aria-hidden>{avatarFallback(prof.avatar, display)}</div>
                  )}
                  <div className={`chat-bubble ${mine ? 'mine' : ''}`}>
                    <div className="chat-meta">
                      <button className="chat-name" title={m.senderAddress} onClick={() => copyToClipboard(m.senderAddress)}>
                        {display}
                      </button>
                      <span className="chat-time">{formatTime(new Date())}</span>
                    </div>
                    <div className="chat-text">{m.content}</div>
                  </div>
                </div>
              );
            })}
            </div>
            <div className="chat-composer flex gap-2">
              <input className="flex-1 border border-black/20 rounded px-3 py-2" data-testid="chat-input" placeholder="Type a message" value={messageInput} onChange={(e) => setMessageInput(e.target.value)} />
              <button className="px-3 py-2 rounded bg-primary text-black font-semibold" data-testid="chat-send" onClick={handleSend} disabled={!group && !groupId}>Send</button>
            </div>
          </div>
        )}
      </div>

      {/* Hidden status bucket for tests (not user-facing) */}
      <div className="status" style={{ position: 'absolute', left: '-10000px', width: 0, height: 0, overflow: 'hidden' }}>{status.join('\n')}</div>

      {/* Profile Modal */}
      {profileOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__backdrop" onClick={() => setProfileOpen(false)} />
          <div className="modal__card">
            <div className="modal__header">
              <div className="modal__title">Your Profile</div>
              <button className="modal__close" onClick={() => setProfileOpen(false)}>×</button>
            </div>
            <div className="modal__body">
              <div className="mb-2 text-sm text-black/70">Set a display name and an optional avatar URL. This will be reused across all Templs. We’ll also broadcast it to the current group so others can see it.</div>
              <input className="w-full border border-black/20 rounded px-3 py-2 mb-2" placeholder="Display name" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
              <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Avatar URL (optional)" value={profileAvatar} onChange={(e) => setProfileAvatar(e.target.value)} />
            </div>
            <div className="modal__footer">
              <button className="btn" onClick={() => setProfileOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={async () => { saveProfileLocally({ name: profileName, avatar: profileAvatar }); await broadcastProfileToGroup(); setProfileOpen(false); }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Propose Modal */}
      {proposeOpen && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="modal__backdrop" onClick={() => setProposeOpen(false)} />
          <div className="modal__card">
            <div className="modal__header">
              <div className="modal__title">Propose a Vote</div>
              <button className="modal__close" onClick={() => setProposeOpen(false)}>×</button>
            </div>
            <div className="modal__body">
              <input className="w-full border border-black/20 rounded px-3 py-2 mb-2" placeholder="Title" value={proposeTitle} onChange={(e) => setProposeTitle(e.target.value)} />
              <input className="w-full border border-black/20 rounded px-3 py-2 mb-3" placeholder="Description (optional)" value={proposeDesc} onChange={(e) => setProposeDesc(e.target.value)} />
              <div className="text-sm mb-2">Quick Actions</div>
              <div className="flex gap-2 mb-2">
                <button className={`btn ${proposeAction==='pause'?'btn-primary':''}`} onClick={() => setProposeAction('pause')}>Pause DAO</button>
                <button className={`btn ${proposeAction==='unpause'?'btn-primary':''}`} onClick={() => setProposeAction('unpause')}>Unpause DAO</button>
                <button className={`btn ${proposeAction==='moveTreasuryToMe'?'btn-primary':''}`} onClick={() => setProposeAction('moveTreasuryToMe')}>Move Treasury To Me</button>
                <button className={`btn ${proposeAction==='none'?'btn-primary':''}`} onClick={() => setProposeAction('none')}>Custom/None</button>
              </div>
              <div className="text-xs text-black/60">Tip: Pause/Unpause encodes the call data automatically.</div>
            </div>
            <div className="modal__footer">
              <button className="btn" onClick={() => setProposeOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={async () => {
                try {
                  if (!templAddress || !signer) return;
                  let callData = '0x';
                  if (proposeAction === 'pause' || proposeAction === 'unpause') {
                    try {
                      const iface = new ethers.Interface(['function setPausedDAO(bool)']);
                      callData = iface.encodeFunctionData('setPausedDAO', [proposeAction === 'pause']);
                    } catch {}
                  } else if (proposeAction === 'moveTreasuryToMe') {
                    try {
                      const me = await signer.getAddress();
                      const iface = new ethers.Interface(['function withdrawAllTreasuryDAO(address recipient, string reason)']);
                      callData = iface.encodeFunctionData('withdrawAllTreasuryDAO', [me, 'Tech demo payout']);
                      if (!proposeTitle) setProposeTitle('Move Treasury to me');
                    } catch {}
                  }
                  await proposeVote({ ethers, signer, templAddress, templArtifact, title: proposeTitle || 'Untitled', description: (proposeDesc || proposeTitle || 'Proposal'), callData });
                  setProposeOpen(false);
                  setProposeTitle('');
                  setProposeDesc('');
                  setProposeAction('none');
                  pushStatus('✅ Proposal submitted');
                } catch (err) {
                  alert('Proposal failed: ' + (err?.message || String(err)));
                }
              }}>Submit Proposal</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-4 bg-black text-white text-sm px-3 py-2 rounded shadow">
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;

// UI helpers kept at bottom to avoid re-renders
function formatTime(d) {
  try {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function avatarFallback(url, label) {
  if (url && /^https?:\/\//i.test(url)) {
    return <img className="avatar-img" src={url} alt="avatar" onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
  }
  const initials = (label || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] || '')
    .join('')
    .toUpperCase() || '👤';
  return <div className="avatar-fallback">{initials}</div>;
}
