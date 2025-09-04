import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import templArtifact from '../contracts/TEMPL.json';
import {
  sendMessage,
  proposeVote,
  voteOnProposal,
  executeProposal,
  watchProposals,
} from '../flows.js';

export default function Chat({ walletAddress, signer, xmtp, session, setStatus }) {
  const [group, setGroup] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [proposals, setProposals] = useState([]);
  const [proposalTitle, setProposalTitle] = useState('');
  const [proposalDesc, setProposalDesc] = useState('');
  const [proposalCalldata, setProposalCalldata] = useState('');
  const [stats, setStats] = useState({ burned: 0n, claimable: 0n, treasury: 0n });
  const [paused, setPaused] = useState(false);

  // Load group and messages
  useEffect(() => {
    let cancelled = false;
    let stream;

    async function load() {
      if (!xmtp || !session?.groupId) return;
      try {
        const g = await xmtp.conversations.getConversationById(session.groupId);
        if (cancelled) return;
        setGroup(g);
        const history = await g.messages();
        if (cancelled) return;
        setMessages(
          history.map((m) => ({
            id: m.id,
            senderAddress: m.senderAddress,
            content: m.content,
          }))
        );
        stream = await g.streamMessages();
        (async () => {
          for await (const msg of stream) {
            if (cancelled) break;
            setMessages((prev) => [
              ...prev,
              { id: msg.id, senderAddress: msg.senderAddress, content: msg.content },
            ]);
          }
        })();
        setStatus((s) => [...s, 'Group connected']);
      } catch (err) {
        console.error(err);
      }
    }
    load();
    return () => {
      cancelled = true;
      stream?.return?.();
    };
    }, [xmtp, session, setStatus]);

  // Load on-chain stats and proposals
  useEffect(() => {
    if (!signer || !session?.templAddress) return;
    const provider = signer.provider;
    const contract = new ethers.Contract(session.templAddress, templArtifact.abi, provider);
    let watcher;
    async function fetchStats() {
      const [burned, claimable, treasury, pausedVal] = await Promise.all([
        contract.totalBurned(),
        contract.getClaimablePoolAmount(walletAddress),
        contract.treasuryBalance(),
        contract.paused(),
      ]);
      setStats({ burned, claimable, treasury });
      setPaused(pausedVal);
    }
    fetchStats();
    watcher = watchProposals({
      ethers,
      provider,
      templAddress: session.templAddress,
      templArtifact,
      onProposal: (p) => setProposals(prev => [...prev, p]),
      onVote: (v) => setProposals(prev => prev.map(p => p.id === v.id ? { ...p, [v.support ? 'yes' : 'no']: (p[v.support ? 'yes' : 'no'] || 0) + 1 } : p))
    });
    return () => {
      watcher?.removeAllListeners?.();
    };
  }, [signer, session, walletAddress]);

  async function handleSend() {
    if (!messageInput) return;
    try {
      await sendMessage({ group, groupId: session.groupId, message: messageInput, xmtp });
      setMessageInput('');
    } catch (err) {
      console.error(err);
    }
  }

  async function handlePropose() {
    try {
      await proposeVote({
        ethers,
        signer,
        templAddress: session.templAddress,
        templArtifact,
        title: proposalTitle,
        description: proposalDesc,
        callData: proposalCalldata,
      });
      setProposalTitle('');
      setProposalDesc('');
      setProposalCalldata('');
    } catch (err) {
      console.error(err);
    }
  }

  async function handleVote(id, support) {
    try {
      await voteOnProposal({
        ethers,
        signer,
        templAddress: session.templAddress,
        templArtifact,
        proposalId: id,
        support,
      });
    } catch (err) {
      console.error(err);
    }
  }

  async function handleExecute(id) {
    try {
      await executeProposal({
        ethers,
        signer,
        templAddress: session.templAddress,
        templArtifact,
        proposalId: id,
      });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div>
      <h2>{session?.name || session?.templAddress}</h2>
      <div>Burned: {stats.burned.toString()} | Claimable: {stats.claimable.toString()} | Treasury: {stats.treasury.toString()}</div>
      <p>DAO Status: {paused ? 'Paused' : 'Active'}</p>
      <div className="messages">
        {messages.map((m) => (
          <div key={m.id}>
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
      <button data-testid="chat-send" onClick={handleSend} disabled={!group && !session?.groupId}>Send</button>
      <div className="proposal-form">
        <h3>New Proposal</h3>
        <input placeholder="Title" value={proposalTitle} onChange={(e) => setProposalTitle(e.target.value)} />
        <input placeholder="Description" value={proposalDesc} onChange={(e) => setProposalDesc(e.target.value)} />
        <input placeholder="Call data" value={proposalCalldata} onChange={(e) => setProposalCalldata(e.target.value)} />
        <button onClick={handlePropose}>Propose</button>
      </div>
      <div className="proposals">
        <h3>Proposals</h3>
        {proposals.map(p => (
          <div key={p.id} className="proposal">
            <p>{p.title} — yes {p.yes || 0} / no {p.no || 0}</p>
            <button onClick={() => handleVote(p.id, true)}>Yes</button>
            <button onClick={() => handleVote(p.id, false)}>No</button>
            <button onClick={() => handleExecute(p.id)}>Execute</button>
          </div>
        ))}
      </div>
    </div>
  );
}
