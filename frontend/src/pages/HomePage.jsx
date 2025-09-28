import { useMemo } from 'react';
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

function Metric({ label, value, hint }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-slate-50 px-4 py-3 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-base font-semibold text-slate-900">{value}</span>
      {hint ? <span className={text.hint}>{hint}</span> : null}
    </div>
  );
}

export function HomePage({ walletAddress, onConnectWallet, onNavigate, templs, loadingTempls, refreshTempls }) {
  const { templCount, memberTotal, activeTreasuries } = useMemo(() => {
    const count = templs.length;
    let memberSum = 0;
    let treasuryWithBalance = 0;
    for (const templ of templs) {
      if (Number.isFinite(templ.memberCount)) {
        memberSum += templ.memberCount;
      }
      try {
        if (templ.treasuryBalanceRaw && BigInt(templ.treasuryBalanceRaw) > 0n) {
          treasuryWithBalance += 1;
        }
      } catch {
        /* ignore */
      }
    }
    return { templCount: count, memberTotal: memberSum, activeTreasuries: treasuryWithBalance };
  }, [templs]);

  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">TEMPL Control Center</h1>
          <p className="max-w-xl text-sm text-slate-600">
            Launch, operate, and monitor templ communities from a single workspace. Use the quick actions below to start a new
            templ or jump back into an existing one.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          {walletAddress ? (
            <span className={surface.pill}>
              Wallet connected: {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
            </span>
          ) : (
            <button type="button" onClick={onConnectWallet} className={button.primary}>
              Connect wallet
            </button>
          )}
          <button type="button" className={button.muted} onClick={refreshTempls} disabled={loadingTempls}>
            {loadingTempls ? 'Refreshing templs…' : 'Refresh templ list'}
          </button>
          <span className={text.hint}>Data source: {BACKEND_URL}</span>
        </div>
      </header>

      <section className={`${layout.card} space-y-4`}>
        <div className={layout.sectionHeader}>
          <h2 className="text-xl font-semibold text-slate-900">Get started</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" className={`${button.primary} justify-start`} onClick={() => onNavigate('/templs/create')}>
            <div className="flex flex-col text-left">
              <span className="text-base font-semibold">Create a templ</span>
              <span className="text-sm text-slate-800/80">
                Configure membership rules, treasury splits, and Telegram routing in a guided flow.
              </span>
            </div>
          </button>
          <button type="button" className={`${button.base} justify-start`} onClick={() => onNavigate('/templs/join')}>
            <div className="flex flex-col text-left">
              <span className="text-base font-semibold">Join a templ</span>
              <span className="text-sm text-slate-800/80">
                Review entry fees, approve the access token, and confirm membership in a few clicks.
              </span>
            </div>
          </button>
        </div>
        <p className={text.hint}>
          Looking for a specific templ? Paste its address on the Join screen or open it from the list below.
        </p>
      </section>

      <section className={`${layout.card} space-y-4`}>
        <div className={layout.sectionHeader}>
          <h2 className="text-xl font-semibold text-slate-900">Network snapshot</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Templs discovered" value={templCount} hint="Tracked from the connected factory" />
          <Metric label="Members observed" value={memberTotal || '—'} hint="Total known members across templs" />
          <Metric label="Treasuries with balance" value={activeTreasuries} hint="Templs holding non-zero reserves" />
        </div>
      </section>

      <section className={`${layout.card} space-y-4`}>
        <div className={layout.sectionHeader}>
          <h2 className="text-xl font-semibold text-slate-900">Registered templs</h2>
          <div className="flex flex-col items-end gap-1 text-right text-xs text-slate-500 sm:flex-row sm:items-center sm:gap-4 sm:text-sm">
            <button type="button" className={button.base} onClick={refreshTempls} disabled={loadingTempls}>
              {loadingTempls ? 'Refreshing…' : 'Refresh templ list'}
            </button>
            <span>{loadingTempls ? 'Refreshing on-chain and off-chain data…' : 'Sorted alphabetically.'}</span>
          </div>
        </div>
        {templs.length === 0 ? (
          <p className="text-sm text-slate-600">No templs discovered for this factory yet.</p>
        ) : (
          <div className={layout.tableWrapper}>
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
                  const sanitizedHomeLink = sanitizeLink(templ.links?.homeLink || templ.templHomeLink);
                  const [treasuryValue, treasuryUnit] = splitDisplay(
                    formatTokenDisplay(ethers.formatUnits, templ.treasuryBalanceRaw, templ.tokenDecimals)
                  );
                  const [poolValue, poolUnit] = splitDisplay(
                    formatTokenDisplay(ethers.formatUnits, templ.memberPoolBalanceRaw, templ.tokenDecimals)
                  );
                  const [burnedValue, burnedUnit] = splitDisplay(
                    formatTokenDisplay(ethers.formatUnits, templ.burnedRaw, templ.tokenDecimals)
                  );

                  return (
                    <tr key={templ.contract} className="bg-white">
                      <td className={table.cell}>
                        <div className="flex flex-col gap-1">
                          <div className="text-sm font-semibold text-slate-900">{templ.priest || 'Templ'}</div>
                          <div className={`${text.mono} text-xs text-slate-500`}>{templ.contract}</div>
                        </div>
                      </td>
                      <td className={table.cell}>
                        <div className="flex flex-col gap-1">
                          <span className="text-sm font-medium text-slate-900">{templ.tokenSymbol || '—'}</span>
                          {templ.entryFeeFormatted ? (
                            <span className={`${text.hint} text-xs`}>
                              Entry fee: {templ.entryFeeFormatted}
                              {templ.tokenSymbol ? ` ${templ.tokenSymbol}` : ''}
                            </span>
                          ) : templ.entryFeeRaw ? (
                            <span className={`${text.hint} text-xs`}>Entry fee (wei): {templ.entryFeeRaw}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className={table.cell}>
                        <div className="text-sm font-medium text-slate-900">
                          {Number.isFinite(templ.memberCount) ? templ.memberCount : '—'}
                        </div>
                        {templ.totalPurchases ? (
                          <div className={`${text.hint} text-xs`}>Total joins: {templ.totalPurchases}</div>
                        ) : null}
                      </td>
                      <td className={table.cell}>
                        <div className="flex w-28 flex-col text-sm text-slate-800 leading-tight">
                          <span>{treasuryValue}</span>
                          {treasuryUnit ? <span className="text-xs text-slate-500">{treasuryUnit}</span> : null}
                        </div>
                      </td>
                      <td className={table.cell}>
                        <div className="flex w-28 flex-col text-sm text-slate-800 leading-tight">
                          <span>{poolValue}</span>
                          {poolUnit ? <span className="text-xs text-slate-500">{poolUnit}</span> : null}
                        </div>
                      </td>
                      <td className={table.cell}>
                        <div className="flex w-28 flex-col text-sm text-slate-800 leading-tight">
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
                            View
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
                            <span className={text.hint}>{sanitizedHomeLink.text}</span>
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
