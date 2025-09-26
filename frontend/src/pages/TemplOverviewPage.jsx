import { useEffect, useState } from 'react';
import { sanitizeLink } from '../../../shared/linkSanitizer.js';
import { requestTemplRebindBackend } from '../services/deployment.js';

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
    <div className="page">
      <header className="page-header">
        <h1>Templ Overview</h1>
        <span className="pill">{templAddress}</span>
      </header>
      <section className="card">
        <h2>Details</h2>
        <dl className="data-list">
          <div>
            <dt>Priest</dt>
            <dd>{currentPriest || 'Unknown'}</dd>
          </div>
          <div>
            <dt>Telegram chat id</dt>
            <dd>{chatIdHidden ? 'Stored server-side' : localChatId || '—'}</dd>
          </div>
          <div>
            <dt>Home link</dt>
            <dd>
              {sanitizedHomeLink.text ? (
                sanitizedHomeLink.href ? (
                  <a href={sanitizedHomeLink.href} target="_blank" rel="noreferrer">{sanitizedHomeLink.text}</a>
                ) : (
                  sanitizedHomeLink.text
                )
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        <div className="card-actions">
          <button type="button" onClick={() => onNavigate('/templs/join?address=' + templAddress)}>Join</button>
          <button type="button" onClick={() => onNavigate(`/templs/${templAddress}/proposals/new`)}>Create proposal</button>
          <button type="button" onClick={() => onNavigate(`/templs/${templAddress}/claim`)}>Claim rewards</button>
        </div>
      </section>
      <section className="card">
        <h2>Telegram binding</h2>
        {localChatId ? (
          <p>
            Notifications are currently delivered to <code>{localChatId}</code>. Request a new binding code if you need to move the bot to another chat.
          </p>
        ) : chatIdHidden ? (
          <p>
            Notifications are active, but the Telegram chat ID is stored on the server. Request a new binding code if you need to rotate the chat.
          </p>
        ) : bindingCode ? (
          <>
            <p>
              Invite <a href="https://t.me/templfunbot" target="_blank" rel="noreferrer">@templfunbot</a> to your Telegram group and post this message to confirm the new chat.
            </p>
            <pre className="binding-code"><code>{`templ ${bindingCode}`}</code></pre>
            <p>The bot will acknowledge the binding and resume notifications in the new chat.</p>
          </>
        ) : (
          <p>This templ is not linked to a Telegram chat. Request a binding code to connect one.</p>
        )}
        {!isPriestWallet && (
          <p className="subtle">Connect as the current priest to rotate the Telegram binding.</p>
        )}
        {rebindError && <p className="error">{rebindError}</p>}
        <div className="card-actions">
          <button type="button" onClick={handleRequestRebind} disabled={!isPriestWallet || rebindPending}>
            {rebindPending ? 'Requesting…' : 'Request binding code'}
          </button>
        </div>
      </section>
      <section className="card form">
        <h2>Vote on a proposal</h2>
        <label>
          Proposal id
          <input type="text" value={proposalId} onChange={(e) => setProposalId(e.target.value.trim())} />
        </label>
        <button type="button" onClick={() => onNavigate(`/templs/${templAddress}/proposals/${proposalId || '0'}/vote`)}>Go to voting page</button>
      </section>
    </div>
  );
}
