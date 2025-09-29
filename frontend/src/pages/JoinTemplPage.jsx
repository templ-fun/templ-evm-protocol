import { useCallback, useEffect, useMemo, useState } from 'react';
import { sanitizeLink } from '../../../shared/linkSanitizer.js';
import templArtifact from '../contracts/TEMPL.json';
import { approveEntryFee, loadEntryRequirements, purchaseAccess, verifyMembership } from '../services/membership.js';
import { button, form, layout, text } from '../ui/theme.js';

export function JoinTemplPage({
  ethers,
  signer,
  walletAddress,
  onConnectWallet,
  pushMessage,
  query,
  templs: knownTempls = [],
  readProvider,
  refreshTempls
}) {
  const [templAddress, setTemplAddress] = useState('');
  const [purchasePending, setPurchasePending] = useState(false);
  const [approvePending, setApprovePending] = useState(false);
  const [verification, setVerification] = useState(null);
  const [entryInfo, setEntryInfo] = useState(null);
  const [loadingEntry, setLoadingEntry] = useState(false);

  useEffect(() => {
    const fromQuery = query.get('address');
    if (fromQuery) {
      setTemplAddress(fromQuery.trim());
    }
  }, [query]);

  useEffect(() => {
    if (templAddress) return;
    if (!Array.isArray(knownTempls) || knownTempls.length !== 1) return;
    const [onlyTempl] = knownTempls;
    if (!onlyTempl?.contract) return;
    setTemplAddress(onlyTempl.contract);
  }, [templAddress, knownTempls]);

  const hasWallet = useMemo(() => Boolean(walletAddress), [walletAddress]);

  const templRecord = useMemo(() => {
    if (!templAddress) return null;
    const target = templAddress.toLowerCase();
    return knownTempls.find((item) => item.contract === target) || null;
  }, [knownTempls, templAddress]);

  const tokenAddress = useMemo(() => {
    if (entryInfo?.tokenAddress) return entryInfo.tokenAddress;
    if (templRecord?.tokenAddress) return templRecord.tokenAddress;
    return null;
  }, [entryInfo, templRecord]);

  const entryFeeWei = useMemo(() => {
    if (entryInfo?.entryFeeWei) return entryInfo.entryFeeWei;
    if (templRecord?.entryFeeRaw) return templRecord.entryFeeRaw;
    return null;
  }, [entryInfo, templRecord]);

  const entryFeeDisplay = useMemo(() => {
    if (entryInfo?.entryFeeFormatted) {
      const suffix = entryInfo.tokenSymbol ? ` ${entryInfo.tokenSymbol}` : '';
      return `${entryInfo.entryFeeFormatted}${suffix}`;
    }
    if (templRecord?.entryFeeFormatted) {
      const suffix = templRecord.tokenSymbol ? ` ${templRecord.tokenSymbol}` : '';
      return `${templRecord.entryFeeFormatted}${suffix}`;
    }
    return templRecord?.entryFeeRaw || entryInfo?.entryFeeWei || '—';
  }, [entryInfo, templRecord]);

  const allowanceSatisfied = useMemo(() => {
    if (!entryFeeWei) return false;
    if (!entryInfo?.allowanceWei) return false;
    try {
      return BigInt(entryInfo.allowanceWei) >= BigInt(entryFeeWei);
    } catch {
      return false;
    }
  }, [entryInfo?.allowanceWei, entryFeeWei]);

  const allowanceDisplay = useMemo(() => {
    if (!entryInfo?.allowanceFormatted) return null;
    const suffix = entryInfo.tokenSymbol ? ` ${entryInfo.tokenSymbol}` : '';
    return `${entryInfo.allowanceFormatted}${suffix}`;
  }, [entryInfo]);

  const balanceDisplay = useMemo(() => {
    if (!entryInfo?.balanceFormatted) return null;
    const suffix = entryInfo.tokenSymbol ? ` ${entryInfo.tokenSymbol}` : '';
    return `${entryInfo.balanceFormatted}${suffix}`;
  }, [entryInfo]);

  const templSelectValue = useMemo(() => {
    if (!templAddress) return '';
    const lower = templAddress.toLowerCase();
    return knownTempls.some((item) => item.contract === lower) ? lower : '';
  }, [templAddress, knownTempls]);

  const refreshEntryInfo = useCallback(async () => {
    if (!ethers || !templAddress) {
      setEntryInfo(null);
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(templAddress)) {
      setEntryInfo(null);
      return;
    }
    if (!signer && !readProvider) {
      setEntryInfo(null);
      return;
    }
    setLoadingEntry(true);
    try {
      const info = await loadEntryRequirements({
        ethers,
        templAddress,
        templArtifact,
        signer,
        provider: readProvider,
        walletAddress
      });
      setEntryInfo(info);
    } catch (err) {
      setEntryInfo(null);
      if (err?.message) {
        pushMessage?.(`Failed to load entry details: ${err.message}`);
      }
    } finally {
      setLoadingEntry(false);
    }
  }, [ethers, templAddress, signer, readProvider, walletAddress, pushMessage]);

  useEffect(() => {
    void refreshEntryInfo();
  }, [refreshEntryInfo]);

  const ensureWallet = () => {
    if (!hasWallet) {
      onConnectWallet?.();
      return false;
    }
    return true;
  };

  const handleApprove = async () => {
    if (!ensureWallet()) return;
    if (!tokenAddress || !entryFeeWei) {
      pushMessage?.('Templ configuration missing token or entry fee.');
      return;
    }
    setApprovePending(true);
    pushMessage?.('Approving entry fee…');
    try {
      await approveEntryFee({
        ethers,
        signer,
        templAddress,
        tokenAddress,
        amount: entryFeeWei,
        walletAddress
      });
      pushMessage?.('Allowance approved.');
      await refreshEntryInfo();
    } catch (err) {
      pushMessage?.(`Approval failed: ${err?.message || err}`);
    } finally {
      setApprovePending(false);
    }
  };

  const handlePurchase = async () => {
    if (!ensureWallet()) return;
    setPurchasePending(true);
    pushMessage?.('Purchasing access…');
    try {
      const result = await purchaseAccess({
        ethers,
        signer,
        templAddress,
        templArtifact,
        walletAddress,
        tokenAddress,
        entryFee: entryFeeWei
      });
      pushMessage?.(result.purchased ? 'Access purchase complete' : 'You already have access');
      await refreshEntryInfo();
      await refreshTempls?.();
    } catch (err) {
      pushMessage?.(`Purchase failed: ${err?.message || err}`);
    } finally {
      setPurchasePending(false);
    }
  };

  const handleVerify = async () => {
    if (!ensureWallet()) return;
    setPurchasePending(true);
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
      setPurchasePending(false);
    }
  };

  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <h1 className="text-3xl font-semibold tracking-tight">Join a Templ</h1>
      </header>
      <section className={`${layout.card} flex flex-col gap-4`}>
        <label className={form.label}>
          Templ address
          <input
            type="text"
            className={form.input}
            value={templAddress}
            onChange={(e) => setTemplAddress(e.target.value.trim())}
            placeholder="0x…"
          />
        </label>
        {knownTempls.length > 0 ? (
          <div className="space-y-2">
            <label className={form.label}>
              Or pick a discovered templ
              <select
                className={form.input}
                value={templSelectValue}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  setTemplAddress(value);
                }}
              >
                <option value="">Select a templ…</option>
                {knownTempls.map((templ) => (
                  <option key={templ.contract} value={templ.contract}>
                    {templ.tokenSymbol ? `${templ.tokenSymbol} · ${templ.contract}` : templ.contract}
                  </option>
                ))}
              </select>
            </label>
            <p className={text.hint}>
              Selecting a templ auto-fills the address and loads the current entry requirements for you.
            </p>
          </div>
        ) : null}
        <div className={layout.cardActions}>
          <button
            type="button"
            className={button.base}
            onClick={handleApprove}
            disabled={approvePending || purchasePending || !templAddress || !hasWallet || !entryFeeWei || allowanceSatisfied}
          >
            {approvePending ? 'Approving…' : 'Approve entry fee'}
          </button>
          <button
            type="button"
            className={button.primary}
            onClick={handlePurchase}
            disabled={purchasePending || !templAddress || !hasWallet || !allowanceSatisfied}
          >
            {purchasePending ? 'Purchasing…' : 'Purchase Access'}
          </button>
          <button
            type="button"
            className={button.base}
            onClick={handleVerify}
            disabled={purchasePending || approvePending || !templAddress}
          >
            Verify Membership
          </button>
        </div>
        {(templRecord || entryInfo) && (
          <dl className="grid gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <div className="flex items-center justify-between gap-4">
              <dt className="font-medium text-slate-600">Access token</dt>
              <dd className="font-mono text-xs text-slate-800">{tokenAddress || 'Unknown'}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="font-medium text-slate-600">Entry fee</dt>
              <dd className="font-mono text-xs text-slate-800">{entryFeeDisplay}</dd>
            </div>
            {allowanceDisplay && (
              <div className="flex items-center justify-between gap-4">
                <dt className="font-medium text-slate-600">Current allowance</dt>
                <dd className={`font-mono text-xs ${allowanceSatisfied ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {allowanceDisplay}
                </dd>
              </div>
            )}
            {balanceDisplay && (
              <div className="flex items-center justify-between gap-4">
                <dt className="font-medium text-slate-600">Wallet balance</dt>
                <dd className="font-mono text-xs text-slate-800">{balanceDisplay}</dd>
              </div>
            )}
          </dl>
        )}
        {loadingEntry && <p className={text.subtle}>Refreshing entry information…</p>}
      </section>
      {verification && (
        <section className={layout.card}>
          <h2 className="text-xl font-semibold text-slate-900">Membership Details</h2>
          <dl className="mt-4 grid gap-4">
            <div className="space-y-1">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Member address</dt>
              <dd className={`${text.mono} text-xs`}>{verification.member?.address || 'Unknown'}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Priest</dt>
              <dd className={`${text.mono} text-xs`}>{verification.templ?.priest || 'Unknown'}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Telegram chat id</dt>
              <dd className={text.subtle}>
                {verification.templ?.telegramChatId
                  ? verification.templ.telegramChatId
                  : verification.templ?.telegramChatIdHidden
                    ? 'Stored server-side'
                    : '—'}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Home link</dt>
              <dd>
                {(() => {
                  const { href, text: displayText } = sanitizeLink(verification.templ?.templHomeLink);
                  if (!displayText) return '—';
                  if (!href) return displayText;
                  return (
                    <a className="text-primary underline" href={href} target="_blank" rel="noreferrer">
                      {displayText}
                    </a>
                  );
                })()}
              </dd>
            </div>
          </dl>
          {verification.links && (
            <ul className="mt-4 list-disc space-y-2 pl-6 text-sm text-slate-700">
              {Object.entries(verification.links).map(([key, value]) => (
                <li key={key}>
                  <a className="text-primary underline" href={value} target="_blank" rel="noreferrer">{key}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
