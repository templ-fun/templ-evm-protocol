import { BACKEND_URL } from '../config.js';

export function HomePage({ walletAddress, onConnectWallet, onNavigate, templs, loadingTempls, refreshTempls }) {
  return (
    <div className="page">
      <header className="page-header">
        <h1>TEMPL Control Center</h1>
        <div className="actions">
          {walletAddress ? (
            <span className="pill">Connected: {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</span>
          ) : (
            <button type="button" onClick={onConnectWallet} className="primary">Connect Wallet</button>
          )}
        </div>
      </header>
      <section className="card">
        <h2>Start Here</h2>
        <div className="card-actions">
          <button type="button" className="primary" onClick={() => onNavigate('/templs/create')}>Create a Templ</button>
          <button type="button" onClick={() => onNavigate('/templs/join')}>Join a Templ</button>
        </div>
        <p className="hint">Backend API: {BACKEND_URL}</p>
      </section>
      <section className="card">
        <div className="card-header">
          <h2>Registered Templs</h2>
          <div className="card-actions">
            <button type="button" onClick={refreshTempls} disabled={loadingTempls}>
              {loadingTempls ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
        {templs.length === 0 ? (
          <p className="empty">No templs registered yet.</p>
        ) : (
          <table className="templs-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Priest</th>
                <th>Telegram Chat</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templs.map((templ) => (
                <tr key={templ.contract}>
                  <td>{templ.contract}</td>
                  <td>{templ.priest || '—'}</td>
                  <td>{templ.telegramChatId || '—'}</td>
                  <td>
                    <button type="button" onClick={() => onNavigate(`/templs/${templ.contract}`)}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
