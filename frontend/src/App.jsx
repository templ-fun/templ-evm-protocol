import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Client } from '@xmtp/xmtp-js';
import templArtifact from './contracts/TEMPL.json';
import {
  deployTempl,
  purchaseAndJoin,
  sendMessage,
  proposeVote,
  voteOnProposal,
  watchProposals
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

  // deployment form
  const [tokenAddress, setTokenAddress] = useState('');
  const [protocolFeeRecipient, setProtocolFeeRecipient] = useState('');
  const [entryFee, setEntryFee] = useState('');
  const [priestVoteWeight, setPriestVoteWeight] = useState('1');
  const [priestWeightThreshold, setPriestWeightThreshold] = useState('1');

  // joining form
  const [templAddress, setTemplAddress] = useState('');
  const [groupId, setGroupId] = useState('');

  async function connectWallet() {
    if (!window.ethereum) return;
    const provider = new ethers.BrowserProvider(window.ethereum);
    await provider.send('eth_requestAccounts', []);
    const signer = await provider.getSigner();
    setSigner(signer);
    setWalletAddress(await signer.getAddress());
    const client = await Client.create(signer, { env: 'production' });
    setXmtp(client);
  }

  async function handleDeploy() {
    if (!signer || !xmtp) return;
    if (!ethers.isAddress(tokenAddress)) return alert('Invalid token address');
    if (!ethers.isAddress(protocolFeeRecipient))
      return alert('Invalid protocol fee recipient address');
    const nums = [entryFee, priestVoteWeight, priestWeightThreshold];
    if (!nums.every((n) => /^\d+$/.test(n))) return alert('Invalid numeric input');
    try {
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
      setTemplAddress(result.contractAddress);
      setGroup(result.group);
      setGroupId(result.groupId);
    } catch (err) {
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
        setMessages((m) => [...m, msg]);
      }
    };
    stream();
    return () => {
      cancelled = true;
    };
  }, [group]);

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

  async function handleSend() {
    if (!group || !messageInput) return;
    await sendMessage({ group, content: messageInput });
    setMessageInput('');
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
              placeholder="Priest vote weight"
              value={priestVoteWeight}
              onChange={(e) => setPriestVoteWeight(e.target.value)}
            />
            <input
              placeholder="Priest weight threshold"
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

      {group && (
        <div className="chat">
          <h2>Group Chat</h2>
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
          <button onClick={handleSend}>Send</button>

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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
