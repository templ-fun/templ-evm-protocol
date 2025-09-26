import { useCallback, useEffect, useMemo, useState } from 'react';
import templArtifact from '../contracts/TEMPL.json';
import { claimMemberRewards, fetchMemberPoolStats } from '../services/membership.js';
import { button, layout, surface, text } from '../ui/theme.js';

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
    <div className={layout.page}>
      <header className={layout.header}>
        <h1 className="text-3xl font-semibold tracking-tight">Claim Member Rewards</h1>
        <span className={surface.pill}>Templ {templAddress}</span>
      </header>
      <section className={layout.card}>
        <h2 className="text-xl font-semibold text-slate-900">Member pool status</h2>
        <dl className="mt-4 grid gap-4">
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pool balance (raw units)</dt>
            <dd className={`${text.mono} text-sm`}>{formatAmount(stats.poolBalance)}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your claimed total (raw units)</dt>
            <dd className={`${text.mono} text-sm`}>{formatAmount(stats.memberClaimed)}</dd>
          </div>
        </dl>
        <div className={`${layout.cardActions} mt-6`}>
          <button type="button" className={button.base} onClick={loadStats} disabled={loading || pending}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className={button.primary} onClick={handleClaim} disabled={pending || loading}>
            {pending ? 'Claiming…' : 'Claim rewards'}
          </button>
        </div>
        {!hasWallet && (
          <p className={`${text.hint} mt-4`}>Connect your wallet to claim rewards.</p>
        )}
      </section>
    </div>
  );
}
