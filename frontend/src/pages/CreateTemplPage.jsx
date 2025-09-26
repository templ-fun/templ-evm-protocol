import { useState } from 'react';
import templArtifact from '../contracts/TEMPL.json';
import templFactoryArtifact from '../contracts/TemplFactory.json';
import { FACTORY_CONFIG } from '../config.js';
import { deployTempl } from '../services/deployment.js';
import { button, form, layout, surface, text } from '../ui/theme.js';

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
    <div className={layout.page}>
      <header className={layout.header}>
        <h1 className="text-3xl font-semibold tracking-tight">Create a Templ</h1>
      </header>
      <form className={`${layout.card} flex flex-col gap-4`} onSubmit={handleSubmit}>
        <label className={form.label}>
          Factory address
          <input
            type="text"
            className={form.input}
            value={factoryAddress}
            onChange={(e) => setFactoryAddress(e.target.value.trim())}
            required
          />
        </label>
        <label className={form.label}>
          Access token address
          <input
            type="text"
            className={form.input}
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value.trim())}
            placeholder="0x…"
            required
          />
        </label>
        <label className={form.label}>
          Entry fee (wei)
          <input
            type="text"
            className={form.input}
            value={entryFee}
            onChange={(e) => setEntryFee(e.target.value.trim())}
            required
          />
        </label>
        <div className={layout.grid}>
          <label className={form.label}>
            Burn %
            <input
              type="number"
              min="0"
              max="100"
              className={form.input}
              value={burnPercent}
              onChange={(e) => setBurnPercent(e.target.value)}
            />
          </label>
          <label className={form.label}>
            Treasury %
            <input
              type="number"
              min="0"
              max="100"
              className={form.input}
              value={treasuryPercent}
              onChange={(e) => setTreasuryPercent(e.target.value)}
            />
          </label>
          <label className={form.label}>
            Member pool %
            <input
              type="number"
              min="0"
              max="100"
              className={form.input}
              value={memberPercent}
              onChange={(e) => setMemberPercent(e.target.value)}
            />
          </label>
          <label className={form.label}>
            Protocol %
            <input
              type="number"
              min="0"
              max="100"
              className={form.input}
              value={protocolPercent}
              onChange={(e) => setProtocolPercent(e.target.value)}
            />
          </label>
        </div>
        <label className={form.label}>
          Max members (0 = unlimited)
          <input
            type="text"
            className={form.input}
            value={maxMembers}
            onChange={(e) => setMaxMembers(e.target.value.trim())}
          />
        </label>
        <label className={form.checkbox}>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
            checked={dictatorship}
            onChange={(e) => setDictatorship(e.target.checked)}
          />
          Priest starts with dictatorship powers
        </label>
        <label className={form.label}>
          Telegram chat id
          <input
            type="text"
            className={form.input}
            value={telegramChatId}
            onChange={(e) => setTelegramChatId(e.target.value)}
            placeholder="e.g. -100123456"
          />
        </label>
        <label className={form.label}>
          Templ home link
          <input
            type="text"
            className={form.input}
            value={homeLink}
            onChange={(e) => setHomeLink(e.target.value)}
            placeholder="https://t.me/your-group"
          />
        </label>
        <button type="submit" className={button.primary} disabled={submitting}>
          {submitting ? 'Deploying…' : 'Deploy templ'}
        </button>
      </form>
      {bindingInfo && (
        <section className={layout.card}>
          <h2 className="text-xl font-semibold text-slate-900">Connect Telegram notifications</h2>
          <div className="mt-4 space-y-4 text-sm text-slate-700">
            {bindingInfo.telegramChatId ? (
              <p>
                Telegram chat <code className={`${text.mono} text-xs`}>{bindingInfo.telegramChatId}</code> is already linked. Invite{' '}
                <a className="text-primary underline" href="https://t.me/templfunbot" target="_blank" rel="noreferrer">@templfunbot</a> if it is not in the group yet.
              </p>
            ) : (
              <>
                <p>
                  Invite{' '}
                  <a className="text-primary underline" href="https://t.me/templfunbot" target="_blank" rel="noreferrer">@templfunbot</a>{' '}
                  to your Telegram group and send the following message inside the group to confirm ownership.
                </p>
                <pre className={surface.codeBlock}><code>{`templ ${bindingInfo.bindingCode}`}</code></pre>
                <p>
                  The bot will acknowledge the binding and start relaying contract events for{' '}
                  <code className={`${text.mono} text-xs`}>{bindingInfo.templAddress}</code>.
                </p>
              </>
            )}
            {bindingInfo.templHomeLink && (
              <p>
                Current templ home link:{' '}
                <a className="text-primary underline" href={bindingInfo.templHomeLink} target="_blank" rel="noreferrer">{bindingInfo.templHomeLink}</a>
              </p>
            )}
          </div>
          <div className={`${layout.cardActions} mt-6`}>
            <button type="button" className={button.base} onClick={refreshTempls}>
              Refresh templ list
            </button>
            <button
              type="button"
              className={button.primary}
              onClick={() => onNavigate?.(`/templs/${bindingInfo.templAddress}`)}
            >
              Open templ overview
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
