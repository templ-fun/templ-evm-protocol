import { useEffect, useMemo, useState } from 'react';
import { sanitizeLink } from '../../../shared/linkSanitizer.js';
import templArtifact from '../contracts/TEMPL.json';
import templFactoryArtifact from '../contracts/TemplFactory.json';
import { FACTORY_CONFIG } from '../config.js';
import { deployTempl } from '../services/deployment.js';
import { button, form, layout, surface, text } from '../ui/theme.js';

const DEFAULT_PERCENT = 30;
const DEFAULT_QUORUM_PERCENT = 33;

export function CreateTemplPage({
  ethers,
  signer,
  walletAddress,
  onConnectWallet,
  pushMessage,
  onNavigate,
  refreshTempls,
  readProvider
}) {
  const [tokenAddress, setTokenAddress] = useState('');
  const [entryFee, setEntryFee] = useState('100000000000000000');
  const [burnPercent, setBurnPercent] = useState(String(DEFAULT_PERCENT));
  const [treasuryPercent, setTreasuryPercent] = useState(String(DEFAULT_PERCENT));
  const [memberPercent, setMemberPercent] = useState(String(DEFAULT_PERCENT));
  const [quorumPercent, setQuorumPercent] = useState(String(DEFAULT_QUORUM_PERCENT));
  const [protocolPercent, setProtocolPercent] = useState(() => {
    const pct = FACTORY_CONFIG.protocolPercent;
    return pct !== undefined ? String(pct) : '10';
  });
  const [protocolPercentLocked, setProtocolPercentLocked] = useState(() => FACTORY_CONFIG.protocolPercent !== undefined);
  const [maxMembers, setMaxMembers] = useState('0');
  const [dictatorship, setDictatorship] = useState(false);
  const [telegramChatId, setTelegramChatId] = useState('');
  const [homeLink, setHomeLink] = useState('');
  const [factoryAddress, setFactoryAddress] = useState(() => FACTORY_CONFIG.address || '');
  const [submitting, setSubmitting] = useState(false);
  const [bindingInfo, setBindingInfo] = useState(null);
  const [autoBalanceSplit, setAutoBalanceSplit] = useState(true);
  const sanitizedBindingHomeLink = sanitizeLink(bindingInfo?.templHomeLink);
  const bindingStartLink = useMemo(() => {
    if (!bindingInfo?.bindingCode) return null;
    const trimmedCode = String(bindingInfo.bindingCode).trim();
    if (!trimmedCode) return null;
    return `https://t.me/templfunbot?startgroup=${encodeURIComponent(trimmedCode)}`;
  }, [bindingInfo?.bindingCode]);

  const protocolPercentValue = useMemo(() => {
    const parsed = Number(protocolPercent);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    if (parsed > 100) return 100;
    return Math.trunc(parsed);
  }, [protocolPercent]);

  const feeSplitTarget = useMemo(() => {
    const value = 100 - protocolPercentValue;
    return value < 0 ? 0 : value;
  }, [protocolPercentValue]);

  const parsePercentValue = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    if (parsed < 0) return 0;
    if (parsed > 100) return 100;
    return Math.trunc(parsed);
  };

  useEffect(() => {
    if (!autoBalanceSplit) return;
    const burnValue = parsePercentValue(burnPercent);
    const treasuryValue = parsePercentValue(treasuryPercent);
    const remainder = Math.max(0, feeSplitTarget - burnValue - treasuryValue);
    const remainderStr = String(remainder);
    if (memberPercent !== remainderStr) {
      setMemberPercent(remainderStr);
    }
  }, [autoBalanceSplit, burnPercent, treasuryPercent, feeSplitTarget, memberPercent]);

  const handlePercentChange = (field) => (event) => {
    const raw = event.target.value;
    const currentBurn = parsePercentValue(burnPercent);
    const currentTreasury = parsePercentValue(treasuryPercent);
    let numeric = parsePercentValue(raw);
    if (autoBalanceSplit) {
      const other = field === 'burn' ? currentTreasury : currentBurn;
      if (numeric + other > feeSplitTarget) {
        numeric = Math.max(0, feeSplitTarget - other);
      }
    }
    if (field === 'burn') {
      if (burnPercent !== String(numeric)) {
        setBurnPercent(String(numeric));
      }
    } else {
      if (treasuryPercent !== String(numeric)) {
        setTreasuryPercent(String(numeric));
      }
    }
    if (autoBalanceSplit) {
      const nextBurn = field === 'burn' ? numeric : currentBurn;
      const nextTreasury = field === 'treasury' ? numeric : currentTreasury;
      const remainder = Math.max(0, feeSplitTarget - nextBurn - nextTreasury);
      const remainderStr = String(remainder);
      if (memberPercent !== remainderStr) {
        setMemberPercent(remainderStr);
      }
    }
  };

  const handleMemberPercentChange = (event) => {
    if (autoBalanceSplit) return;
    const parsed = parsePercentValue(event.target.value);
    const clamped = parsed > feeSplitTarget ? feeSplitTarget : parsed;
    setMemberPercent(String(clamped));
  };

  useEffect(() => {
    let cancelled = false;
    async function syncProtocolPercent() {
      setProtocolPercentLocked(false);
      if (!ethers) return;
      const addr = factoryAddress?.trim?.() ?? '';
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
        return;
      }
      const provider = readProvider || signer?.provider;
      if (!provider) {
        return;
      }
      try {
        const factory = new ethers.Contract(addr, templFactoryArtifact.abi, provider);
        const raw = await factory.protocolPercent();
        const resolved = Number(raw);
        if (!Number.isFinite(resolved)) {
          return;
        }
        if (!cancelled) {
          setProtocolPercent(String(resolved / 100));
          setProtocolPercentLocked(true);
        }
      } catch (err) {
        if (!cancelled) {
          setProtocolPercentLocked(false);
        }
        console.warn('[templ] Failed to load factory protocol percent', err);
      }
    }
    void syncProtocolPercent();
    return () => {
      cancelled = true;
    };
  }, [factoryAddress, ethers, readProvider, signer?.provider]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!signer) {
      onConnectWallet?.();
      return;
    }

    const trimmedEntryFee = entryFee.trim();
    if (!trimmedEntryFee) {
      pushMessage?.('Entry fee is required');
      return;
    }
    let parsedEntryFee;
    try {
      parsedEntryFee = BigInt(trimmedEntryFee);
    } catch {
      pushMessage?.('Entry fee must be a whole number (wei)');
      return;
    }
    if (parsedEntryFee < 10n) {
      pushMessage?.('Entry fee must be at least 10 wei to satisfy templ requirements');
      return;
    }
    if (parsedEntryFee % 10n !== 0n) {
      pushMessage?.('Entry fee must be divisible by 10 wei');
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
        quorumPercent,
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
              onChange={handlePercentChange('burn')}
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
              onChange={handlePercentChange('treasury')}
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
              onChange={handleMemberPercentChange}
              disabled={autoBalanceSplit}
            />
            {autoBalanceSplit ? (
              <span className={text.hint}>
                Auto-balanced to allocate the remaining {feeSplitTarget}% after burn and treasury splits.
              </span>
            ) : null}
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
              disabled={protocolPercentLocked}
            />
            {protocolPercentLocked ? (
              <span className={text.hint}>Locked to factory protocol fee</span>
            ) : null}
          </label>
          <label className={form.label}>
            Quorum %
            <input
              type="number"
              min="1"
              max="100"
              className={form.input}
              value={quorumPercent}
              onChange={(e) => setQuorumPercent(e.target.value)}
            />
            <span className={text.hint}>Percentage of eligible voters required to pass proposals</span>
          </label>
        </div>
        <label className={form.checkbox}>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
            checked={autoBalanceSplit}
            onChange={(event) => setAutoBalanceSplit(event.target.checked)}
          />
          Auto-balance fee splits
        </label>
        <p className={text.hint}>
          Protocol receives {protocolPercentValue}% by default, leaving {feeSplitTarget}% to divide between burn, treasury, and
          member rewards.
        </p>
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
                  to your Telegram group. After it joins, either tap the start link or send the highlighted command—both approaches let the bot read the binding code without requesting admin rights.
                </p>
                <div className="space-y-3">
                  <a
                    className="inline-flex items-center gap-2 rounded border border-primary px-3 py-2 text-primary hover:bg-primary/10"
                    href={bindingStartLink || undefined}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Use start link in Telegram
                  </a>
                  <div>
                    <p className="mb-1">Or post this command in the group:</p>
                    <pre className={surface.codeBlock}><code>{`/templ ${bindingInfo.bindingCode}`}</code></pre>
                  </div>
                </div>
                <p>
                  The bot will acknowledge the binding and start relaying contract events for{' '}
                  <code className={`${text.mono} text-xs`}>{bindingInfo.templAddress}</code>.
                </p>
              </>
            )}
            {sanitizedBindingHomeLink.text ? (
              <p>
                Current templ home link:{' '}
                {sanitizedBindingHomeLink.href ? (
                  <a className="text-primary underline" href={sanitizedBindingHomeLink.href} target="_blank" rel="noreferrer">
                    {sanitizedBindingHomeLink.text}
                  </a>
                ) : (
                  sanitizedBindingHomeLink.text
                )}
              </p>
            ) : null}
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
