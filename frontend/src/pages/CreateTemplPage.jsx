import { useState } from 'react';
import templArtifact from '../contracts/TEMPL.json';
import templFactoryArtifact from '../contracts/TemplFactory.json';
import { FACTORY_CONFIG } from '../config.js';
import { deployTempl } from '../services/deployment.js';

const DEFAULT_PERCENT = 30;

export function CreateTemplPage({
  ethers,
  signer,
  walletAddress,
  onConnectWallet,
  pushMessage,
  onNavigate,
  refreshTempls
}) {
  const [tokenAddress, setTokenAddress] = useState('');
  const [entryFee, setEntryFee] = useState('0');
  const [burnPercent, setBurnPercent] = useState(String(DEFAULT_PERCENT));
  const [treasuryPercent, setTreasuryPercent] = useState(String(DEFAULT_PERCENT));
  const [memberPercent, setMemberPercent] = useState(String(DEFAULT_PERCENT));
  const [protocolPercent, setProtocolPercent] = useState(() => {
    const pct = FACTORY_CONFIG.protocolPercent;
    return pct !== undefined ? String(pct) : '10';
  });
  const [maxMembers, setMaxMembers] = useState('0');
  const [dictatorship, setDictatorship] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [factoryAddress, setFactoryAddress] = useState(() => FACTORY_CONFIG.address || '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!signer) {
      onConnectWallet?.();
      return;
    }
    setSubmitting(true);
    pushMessage?.('Deploying templ…');
    try {
      const result = await deployTempl({
        ethers,
        signer,
        walletAddress,
        factoryAddress,
        factoryArtifact: templFactoryArtifact,
        templArtifact,
        tokenAddress,
        entryFee,
        burnPercent,
        treasuryPercent,
        memberPoolPercent: memberPercent,
        protocolPercent,
        maxMembers,
        priestIsDictator: dictatorship,
        telegramChatId: telegramChatId || undefined
      });
      pushMessage?.(`Templ deployed at ${result.templAddress}`);
      refreshTempls?.();
      onNavigate?.(`/templs/${result.templAddress}`);
    } catch (err) {
      pushMessage?.(`Deploy failed: ${err?.message || err}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Create a Templ</h1>
      </header>
      <form className="card form" onSubmit={handleSubmit}>
        <label>
          Factory address
          <input type="text" value={factoryAddress} onChange={(e) => setFactoryAddress(e.target.value.trim())} required />
        </label>
        <label>
          Access token address
          <input type="text" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value.trim())} placeholder="0x…" required />
        </label>
        <label>
          Entry fee (wei)
          <input type="text" value={entryFee} onChange={(e) => setEntryFee(e.target.value.trim())} required />
        </label>
        <div className="grid">
          <label>
            Burn %
            <input type="number" min="0" max="100" value={burnPercent} onChange={(e) => setBurnPercent(e.target.value)} />
          </label>
          <label>
            Treasury %
            <input type="number" min="0" max="100" value={treasuryPercent} onChange={(e) => setTreasuryPercent(e.target.value)} />
          </label>
          <label>
            Member pool %
            <input type="number" min="0" max="100" value={memberPercent} onChange={(e) => setMemberPercent(e.target.value)} />
          </label>
          <label>
            Protocol %
            <input type="number" min="0" max="100" value={protocolPercent} onChange={(e) => setProtocolPercent(e.target.value)} />
          </label>
        </div>
        <label>
          Max members (0 = unlimited)
          <input type="text" value={maxMembers} onChange={(e) => setMaxMembers(e.target.value.trim())} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={dictatorship} onChange={(e) => setDictatorship(e.target.checked)} />
          Priest starts with dictatorship powers
        </label>
        <label>
          Telegram chat id
          <input type="text" value={telegramChatId} onChange={(e) => setTelegramChatId(e.target.value)} placeholder="e.g. -100123456" />
        </label>
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Deploying…' : 'Deploy templ'}
        </button>
      </form>
    </div>
  );
}
