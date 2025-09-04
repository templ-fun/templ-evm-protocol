import { useState } from 'react';
import { ethers } from 'ethers';
import templArtifact from '../contracts/TEMPL.json';
import { deployTempl } from '../flows.js';

export default function CreateTempl({ walletAddress, signer, xmtp, onCreated, setStatus }) {
  const [tokenAddress, setTokenAddress] = useState('');
  const [protocolFeeRecipient, setProtocolFeeRecipient] = useState(walletAddress || '');
  const [entryFee, setEntryFee] = useState('');
  const [deployInfo, setDeployInfo] = useState(null);

  async function handleCreate() {
    if (!signer || !walletAddress) return;
    try {
      const res = await deployTempl({
        ethers,
        xmtp,
        signer,
        walletAddress,
        tokenAddress,
        protocolFeeRecipient,
        entryFee,
        templArtifact,
      });
      setDeployInfo(res);
      setStatus((s) => [...s, 'Templ deployed']);
      onCreated({ templAddress: res.contractAddress, groupId: res.groupId });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div>
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
      <button onClick={handleCreate}>Deploy</button>
      {deployInfo && (
        <div className="deploy-info">
          Contract: {deployInfo.contractAddress}
          <br />
          Group ID: {deployInfo.groupId}
        </div>
      )}
    </div>
  );
}
