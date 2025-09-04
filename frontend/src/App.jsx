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
  watchProposals,
  fetchActiveMutes,
  delegateMute,
  muteMember,
  listTempls,
  getTreasuryInfo,
  getClaimable
} from './flows.js';
import { syncXMTP } from '../../shared/xmtp.js';
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
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [proposals, setProposals] = useState([]);
  const [proposalTitle, setProposalTitle] = useState('');
  const [proposalDesc, setProposalDesc] = useState('');
  const [proposalCalldata, setProposalCalldata] = useState('');
  const [mutes, setMutes] = useState([]);
  const [templList, setTemplList] = useState([]);
  const [treasuryInfo, setTreasuryInfo] = useState(null);
  const [claimable, setClaimable] = useState(null);
  
  // muting form
  const [muteAddress, setMuteAddress] = useState('');
  const [delegateAddress, setDelegateAddress] = useState('');
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

  function pushStatus(msg) {
    setStatus((s) => [...s, msg]);
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
      }
    } catch {}
    pushStatus('✅ Messaging client ready');
  }

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
      try { localStorage.setItem('templ:lastAddress', result.contractAddress); } catch {}
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
        try { localStorage.setItem('templ:lastAddress', templAddress); } catch {}
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
    if (!group) return;
    let cancelled = false;
    const stream = async () => {
      for await (const msg of await group.streamMessages()) {
        if (cancelled) break;
        if (mutes.includes(msg.senderAddress.toLowerCase())) continue;
        setMessages((m) => [...m, msg]);
      }
    };
    stream();
    setGroupConnected(true);
    pushStatus('✅ Connected to group messages');
    return () => {
      cancelled = true;
    };
  }, [group, mutes]);

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
      onProposal: (p) => setProposals((prev) => [...prev, { ...p, yes: 0, no: 0 }]),
      onVote: (v) =>
        setProposals((prev) =>
          prev.map((p) =>
            p.id === v.id
              ? { ...p, [v.support ? 'yes' : 'no']: (p[v.support ? 'yes' : 'no'] || 0) + 1 }
              : p
          )
        )
    });
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
    return () => {
      stopWatching();
      cancelled = true;
      clearInterval(id);
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

  async function handleSend() {
    if (!messageInput) return;
    try {
      if (group) {
        const body = messageInput;
        await sendMessage({ group, content: body });
        // Local echo to ensure immediate UI feedback (stream may take time)
        setMessages((m) => [...m, { senderAddress: walletAddress, content: body }]);
      } else {
        return;
      }
      setMessageInput('');
      pushStatus('✅ Message sent');
    } catch (err) {
      console.error('Send failed', err);
    }
  }

  async function handlePropose() {
    if (!templAddress || !signer) return;
    await proposeVote({
      ethers,
      signer,
      templAddress,
      templArtifact,
      title: proposalTitle,
      description: proposalDesc,
      callData: proposalCalldata
    });
    setProposalTitle('');
    setProposalDesc('');
    setProposalCalldata('');
    pushStatus('✅ Proposal submitted');
  }

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

  async function handleMute() {
    if (!templAddress || !signer || !muteAddress) return;
    try {
      const mutedUntil = await muteMember({
        signer,
        contractAddress: templAddress,
        moderatorAddress: walletAddress,
        targetAddress: muteAddress
      });
      alert(`Muted ${muteAddress} until ${mutedUntil || 'indefinite'}`);
      setMuteAddress('');
      // Refresh mutes
      const data = await fetchActiveMutes({ contractAddress: templAddress });
      setMutes(data.map((m) => m.address.toLowerCase()));
    } catch (err) {
      alert('Mute failed: ' + err.message);
    }
  }

  async function handleDelegate() {
    if (!templAddress || !signer || !delegateAddress) return;
    try {
      const delegated = await delegateMute({
        signer,
        contractAddress: templAddress,
        priestAddress: walletAddress,
        delegateAddress
      });
      alert(delegated ? `Delegated muting power to ${delegateAddress}` : 'Delegation removed');
      setDelegateAddress('');
    } catch (err) {
      alert('Delegate failed: ' + err.message);
    }
  }

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
          {!walletAddress && (
            <button className="px-3 py-1 rounded bg-primary text-black font-semibold" onClick={connectWallet}>Connect Wallet</button>
          )}
        </div>
      </div>

      <div className="max-w-screen-md w-full mx-auto px-4 py-4 flex-1">
        {/* Status area (shared) */}
        <div className="status mb-4">
          <h3 className="text-lg font-semibold mb-2">Run Status</h3>
          <div className="status-items text-sm space-y-1">
            {status.map((s, i) => (
              <div key={i}>{s}</div>
            ))}
          </div>
        </div>

        {/* Contract info (if known) */}
        {templAddress && (
          <div
            className="deploy-info mb-4 text-sm"
            data-testid="deploy-info"
            data-contract-address={templAddress}
            data-group-id={groupId}
          >
            <p>
              Contract: <button className="underline underline-offset-4" onClick={() => copyToClipboard(templAddress)}>{shorten(templAddress)}</button>
            </p>
            <p>
              Group ID: <button className="underline underline-offset-4" onClick={() => copyToClipboard(groupId)}>{shorten(groupId)}</button>
            </p>
          </div>
        )}

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
          <div className="chat space-y-3">
            <h2 className="text-xl font-semibold">Group Chat</h2>
            {!group && <p>Connecting to group… syncing messages</p>}
            {groupConnected && <p data-testid="group-connected">✅ Group connected</p>}
            <p>DAO Status: {paused ? 'Paused' : 'Active'}</p>

            {/* Stats */}
            {templAddress && (
              <div className="space-y-1">
                <div>Treasury: {treasuryInfo?.treasury || '0'}</div>
                <div>Total Burned: {treasuryInfo?.totalBurnedAmount || '0'}</div>
                <div>Claimable (you): {claimable || '0'}</div>
                <div className="pt-2">
                  <button className="px-3 py-1 rounded bg-primary text-black font-semibold" onClick={() => navigate('/create')}>Create Proposal</button>
                </div>
              </div>
            )}

            {/* Invite link */}
            {templAddress && (
              <div className="space-y-2">
                <div>Invite Link</div>
                <input className="w-full border border-black/20 rounded px-3 py-2" readOnly value={`${window.location.origin}/join?address=${templAddress}`} />
                <button className="px-3 py-1 rounded border border-black/20" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/join?address=${templAddress}`).catch(()=>{}); }}>Copy Invite</button>
              </div>
            )}

            <div className="messages space-y-1 max-h-[40vh] overflow-auto border border-black/10 rounded p-2">
              {messages.map((m, i) => (
                <div key={i} className="text-sm break-words">
                  <strong className="font-mono">
                    <button className="underline underline-offset-4" onClick={() => copyToClipboard(m.senderAddress)}>
                      {shorten(m.senderAddress)}
                    </button>:
                  </strong> {m.content}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input className="flex-1 border border-black/20 rounded px-3 py-2" data-testid="chat-input" placeholder="Type a message" value={messageInput} onChange={(e) => setMessageInput(e.target.value)} />
              <button className="px-3 py-2 rounded bg-primary text-black font-semibold" data-testid="chat-send" onClick={handleSend} disabled={!group && !groupId}>Send</button>
            </div>

            <div className="proposal-form space-y-2">
              <h3 className="font-semibold">New Proposal</h3>
              <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Title" value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} />
              <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Description" value={proposalDesc} onChange={(e) => setProposalDesc(e.target.value)} />
              <input className="w-full border border-black/20 rounded px-3 py-2" placeholder="Call data" value={proposalCalldata} onChange={(e) => setProposalCalldata(e.target.value)} />
              <button className="px-3 py-1 rounded bg-primary text-black font-semibold w-full sm:w-auto" onClick={handlePropose}>Propose</button>
            </div>

            <div className="proposals space-y-2">
              <h3 className="font-semibold">Proposals</h3>
              {proposals.map((p) => (
                <div key={p.id} className="proposal border border-black/10 rounded p-2 flex flex-col sm:flex-row sm:items-center gap-2">
                  <p className="flex-1">{p.title} — yes {p.yes || 0} / no {p.no || 0}</p>
                  <div className="flex gap-2">
                    <button className="px-3 py-1 rounded border border-black/20" onClick={() => handleVote(p.id, true)}>Yes</button>
                    <button className="px-3 py-1 rounded border border-black/20" onClick={() => handleVote(p.id, false)}>No</button>
                    <button className="px-3 py-1 rounded bg-primary text-black font-semibold" onClick={() => handleExecuteProposal(p.id)}>Execute</button>
                  </div>
                </div>
              ))}
            </div>

            {isPriest && (
              <div className="muting-controls space-y-2">
                <h3 className="font-semibold">Moderation Controls</h3>
                <div className="mute-form flex gap-2">
                  <input className="flex-1 border border-black/20 rounded px-3 py-2" placeholder="Address to mute" value={muteAddress} onChange={(e) => setMuteAddress(e.target.value)} />
                  <button className="px-3 py-1 rounded border border-black/20" onClick={handleMute}>Mute Address</button>
                </div>
                <div className="delegate-form flex gap-2">
                  <input className="flex-1 border border-black/20 rounded px-3 py-2" placeholder="Delegate moderation to address" value={delegateAddress} onChange={(e) => setDelegateAddress(e.target.value)} />
                  <button className="px-3 py-1 rounded border border-black/20" onClick={handleDelegate}>Delegate</button>
                </div>
                {mutes.length > 0 && (
                  <div className="active-mutes">
                    <h4 className="font-semibold">Currently Muted:</h4>
                {mutes.map((addr) => (
                  <div key={addr} className="text-sm break-all">
                    <button className="underline underline-offset-4" onClick={() => copyToClipboard(addr)}>{shorten(addr)}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
