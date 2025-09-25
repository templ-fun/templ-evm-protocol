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
  const [homeLink, setHomeLink] = useState('');
  const [factoryAddress, setFactoryAddress] = useState(() => FACTORY_CONFIG.address || '');
  const [submitting, setSubmitting] = useState(false);
  const [bindingInfo, setBindingInfo] = useState(null);

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
        telegramChatId: telegramChatId || undefined,
        templHomeLink: homeLink || undefined
      });
      pushMessage?.(`Templ deployed at ${result.templAddress}`);
      setBindingInfo({
        templAddress: result.templAddress,
        bindingCode: result.registration?.bindingCode || null,
        telegramChatId: result.registration?.templ?.telegramChatId || telegramChatId || null,
        templHomeLink: result.registration?.templ?.templHomeLink || homeLink || '',
        priest: result.registration?.templ?.priest || walletAddress
      });
      refreshTempls?.();
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
        <label>
          Templ home link
          <input type="text" value={homeLink} onChange={(e) => setHomeLink(e.target.value)} placeholder="https://t.me/your-group" />
        </label>
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Deploying…' : 'Deploy templ'}
        </button>
      </form>
      {bindingInfo && (
        <section className="card">
          <h2>Connect Telegram notifications</h2>
          {bindingInfo.telegramChatId ? (
            <p>
              Telegram chat <code>{bindingInfo.telegramChatId}</code> is already linked. Invite <a href="https://t.me/templfunbot" target="_blank" rel="noreferrer">@templfunbot</a> if it is not in the group yet.
            </p>
          ) : (
            <>
              <p>
                Invite <a href="https://t.me/templfunbot" target="_blank" rel="noreferrer">@templfunbot</a> to your Telegram group and send the following message inside the group to confirm ownership.
              </p>
              <pre className="binding-code"><code>{`templ ${bindingInfo.bindingCode}`}</code></pre>
              <p>
                The bot will acknowledge the binding and start relaying contract events for <code>{bindingInfo.templAddress}</code>.
              </p>
            </>
          )}
          {bindingInfo.templHomeLink && (
            <p>
              Current templ home link: <a href={bindingInfo.templHomeLink} target="_blank" rel="noreferrer">{bindingInfo.templHomeLink}</a>
            </p>
          )}
          <div className="card-actions">
            <button type="button" onClick={refreshTempls}>Refresh templ list</button>
            <button type="button" className="primary" onClick={() => onNavigate?.(`/templs/${bindingInfo.templAddress}`)}>Open templ overview</button>
          </div>
        </section>
      )}
    </div>
  );
}
