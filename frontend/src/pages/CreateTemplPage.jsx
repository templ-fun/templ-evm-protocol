import { useCallback, useEffect, useMemo, useState } from 'react';
import { sanitizeLink } from '../../../shared/linkSanitizer.js';
import templArtifact from '../contracts/TEMPL.json';
import templFactoryArtifact from '../contracts/TemplFactory.json';
import { FACTORY_CONFIG } from '../config.js';
import { BASE_TOKEN_SUGGESTIONS } from '../data/baseTokens.js';
import { deployTempl, requestTemplRebindBackend } from '../services/deployment.js';
import { button, form, layout, surface, text } from '../ui/theme.js';

const DEFAULT_PERCENT = 30;
const DEFAULT_QUORUM_PERCENT = 33;
const ERC20_DECIMALS_ABI = ['function decimals() view returns (uint8)'];

const MIN_ENTRY_FEE = 10n;
const ENTRY_FEE_STEP = 10n;
const HEX_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

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
  const [entryFeeTokens, setEntryFeeTokens] = useState('1');
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
  const [homeLink, setHomeLink] = useState('');
  const [factoryAddress, setFactoryAddress] = useState(() => FACTORY_CONFIG.address || '');
  const [submitting, setSubmitting] = useState(false);
  const [bindingInfo, setBindingInfo] = useState(null);
  const [registeringBinding, setRegisteringBinding] = useState(false);
  const [autoBalanceSplit, setAutoBalanceSplit] = useState(true);
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [tokenDecimalsSource, setTokenDecimalsSource] = useState('default');
  const [tokenDecimalsError, setTokenDecimalsError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTokenSuggestions, setShowTokenSuggestions] = useState(false);
  const sanitizedBindingHomeLink = sanitizeLink(bindingInfo?.templHomeLink);
  const bindingStartLink = useMemo(() => {
    if (!bindingInfo?.bindingCode) return null;
    const trimmedCode = String(bindingInfo.bindingCode).trim();
    if (!trimmedCode) return null;
    return `https://t.me/templfunbot?startgroup=${encodeURIComponent(trimmedCode)}`;
  }, [bindingInfo?.bindingCode]);

  const resolvedTokenDecimals = useMemo(() => (Number.isInteger(tokenDecimals) ? tokenDecimals : 18), [tokenDecimals]);
  const tokenDecimalsHint = useMemo(() => {
    if (tokenDecimalsSource === 'chain') {
      return `Using ${resolvedTokenDecimals} decimals detected from the token contract.`;
    }
    if (tokenDecimalsSource === 'catalog') {
      return `Using ${resolvedTokenDecimals} decimals from Base catalog data.`;
    }
    if (tokenDecimalsSource === 'fallback') {
      return tokenDecimalsError || `Using ${resolvedTokenDecimals} decimals because token metadata is unavailable.`;
    }
    return `Assuming ${resolvedTokenDecimals} decimals until a token address is detected.`;
  }, [resolvedTokenDecimals, tokenDecimalsError, tokenDecimalsSource]);

  const entryFeePreview = useMemo(() => {
    const trimmed = entryFeeTokens.trim();
    if (!trimmed || !ethers) {
      return '';
    }
    try {
      const raw = ethers.parseUnits(trimmed, resolvedTokenDecimals);
      const remainder = raw % ENTRY_FEE_STEP;
      const rounded = remainder === 0n ? raw : raw + (ENTRY_FEE_STEP - remainder);
      const baseUnits = rounded.toString();
      const roundedDisplay = ethers.formatUnits(rounded, resolvedTokenDecimals);
      if (remainder === 0n) {
        return `On-chain amount: ${baseUnits} (${roundedDisplay} tokens).`;
      }
      return `On-chain amount rounds to ${baseUnits} (${roundedDisplay} tokens) to satisfy 10-wei steps.`;
    } catch {
      return 'Entry fee must be a valid number.';
    }
  }, [entryFeeTokens, ethers, resolvedTokenDecimals]);

  const handleSelectTokenSuggestion = useCallback((token) => {
    if (!token?.address) return;
    setTokenAddress(token.address);
    setShowTokenSuggestions(false);
    if (typeof token.decimals === 'number' && Number.isInteger(token.decimals)) {
      setTokenDecimals(token.decimals);
      setTokenDecimalsSource('catalog');
      setTokenDecimalsError('');
    }
  }, []);
  const trimmedFactoryAddress = factoryAddress?.trim?.() ?? '';
  const showFactoryInput = showAdvanced || !FACTORY_CONFIG.address;

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

  const handleGenerateBindingCode = useCallback(async () => {
    if (!signer) {
      onConnectWallet?.();
      return;
    }
    if (!bindingInfo?.templAddress) {
      pushMessage?.('Deploy a templ before generating a binding code.');
      return;
    }
    const templAddress = bindingInfo.templAddress;
    const templLink = bindingInfo.templHomeLink || homeLink || '';
    setRegisteringBinding(true);
    pushMessage?.('Generating Telegram binding code…');
    try {
      const rebind = await requestTemplRebindBackend({
        signer,
        walletAddress,
        templAddress
      });
      setBindingInfo((prev) => {
        const base = prev ?? {
          templAddress,
          templHomeLink: templLink,
          priest: walletAddress
        };
        return {
          templAddress: base.templAddress,
          bindingCode: rebind?.bindingCode || null,
          telegramChatId: rebind?.telegramChatId || null,
          templHomeLink: base.templHomeLink || '',
          priest: rebind?.priest || base.priest || walletAddress
        };
      });
      refreshTempls?.();
      pushMessage?.('Binding code ready. Invite the bot to your group to finish setup.');
    } catch (err) {
      const message = String(err?.message || err || '');
      if (message.includes('404') || message.toLowerCase().includes('not registered')) {
        pushMessage?.('Templ is still syncing with the backend. Wait a few seconds and try again.');
      } else {
        pushMessage?.(`Telegram binding failed: ${message}`);
      }
    } finally {
      setRegisteringBinding(false);
    }
  }, [bindingInfo, homeLink, onConnectWallet, pushMessage, refreshTempls, signer, walletAddress]);

  useEffect(() => {
    let cancelled = false;
    async function syncProtocolPercent() {
      setProtocolPercentLocked(false);
      if (!ethers) return;
      const addr = factoryAddress?.trim?.() ?? '';
      if (!HEX_ADDRESS_REGEX.test(addr)) {
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

  useEffect(() => {
    let cancelled = false;
    async function loadTokenMetadata() {
      setTokenDecimalsError('');
      if (!ethers) return;
      const trimmed = tokenAddress?.trim?.() ?? '';
      if (!HEX_ADDRESS_REGEX.test(trimmed)) {
        setTokenDecimals(18);
        setTokenDecimalsSource('default');
        return;
      }
      const provider = readProvider || signer?.provider;
      if (!provider) {
        return;
      }
      try {
        const tokenContract = new ethers.Contract(trimmed, ERC20_DECIMALS_ABI, provider);
        const raw = await tokenContract.decimals();
        const parsed = Number(raw);
        if (cancelled) return;
        if (Number.isFinite(parsed)) {
          setTokenDecimals(parsed);
          setTokenDecimalsSource('chain');
        }
      } catch (err) {
        if (cancelled) return;
        console.warn('[templ] Failed to load token decimals', err);
        setTokenDecimals(18);
        setTokenDecimalsSource('fallback');
        setTokenDecimalsError('Using 18 decimals because reading the token metadata failed.');
      }
    }
    void loadTokenMetadata();
    return () => {
      cancelled = true;
    };
  }, [ethers, readProvider, signer?.provider, tokenAddress]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!signer) {
      onConnectWallet?.();
      return;
    }
    const trimmedFactory = factoryAddress?.trim?.() ?? '';
    if (!HEX_ADDRESS_REGEX.test(trimmedFactory)) {
      pushMessage?.('Factory address must be a valid contract address.');
      return;
    }
    const trimmedToken = tokenAddress?.trim?.() ?? '';
    if (!HEX_ADDRESS_REGEX.test(trimmedToken)) {
      pushMessage?.('Access token address must be a valid contract address.');
      return;
    }

    const decimals = resolvedTokenDecimals;
    let parsedEntryFee;
    try {
      parsedEntryFee = ethers.parseUnits(entryFeeTokens.trim() || '0', decimals);
    } catch {
      pushMessage?.('Entry fee must be a numeric value.');
      return;
    }
    if (parsedEntryFee < MIN_ENTRY_FEE) {
      pushMessage?.('Entry fee must be at least 10 wei to satisfy templ requirements');
      return;
    }
    const remainder = parsedEntryFee % ENTRY_FEE_STEP;
    if (remainder !== 0n) {
      const adjusted = parsedEntryFee + (ENTRY_FEE_STEP - remainder);
      parsedEntryFee = adjusted;
      if (pushMessage) {
        pushMessage('Entry fee rounded up to the nearest valid amount for templ.');
      }
      try {
        const adjustedDisplay = ethers.formatUnits(parsedEntryFee, decimals);
        setEntryFeeTokens(adjustedDisplay);
      } catch (formatErr) {
        console.warn('[templ] Failed to format adjusted entry fee', formatErr);
      }
    }
    setSubmitting(true);
    pushMessage?.('Deploying templ…');
    try {
      const { templAddress, registration } = await deployTempl({
        ethers,
        signer,
        walletAddress,
        factoryAddress: trimmedFactory,
        factoryArtifact: templFactoryArtifact,
        templArtifact,
        tokenAddress: trimmedToken,
        entryFee: parsedEntryFee.toString(),
        burnPercent,
        treasuryPercent,
        memberPoolPercent: memberPercent,
        protocolPercent,
        quorumPercent,
        maxMembers,
        priestIsDictator: dictatorship,
        templHomeLink: homeLink || undefined
      });
      pushMessage?.(`Templ deployed at ${templAddress}`);
      if (!registration) {
        pushMessage?.('Templ registered. Telegram binding becomes available once the backend finishes syncing.');
      }
      setBindingInfo({
        templAddress,
        bindingCode: registration?.bindingCode || null,
        telegramChatId: registration?.telegramChatId || null,
        templHomeLink: registration?.templHomeLink || homeLink || '',
        priest: registration?.priest || walletAddress
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
      <form className={`${layout.card} flex flex-col gap-5`} onSubmit={handleSubmit}>
        {showFactoryInput ? (
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
        ) : (
          <p className={text.hint}>
            Using factory <code className={`${text.mono} text-xs`}>{trimmedFactoryAddress || '—'}</code>. Open Advanced mode to
            change it.
          </p>
        )}
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
        <div className="flex flex-col gap-3">
          <button
            type="button"
            className={button.base}
            onClick={() => setShowTokenSuggestions((prev) => !prev)}
          >
            {showTokenSuggestions ? 'Hide Base token catalog' : 'Browse Base token catalog'}
          </button>
          {showTokenSuggestions ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {BASE_TOKEN_SUGGESTIONS.map((token) => (
                <button
                  key={token.address}
                  type="button"
                  className="flex w-full flex-col items-start gap-1 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-900 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  onClick={() => handleSelectTokenSuggestion(token)}
                >
                  <span className="text-sm font-semibold text-slate-900">{token.symbol}</span>
                  <span className="text-xs text-slate-600">{token.name}</span>
                  <span className={`${text.mono} text-xs text-slate-500`}>{token.address}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <label className={form.label}>
          Entry fee (token amount)
          <input
            type="text"
            className={form.input}
            value={entryFeeTokens}
            onChange={(e) => setEntryFeeTokens(e.target.value)}
            placeholder="e.g. 1.5"
            required
          />
        </label>
        <div className="flex flex-col gap-1">
          {entryFeePreview ? <span className={text.hint}>{entryFeePreview}</span> : null}
          <span className={text.hint}>{tokenDecimalsHint}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className={button.base}
            onClick={() => setShowAdvanced((prev) => !prev)}
          >
            {showAdvanced ? 'Hide advanced' : 'Advanced mode'}
          </button>
        </div>
        {showAdvanced ? (
          <div className="flex flex-col gap-4">
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
                {protocolPercentLocked ? <span className={text.hint}>Locked to factory protocol fee</span> : null}
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
              Protocol receives {protocolPercentValue}% by default, leaving {feeSplitTarget}% to divide between burn, treasury,
              and member rewards.
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
              Templ home link
              <input
                type="text"
                className={form.input}
                value={homeLink}
                onChange={(e) => setHomeLink(e.target.value)}
                placeholder="https://t.me/your-group"
              />
            </label>
            <p className={text.hint}>
              Optional, but helps members discover your public group from templ.fun once the templ is live.
            </p>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <h3 className="text-sm font-semibold text-slate-900">Fee curve defaults</h3>
              <p>
                Templs launch with an <strong>exponential</strong> join fee that scales by <strong>10% for every existing
                member</strong>. Once governance is active you can propose a <em>Set fee curve</em> update (or toggle
                dictatorship and call it directly) to adopt a different growth model.
              </p>
              <p className="mt-2 text-xs text-slate-600">
                Communities that prefer a flat or linear ramp can switch after deployment without redeploying the contract.
              </p>
            </div>
          </div>
        ) : null}
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
            ) : bindingInfo.bindingCode ? (
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
            ) : (
              <>
                <p>
                  Generate a binding code when you are ready to connect Telegram notifications. This step asks for a wallet
                  signature so the bot can verify you control the templ priest address.
                </p>
                <p className={text.hint}>
                  New templs appear in the backend automatically shortly after deployment. If the request fails, wait a few
                  seconds and try again.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    className={button.primary}
                    onClick={handleGenerateBindingCode}
                    disabled={registeringBinding}
                  >
                    {registeringBinding ? 'Requesting signature…' : 'Generate binding code'}
                  </button>
                  <button type="button" className={button.base} onClick={refreshTempls}>
                    Refresh templ list
                  </button>
                </div>
                <p className={text.hint}>You can also trigger this later from the templ overview page.</p>
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
            {bindingInfo.bindingCode || bindingInfo.telegramChatId ? (
              <button type="button" className={button.base} onClick={refreshTempls}>
                Refresh templ list
              </button>
            ) : null}
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
