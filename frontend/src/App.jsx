import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Client } from '@xmtp/browser-sdk';
import templArtifact from './contracts/TEMPL.json';
import {
  deployTempl,
  purchaseAndJoin,
  sendMessage,
  sendMessageBackend,
  proposeVote,
  voteOnProposal,
  watchProposals,
  fetchActiveMutes
} from './flows.js';
import './App.css';

function App() {
  const [walletAddress, setWalletAddress] = useState();
  const [signer, setSigner] = useState();
  const [xmtp, setXmtp] = useState();
  const [group, setGroup] = useState();
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

  async function connectWallet() {
    if (!window.ethereum) return;
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    const signer = await provider.getSigner();
    setSigner(signer);
    const address = await signer.getAddress();
    setWalletAddress(address);
    
    // Use an XMTP-compatible signer wrapper for the browser SDK
    const xmtpEnv = ['localhost', '127.0.0.1'].includes(window.location.hostname)
      ? 'dev'
      : 'production';
    const xmtpSigner = {
      type: 'EOA',
      getAddress: () => address,
      getIdentifier: () => ({
        identifier: address.toLowerCase(),
        identifierKind: 'Ethereum'
      }),
      signMessage: async (message) => {
        let toSign;
        if (message instanceof Uint8Array) {
          try {
            toSign = ethers.toUtf8String(message);
          } catch {
            toSign = ethers.hexlify(message);
          }
        } else if (typeof message === 'string') {
          toSign = message;
        } else {
          toSign = String(message);
        }
        const signature = await signer.signMessage(toSign);
        return ethers.getBytes(signature);
      }
    };
    const client = await Client.create(xmtpSigner, { env: xmtpEnv });
    setXmtp(client);
    console.log('[app] XMTP client created', { env: xmtpEnv });
  }

  async function handleDeploy() {
    console.log('[app] handleDeploy clicked', { signer: !!signer, xmtp: !!xmtp });
    if (!signer) return;
    if (!ethers.isAddress(tokenAddress)) return alert('Invalid token address');
    if (!ethers.isAddress(protocolFeeRecipient))
      return alert('Invalid protocol fee recipient address');
    const nums = [entryFee, priestVoteWeight, priestWeightThreshold];
    if (!nums.every((n) => /^\d+$/.test(n))) return alert('Invalid numeric input');
    try {
      console.log('[app] deploying templ with', { tokenAddress, protocolFeeRecipient, entryFee, priestVoteWeight, priestWeightThreshold });
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
      console.log('[app] deployTempl returned', result);
      setTemplAddress(result.contractAddress);
      setGroup(result.group);
      setGroupId(result.groupId);
    } catch (err) {
      console.error('[app] deploy failed', err);
      alert(err.message);
    }
  }

  async function handlePurchaseAndJoin() {
    if (!signer || !xmtp || !templAddress) return;
    if (!ethers.isAddress(templAddress)) return alert('Invalid contract address');
    try {
      const result = await purchaseAndJoin({
        ethers,
        xmtp,
        signer,
        walletAddress,
        templAddress,
        templArtifact
      });
      console.log('[app] purchaseAndJoin returned', result);
      if (result) {
        setGroup(result.group);
        setGroupId(result.groupId);
      }
    } catch (err) {
      alert(err.message);
    }
  }

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
    return () => {
      cancelled = true;
    };
  }, [group, mutes]);

  // When we know the `groupId`, keep trying to resolve the group locally until found.
  useEffect(() => {
    if (!xmtp || !groupId || group) return;
    let cancelled = false;
    let attempts = 0;
    async function poll() {
      while (!cancelled && attempts < 20 && !group) {
        attempts++;
        console.log('[app] finding group', groupId, 'attempt', attempts);
        try {
          await xmtp.conversations.sync();
        } catch {}
        try {
          const maybe = await xmtp.conversations.getConversationById(groupId);
          if (maybe) {
            console.log('[app] found group by id');
            setGroup(maybe);
            break;
          }
        } catch {}
        try {
          const list = await xmtp.conversations.list();
          const found = list.find((c) => c.id === groupId);
          if (found) {
            console.log('[app] found group by list');
            setGroup(found);
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, [xmtp, groupId, group]);

  useEffect(() => {
    if (!templAddress || !signer) return;
    const provider = signer.provider;
    const contract = watchProposals({
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
    return () => {
      contract.removeAllListeners();
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
      } else if (groupId && templAddress) {
        await sendMessageBackend({ contractAddress: templAddress, content: messageInput });
      } else {
        return;
      }
      setMessageInput('');
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
      const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
      const tx = await contract.muteAddress(muteAddress);
      await tx.wait();
      alert(`Muted ${muteAddress}`);
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
      const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
      const tx = await contract.delegateMute(delegateAddress);
      await tx.wait();
      alert(`Delegated muting power to ${delegateAddress}`);
      setDelegateAddress('');
    } catch (err) {
      alert('Delegate failed: ' + err.message);
    }
  }

  async function handleExecuteProposal(proposalId) {
    if (!templAddress || !signer) return;
    try {
      const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
      const tx = await contract.executeProposal(proposalId);
      await tx.wait();
      alert(`Executed proposal ${proposalId}`);
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
        const config = await contract.getConfig();
        setIsPriest(config.priest?.toLowerCase() === walletAddress.toLowerCase());
      } catch (err) {
        console.error('Error checking priest status:', err);
      }
    }
    checkPriest();
  }, [templAddress, walletAddress, signer]);

  return (
    <div className="App">
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

      {(groupId) && (
        <div className="chat">
          <h2>Group Chat</h2>
          {!group && <p>Connecting to group… syncing messages</p>}
          <div className="messages">
            {messages.map((m, i) => (
              <div key={i}>
                <strong>{m.senderAddress}:</strong> {m.content}
              </div>
            ))}
          </div>
          <input
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
          />
          <button onClick={handleSend} disabled={!group && !groupId}>Send</button>

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
