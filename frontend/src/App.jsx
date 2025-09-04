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
  muteMember
} from './flows.js';
import { syncXMTP } from '../../shared/xmtp.js';
import './App.css';

function App() {
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

  async function handleSend() {
    if (!messageInput) return;
    try {
      if (group) {
        await sendMessage({ group, content: messageInput });
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

  return (
    <div className="App">
      <div className="status">
        <h3>Run Status</h3>
        <div className="status-items">
          {status.map((s, i) => (
            <div key={i}>{s}</div>
          ))}
        </div>
      </div>
      {templAddress && (
        <div className="deploy-info">
          <p>Contract: {templAddress}</p>
          <p>Group ID: {groupId}</p>
        </div>
      )}
      {!walletAddress && (
        <button onClick={connectWallet}>Connect Wallet</button>
      )}

      {walletAddress && !group && (
        <div className="forms">
          <div className="deploy">
            <h2>Create Templ</h2>
            <input
              placeholder="Token address"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value)}
            />
            <input
              placeholder="Protocol fee recipient"
              value={protocolFeeRecipient}
              onChange={(e) => setProtocolFeeRecipient(e.target.value)}
            />
            <input
              placeholder="Entry fee"
              value={entryFee}
              onChange={(e) => setEntryFee(e.target.value)}
            />
            <input
              placeholder="Priest vote weight (default 10)"
              value={priestVoteWeight}
              onChange={(e) => setPriestVoteWeight(e.target.value)}
            />
            <input
              placeholder="Priest weight threshold (default 10)"
              value={priestWeightThreshold}
              onChange={(e) => setPriestWeightThreshold(e.target.value)}
            />
            <button onClick={handleDeploy}>Deploy</button>
            {templAddress && (
              <div>
                <p>Contract: {templAddress}</p>
                <p>Group ID: {groupId}</p>
              </div>
            )}
          </div>
          <div className="join">
            <h2>Join Existing Templ</h2>
            <input
              placeholder="Contract address"
              value={templAddress}
              onChange={(e) => setTemplAddress(e.target.value)}
            />
            <button onClick={handlePurchaseAndJoin}>Purchase & Join</button>
          </div>
        </div>
      )}

      {groupId && (
        <div className="chat">
          <h2>Group Chat</h2>
          {!group && <p>Connecting to group… syncing messages</p>}
          {groupConnected && <p>✅ Group connected</p>}
          <p>DAO Status: {paused ? 'Paused' : 'Active'}</p>
          <div className="messages">
            {messages.map((m, i) => (
              <div key={i}>
                <strong>{m.senderAddress}:</strong> {m.content}
              </div>
            ))}
          </div>
          <input
            data-testid="chat-input"
            placeholder="Type a message"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
          />
          <button data-testid="chat-send" onClick={handleSend} disabled={!group && !groupId}>Send</button>

          <div className="proposal-form">
            <h3>New Proposal</h3>
            <input
              placeholder="Title"
              value={proposalTitle}
              onChange={(e) => setProposalTitle(e.target.value)}
            />
            <input
              placeholder="Description"
              value={proposalDesc}
              onChange={(e) => setProposalDesc(e.target.value)}
            />
            <input
              placeholder="Call data"
              value={proposalCalldata}
              onChange={(e) => setProposalCalldata(e.target.value)}
            />
            <button onClick={handlePropose}>Propose</button>
          </div>

          <div className="proposals">
            <h3>Proposals</h3>
            {proposals.map((p) => (
              <div key={p.id} className="proposal">
                <p>
                  {p.title} — yes {p.yes || 0} / no {p.no || 0}
                </p>
                <button onClick={() => handleVote(p.id, true)}>Yes</button>
                <button onClick={() => handleVote(p.id, false)}>No</button>
                <button onClick={() => handleExecuteProposal(p.id)}>Execute</button>
              </div>
            ))}
          </div>

          {isPriest && (
            <div className="muting-controls">
              <h3>Moderation Controls</h3>
              <div className="mute-form">
                <input
                  placeholder="Address to mute"
                  value={muteAddress}
                  onChange={(e) => setMuteAddress(e.target.value)}
                />
                <button onClick={handleMute}>Mute Address</button>
              </div>
              <div className="delegate-form">
                <input
                  placeholder="Delegate moderation to address"
                  value={delegateAddress}
                  onChange={(e) => setDelegateAddress(e.target.value)}
                />
                <button onClick={handleDelegate}>Delegate</button>
              </div>
              {mutes.length > 0 && (
                <div className="active-mutes">
                  <h4>Currently Muted:</h4>
                  {mutes.map((addr) => (
                    <div key={addr}>{addr}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
