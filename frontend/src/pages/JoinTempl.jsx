import { useState } from 'react';
import { ethers } from 'ethers';
import templArtifact from '../contracts/TEMPL.json';
import { purchaseAndJoin } from '../flows.js';

export default function JoinTempl({ walletAddress, signer, xmtp, onJoined, setStatus }) {
  const [templAddress, setTemplAddress] = useState('');

  async function handleJoin() {
    if (!signer || !walletAddress) return;
    try {
      const res = await purchaseAndJoin({
        ethers,
        xmtp,
        signer,
        walletAddress,
        templAddress,
        templArtifact,
      });
      setStatus((s) => [...s, 'Joined templ']);
      onJoined({ templAddress, groupId: res.groupId });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div>
      <h2>Join Templ</h2>
      <input
        placeholder="Contract address"
        value={templAddress}
        onChange={(e) => setTemplAddress(e.target.value)}
      />
      <button onClick={handleJoin}>Purchase & Join</button>
    </div>
  );
}
