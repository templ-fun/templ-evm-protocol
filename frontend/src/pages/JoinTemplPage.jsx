import { useEffect, useMemo, useState } from 'react';
import templArtifact from '../contracts/TEMPL.json';
import { purchaseAccess, verifyMembership } from '../services/membership.js';

export function JoinTemplPage({
  ethers,
  signer,
  walletAddress,
  onConnectWallet,
  pushMessage,
  query
}) {
  const [templAddress, setTemplAddress] = useState('');
  const [pending, setPending] = useState(false);
  const [verification, setVerification] = useState(null);

  useEffect(() => {
    const fromQuery = query.get('address');
    if (fromQuery) {
      setTemplAddress(fromQuery);
    }
  }, [query]);

  const hasWallet = useMemo(() => Boolean(walletAddress), [walletAddress]);

  const ensureWallet = () => {
    if (!hasWallet) {
      onConnectWallet?.();
      return false;
    }
    return true;
  };

  const handlePurchase = async () => {
    if (!ensureWallet()) return;
    setPending(true);
    pushMessage?.('Purchasing access…');
    try {
      const result = await purchaseAccess({
        ethers,
        signer,
        templAddress,
        templArtifact,
        walletAddress
      });
      pushMessage?.(result.purchased ? 'Access purchase complete' : 'You already have access');
    } catch (err) {
      pushMessage?.(`Purchase failed: ${err?.message || err}`);
    } finally {
      setPending(false);
    }
  };

  const handleVerify = async () => {
    if (!ensureWallet()) return;
    setPending(true);
    pushMessage?.('Verifying membership…');
    try {
      const data = await verifyMembership({
        signer,
        templAddress,
        walletAddress
      });
      setVerification(data);
      pushMessage?.('Membership verified');
    } catch (err) {
      pushMessage?.(`Verification failed: ${err?.message || err}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Join a Templ</h1>
      </header>
      <section className="card form">
        <label>
          Templ address
          <input type="text" value={templAddress} onChange={(e) => setTemplAddress(e.target.value.trim())} placeholder="0x…" />
        </label>
        <div className="card-actions">
          <button type="button" onClick={handlePurchase} disabled={pending || !templAddress}>Purchase Access</button>
          <button type="button" className="primary" onClick={handleVerify} disabled={pending || !templAddress}>Verify Membership</button>
        </div>
      </section>
      {verification && (
        <section className="card">
          <h2>Membership Details</h2>
          <dl className="data-list">
            <div>
              <dt>Member address</dt>
              <dd>{verification.member?.address || 'Unknown'}</dd>
            </div>
            <div>
              <dt>Priest</dt>
              <dd>{verification.templ?.priest || 'Unknown'}</dd>
            </div>
            <div>
              <dt>Telegram chat id</dt>
              <dd>{verification.templ?.telegramChatId || '—'}</dd>
            </div>
            <div>
              <dt>Home link</dt>
              <dd>
                {verification.templ?.templHomeLink ? (
                  <a href={verification.templ.templHomeLink} target="_blank" rel="noreferrer">{verification.templ.templHomeLink}</a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
          {verification.links && (
            <ul className="link-list">
              {Object.entries(verification.links).map(([key, value]) => (
                <li key={key}><a href={value} target="_blank" rel="noreferrer">{key}</a></li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
