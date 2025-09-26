import { useEffect, useState } from 'react';
import { sanitizeLink } from '../../../shared/linkSanitizer.js';
import { requestTemplRebindBackend } from '../services/deployment.js';
import { button, form, layout, surface, text } from '../ui/theme.js';

export function TemplOverviewPage({
  templAddress,
  templRecord,
  onNavigate,
  signer,
  walletAddress,
  onConnectWallet,
  pushMessage,
  refreshTempls
}) {
  const [proposalId, setProposalId] = useState('0');
  const [localChatId, setLocalChatId] = useState(templRecord?.telegramChatId || '');
  const [chatIdHidden, setChatIdHidden] = useState(Boolean(templRecord?.telegramChatIdHidden));
  const [currentPriest, setCurrentPriest] = useState(templRecord?.priest || '');
  const [bindingCode, setBindingCode] = useState(null);
  const [rebindPending, setRebindPending] = useState(false);
  const [rebindError, setRebindError] = useState('');

  useEffect(() => {
    setLocalChatId(templRecord?.telegramChatId || '');
    setChatIdHidden(Boolean(templRecord?.telegramChatIdHidden));
    setCurrentPriest(templRecord?.priest || '');
    if (templRecord?.telegramChatId) {
      setBindingCode(null);
    }
  }, [templRecord?.telegramChatId, templRecord?.priest, templRecord?.telegramChatIdHidden]);

  const isPriestWallet = walletAddress && currentPriest && walletAddress.toLowerCase() === currentPriest.toLowerCase();

  const handleRequestRebind = async () => {
    if (!walletAddress || !signer) {
      onConnectWallet?.();
      return;
    }
    if (!isPriestWallet) {
      pushMessage?.('Only the current priest can request a new binding code.');
      return;
    }
    setRebindPending(true);
    setRebindError('');
    try {
      pushMessage?.('Requesting new Telegram binding code…');
      const result = await requestTemplRebindBackend({ signer, walletAddress, templAddress });
      if (result?.bindingCode) {
        setBindingCode(result.bindingCode);
        setLocalChatId('');
        setChatIdHidden(false);
      }
      if (result?.priest) {
        setCurrentPriest(String(result.priest).toLowerCase());
      }
      pushMessage?.('Binding code issued. Post it in your Telegram group to finish the rebind.');
      refreshTempls?.();
    } catch (err) {
      const message = err?.message || 'Failed to request binding code';
      setRebindError(message);
      pushMessage?.(`Rebind failed: ${message}`);
    } finally {
      setRebindPending(false);
    }
  };

  const sanitizedHomeLink = sanitizeLink(templRecord?.templHomeLink);

  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <h1 className="text-3xl font-semibold tracking-tight">Templ Overview</h1>
        <span className={surface.pill}>{templAddress}</span>
      </header>
      <section className={layout.card}>
        <h2 className="text-xl font-semibold text-slate-900">Details</h2>
        <dl className="mt-4 grid gap-4">
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entry fee</dt>
            <dd className={`${text.mono} text-sm`}>
              {templRecord?.entryFeeFormatted
                ? `${templRecord.entryFeeFormatted}${templRecord.tokenSymbol ? ` ${templRecord.tokenSymbol}` : ''}`
                : templRecord?.entryFeeRaw || 'Unknown'}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Members</dt>
            <dd className={`${text.mono} text-sm`}>
              {Number.isFinite(templRecord?.memberCount) ? templRecord.memberCount : 'Unknown'}
              {templRecord?.totalPurchases ? (
                <span className={`ml-2 ${text.subtle}`}>({templRecord.totalPurchases} total purchases)</span>
              ) : null}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Treasury balance</dt>
            <dd className={`${text.mono} text-sm`}>
              {templRecord?.treasuryBalanceFormatted
                ? `${templRecord.treasuryBalanceFormatted}${templRecord.tokenSymbol ? ` ${templRecord.tokenSymbol}` : ''}`
                : templRecord?.treasuryBalanceRaw || '0'}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Member pool</dt>
            <dd className={`${text.mono} text-sm`}>
              {templRecord?.memberPoolBalanceFormatted
                ? `${templRecord.memberPoolBalanceFormatted}${templRecord.tokenSymbol ? ` ${templRecord.tokenSymbol}` : ''}`
                : templRecord?.memberPoolBalanceRaw || '0'}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total burned</dt>
            <dd className={`${text.mono} text-sm`}>
              {templRecord?.burnedFormatted
                ? `${templRecord.burnedFormatted}${templRecord.tokenSymbol ? ` ${templRecord.tokenSymbol}` : ''}`
                : templRecord?.burnedRaw || '0'}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Priest</dt>
            <dd className={`${text.mono} text-sm`}>{currentPriest || 'Unknown'}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Telegram chat id</dt>
            <dd className={text.subtle}>{chatIdHidden ? 'Stored server-side' : localChatId || '—'}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Home link</dt>
            <dd>
              {sanitizedHomeLink.text ? (
                sanitizedHomeLink.href ? (
                  <a className="text-primary underline" href={sanitizedHomeLink.href} target="_blank" rel="noreferrer">{sanitizedHomeLink.text}</a>
                ) : (
                  sanitizedHomeLink.text
                )
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        <div className={`${layout.cardActions} mt-6`}>
          <button type="button" className={button.base} onClick={() => onNavigate('/templs/join?address=' + templAddress)}>
            Join
          </button>
          <button type="button" className={button.base} onClick={() => onNavigate(`/templs/${templAddress}/proposals/new`)}>
            Create proposal
          </button>
          <button type="button" className={button.primary} onClick={() => onNavigate(`/templs/${templAddress}/claim`)}>
            Claim rewards
          </button>
        </div>
      </section>
      <section className={layout.card}>
        <h2 className="text-xl font-semibold text-slate-900">Telegram binding</h2>
        <div className="mt-4 space-y-4 text-sm text-slate-700">
          {localChatId ? (
            <p>
              Notifications are currently delivered to{' '}
              <code className={`${text.mono} text-xs`}>{localChatId}</code>. Request a new binding code if you need to move the bot to another chat.
            </p>
          ) : chatIdHidden ? (
            <p>
              Notifications are active, but the Telegram chat ID is stored on the server. Request a new binding code if you need to rotate the chat.
            </p>
          ) : bindingCode ? (
            <>
              <p>
                Invite{' '}
                <a className="text-primary underline" href="https://t.me/templfunbot" target="_blank" rel="noreferrer">@templfunbot</a>{' '}
                to your Telegram group and post this message to confirm the new chat.
              </p>
              <pre className={surface.codeBlock}><code>{`templ ${bindingCode}`}</code></pre>
              <p>The bot will acknowledge the binding and resume notifications in the new chat.</p>
            </>
          ) : (
            <p>This templ is not linked to a Telegram chat. Request a binding code to connect one.</p>
          )}
          {!isPriestWallet && (
            <p className={text.subtle}>Connect as the current priest to rotate the Telegram binding.</p>
          )}
          {rebindError && <p className="text-sm text-red-600">{rebindError}</p>}
        </div>
        <div className={`${layout.cardActions} mt-6`}>
          <button
            type="button"
            className={button.primary}
            onClick={handleRequestRebind}
            disabled={!isPriestWallet || rebindPending}
          >
            {rebindPending ? 'Requesting…' : 'Request binding code'}
          </button>
        </div>
      </section>
      <section className={`${layout.card} flex flex-col gap-4`}>
        <h2 className="text-xl font-semibold text-slate-900">Vote on a proposal</h2>
        <label className={form.label}>
          Proposal id
          <input
            type="text"
            className={form.input}
            value={proposalId}
            onChange={(e) => setProposalId(e.target.value.trim())}
          />
        </label>
        <button
          type="button"
          className={button.base}
          onClick={() => onNavigate(`/templs/${templAddress}/proposals/${proposalId || '0'}/vote`)}
        >
          Go to voting page
        </button>
      </section>
    </div>
  );
}
