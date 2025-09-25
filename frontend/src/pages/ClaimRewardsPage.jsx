import { useCallback, useEffect, useMemo, useState } from 'react';
import templArtifact from '../contracts/TEMPL.json';
import { claimMemberRewards, fetchMemberPoolStats } from '../services/membership.js';

function formatAmount(value) {
  if (value === null || value === undefined) return '0';
  try {
    return BigInt(value).toString();
  } catch {
    return String(value);
  }
}

export function ClaimRewardsPage({
  ethers,
  signer,
  walletAddress,
  templAddress,
  onConnectWallet,
  pushMessage
}) {
  const [stats, setStats] = useState({ poolBalance: '0', memberClaimed: '0' });
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);

  const hasWallet = useMemo(() => Boolean(walletAddress), [walletAddress]);

  const loadStats = useCallback(async () => {
    if (!templAddress || !ethers || !signer) return;
    setLoading(true);
    try {
      const data = await fetchMemberPoolStats({
        ethers,
        signer,
        templAddress,
        templArtifact,
        memberAddress: walletAddress
      });
      setStats(data);
    } catch (err) {
      pushMessage?.(`Failed to load member pool stats: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  }, [templAddress, ethers, signer, walletAddress, pushMessage]);

  useEffect(() => {
    if (!templAddress || !signer) return;
    void loadStats();
  }, [templAddress, signer, walletAddress, loadStats]);

  const ensureWallet = () => {
    if (!hasWallet || !signer) {
      onConnectWallet?.();
      return false;
    }
    return true;
  };

  const handleClaim = async () => {
    if (!ensureWallet()) return;
    setPending(true);
    pushMessage?.('Claiming member pool rewards…');
    try {
      await claimMemberRewards({
        ethers,
        signer,
        templAddress,
        templArtifact,
        walletAddress
      });
      pushMessage?.('Rewards claimed successfully');
      await loadStats();
    } catch (err) {
      pushMessage?.(`Claim failed: ${err?.message || err}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Claim Member Rewards</h1>
        <span className="pill">Templ {templAddress}</span>
      </header>
      <section className="card">
        <h2>Member pool status</h2>
        <dl className="data-list">
          <div>
            <dt>Pool balance (raw units)</dt>
            <dd>{formatAmount(stats.poolBalance)}</dd>
          </div>
          <div>
            <dt>Your claimed total (raw units)</dt>
            <dd>{formatAmount(stats.memberClaimed)}</dd>
          </div>
        </dl>
        <div className="card-actions">
          <button type="button" onClick={loadStats} disabled={loading || pending}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className="primary" onClick={handleClaim} disabled={pending || loading}>
            {pending ? 'Claiming…' : 'Claim rewards'}
          </button>
        </div>
        {!hasWallet && (
          <p className="hint">Connect your wallet to claim rewards.</p>
        )}
      </section>
    </div>
  );
}
