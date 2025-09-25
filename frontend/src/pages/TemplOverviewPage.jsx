import { useState } from 'react';

export function TemplOverviewPage({ templAddress, templRecord, onNavigate }) {
  const [proposalId, setProposalId] = useState('0');

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
            <dd>{templRecord?.priest || 'Unknown'}</dd>
          </div>
          <div>
            <dt>Telegram chat id</dt>
            <dd>{templRecord?.telegramChatId || '—'}</dd>
          </div>
        </dl>
        <div className="card-actions">
          <button type="button" onClick={() => onNavigate('/templs/join?address=' + templAddress)}>Join</button>
          <button type="button" onClick={() => onNavigate(`/templs/${templAddress}/proposals/new`)}>Create proposal</button>
          <button type="button" onClick={() => onNavigate(`/templs/${templAddress}/claim`)}>Claim rewards</button>
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
