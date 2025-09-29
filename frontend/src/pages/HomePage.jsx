import { BACKEND_URL } from '../config.js';
import { sanitizeLink } from '../../../shared/linkSanitizer.js';
import { button, layout, surface, table, text } from '../ui/theme.js';
import { formatTokenDisplay } from '../ui/format.js';
import { ethers } from 'ethers';

function splitDisplay(display) {
  if (!display) return ['0', ''];
  const parts = display.split(' ');
  if (parts.length <= 1) return [display, ''];
  return [parts[0], parts.slice(1).join(' ')];
}

export function HomePage({ walletAddress, onConnectWallet, onNavigate, templs, loadingTempls, refreshTempls }) {
  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <h1 className="text-3xl font-semibold tracking-tight">TEMPL Control Center</h1>
        <div className={layout.cardActions}>
          {walletAddress ? (
            <span className={surface.pill}>
              Connected: {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
            </span>
          ) : (
            <button type="button" onClick={onConnectWallet} className={button.primary}>Connect Wallet</button>
          )}
        </div>
      </header>
      <section className={layout.card}>
        <div className={layout.sectionHeader}>
          <h2 className="text-xl font-semibold text-slate-900">Start Here</h2>
        </div>
        <div className={layout.cardActions}>
          <button type="button" className={button.primary} onClick={() => onNavigate('/templs/create')}>
            Create a Templ
          </button>
          <button type="button" className={button.base} onClick={() => onNavigate('/templs/join')}>
            Join a Templ
          </button>
        </div>
        <p className={`${text.hint} mt-4`}>Backend API: {BACKEND_URL}</p>
      </section>
      <section className={layout.card}>
        <div className={layout.sectionHeader}>
          <h2 className="text-xl font-semibold text-slate-900">Registered Templs</h2>
          <div className={layout.cardActions}>
            <button type="button" className={button.base} onClick={refreshTempls} disabled={loadingTempls}>
              {loadingTempls ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
        {templs.length === 0 ? (
          <p className={text.subtle}>No templs discovered for this factory yet.</p>
        ) : (
          <div className={`${layout.tableWrapper} mt-4`}>
            <table className={`${table.base} templs-table`}>
              <thead className={table.headRow}>
                <tr>
                  <th className={table.headCell}>Templ</th>
                  <th className={table.headCell}>Token</th>
                  <th className={table.headCell}>Members</th>
                  <th className={table.headCell}>Treasury</th>
                  <th className={table.headCell}>Member Pool</th>
                  <th className={table.headCell}>Burned</th>
                  <th className={table.headCell}>Links</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {templs.map((templ) => {
                  const sanitizedHomeLink = sanitizeLink(templ.links?.homeLink);
                  const [treasuryValue, treasuryUnit] = splitDisplay(formatTokenDisplay(ethers.formatUnits, templ.treasuryBalanceRaw, templ.tokenDecimals));
                  const [poolValue, poolUnit] = splitDisplay(formatTokenDisplay(ethers.formatUnits, templ.memberPoolBalanceRaw, templ.tokenDecimals));
                  const [burnedValue, burnedUnit] = splitDisplay(formatTokenDisplay(ethers.formatUnits, templ.burnedRaw, templ.tokenDecimals));
                  return (
                    <tr key={templ.contract} className="bg-white">
                      <td className={table.cell}>
                        <div className={`${text.mono} text-xs`}>{templ.contract}</div>
                        {templ.priest ? (
                          <span className="sr-only">Priest: {templ.priest}</span>
                        ) : null}
                      </td>
                      <td className={table.cell}>
                        <div className="text-sm font-medium text-slate-900">{templ.tokenSymbol}</div>
                      </td>
                      <td className={table.cell}>
                        <div className="text-sm font-medium text-slate-900">{Number.isFinite(templ.memberCount) ? templ.memberCount : '—'}</div>
                      </td>
                      <td className={table.cell}>
                        <div className="flex w-24 flex-col text-sm text-slate-800 leading-tight">
                          <span>{treasuryValue}</span>
                          {treasuryUnit ? <span className="text-xs text-slate-500">{treasuryUnit}</span> : null}
                        </div>
                      </td>
                      <td className={table.cell}>
                        <div className="flex w-24 flex-col text-sm text-slate-800 leading-tight">
                          <span>{poolValue}</span>
                          {poolUnit ? <span className="text-xs text-slate-500">{poolUnit}</span> : null}
                        </div>
                      </td>
                      <td className={table.cell}>
                        <div className="flex w-24 flex-col text-sm text-slate-800 leading-tight">
                          <span>{burnedValue}</span>
                          {burnedUnit ? <span className="text-xs text-slate-500">{burnedUnit}</span> : null}
                        </div>
                      </td>
                      <td className={`${table.cell} whitespace-nowrap`}>
                        <div className="flex flex-col gap-2 text-sm">
                          <button
                            type="button"
                            className={button.base}
                            onClick={() => onNavigate(templ.links?.overview || `/templs/${templ.contract}`)}
                          >
                            Overview
                          </button>
                          <button
                            type="button"
                            className={button.base}
                            onClick={() => onNavigate(`/templs/join?address=${templ.contract}`)}
                          >
                            Join
                          </button>
                          <button
                            type="button"
                            className={button.base}
                            onClick={() => onNavigate(`/templs/${templ.contract}/claim`)}
                          >
                            Claim
                          </button>
                          <button
                            type="button"
                            className={button.base}
                            onClick={() => onNavigate(`/templs/${templ.contract}/proposals/new`)}
                          >
                            New proposal
                          </button>
                          {sanitizedHomeLink.href ? (
                            <a
                              href={sanitizedHomeLink.href}
                              target="_blank"
                              rel="noreferrer"
                              className={button.link}
                            >
                              Open Home
                            </a>
                          ) : sanitizedHomeLink.text ? (
                            <span className={text.subtle}>{sanitizedHomeLink.text}</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
