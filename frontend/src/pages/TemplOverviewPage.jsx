import { useCallback, useEffect, useMemo, useState } from 'react';
import { sanitizeLink } from '../../../shared/linkSanitizer.js';
import { requestTemplRebindBackend } from '../services/deployment.js';
import { fetchTemplProposals, voteOnProposal } from '../services/governance.js';
import templArtifact from '../contracts/TEMPL.json';
import { button, layout, surface, text } from '../ui/theme.js';
import { formatDuration, formatTokenDisplay } from '../ui/format.js';
import { ethers } from 'ethers';

function splitDisplay(display) {
  if (!display) return ['0', ''];
  const parts = display.split(' ');
  if (parts.length <= 1) return [display, ''];
  return [parts[0], parts.slice(1).join(' ')];
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ACTION_LABELS = {
  0: 'Set paused state',
  1: 'Update configuration',
  2: 'Withdraw treasury',
  3: 'Disband treasury',
  4: 'Change priest',
  5: 'Set dictatorship',
  6: 'Set max members',
  7: 'Set home link'
};

function formatTokenAmount(value, decimals) {
  try {
    return formatTokenDisplay(ethers.formatUnits, value, decimals);
  } catch {
    return String(value);
  }
}

function describeProposalAction(proposal, templRecord) {
  const templTokenAddress = templRecord?.tokenAddress ? templRecord.tokenAddress.toLowerCase() : '';
  const templSymbol = templRecord?.tokenSymbol || '';
  const templDecimals = templRecord?.tokenDecimals ?? 18;
  const tokenAddress = proposal.token ? proposal.token.toLowerCase() : '';
  const isEth = !tokenAddress || tokenAddress === ZERO_ADDRESS;
  const matchesTemplToken = templTokenAddress && tokenAddress === templTokenAddress;
  const tokenLabel = isEth
    ? 'native ETH'
    : matchesTemplToken
      ? (templSymbol ? `${templSymbol} access token` : 'templ access token')
      : tokenAddress || 'custom token';

  switch (proposal.action) {
    case 0:
      return {
        label: proposal.paused ? 'Pause templ' : 'Unpause templ',
        details: [
          proposal.paused
            ? 'Pauses new joins and treasury actions until the templ is resumed.'
            : 'Resumes normal templ operations.'
        ]
      };
    case 1: {
      const entryChanges = [];
      if (proposal.newEntryFee && proposal.newEntryFee !== '0') {
        entryChanges.push(
          `Entry fee → ${formatTokenAmount(proposal.newEntryFee, templDecimals)}${templSymbol ? ` ${templSymbol}` : ''}`
        );
      }
      if (proposal.updateFeeSplit) {
        entryChanges.push(
          `Fee split → burn ${proposal.newBurnPercent}% / treasury ${proposal.newTreasuryPercent}% / member pool ${proposal.newMemberPoolPercent}%`
        );
      }
      if (entryChanges.length === 0) {
        entryChanges.push('No configuration changes were provided.');
      }
      return {
        label: 'Update templ configuration',
        details: entryChanges
      };
    }
    case 2: {
      const amountDisplay = matchesTemplToken || isEth
        ? `${formatTokenAmount(proposal.amount, matchesTemplToken ? templDecimals : 18)}${matchesTemplToken && templSymbol ? ` ${templSymbol}` : isEth ? ' ETH' : ''}`
        : `${proposal.amount} units`;
      const lines = [
        `Withdraw ${amountDisplay} to ${proposal.recipient}.`,
        `Token: ${tokenLabel}`
      ];
      if (proposal.reason) {
        lines.push(`Reason: ${proposal.reason}`);
      }
      return {
        label: 'Withdraw treasury funds',
        details: lines
      };
    }
    case 3:
      return {
        label: 'Disband treasury reserves',
        details: [`Distribute ${tokenLabel} balances to member and external reward pools.`]
      };
    case 4:
      return {
        label: 'Change priest',
        details: [`Appoint ${proposal.recipient} as the new priest.`]
      };
    case 5:
      return {
        label: proposal.setDictatorship ? 'Enable dictatorship' : 'Disable dictatorship',
        details: [
          proposal.setDictatorship
            ? 'Shifts governance power to the priest until dictatorship is disabled.'
            : 'Restores member governance with quorum requirements.'
        ]
      };
    case 6:
      return {
        label: 'Set max members',
        details: [
          proposal.newMaxMembers === '0'
            ? 'Remove the member cap and allow unlimited members.'
            : `Limit membership to ${proposal.newMaxMembers} wallets.`
        ]
      };
    case 7:
      return {
        label: 'Update home link',
        details: [`Set templ home link to ${proposal.newHomeLink || '—'}.`]
      };
    default:
      return {
        label: ACTION_LABELS[proposal.action] || 'Unknown action',
        details: []
      };
  }
}

export function TemplOverviewPage({
  templAddress,
  templRecord,
  onNavigate,
  signer,
  readProvider,
  walletAddress,
  onConnectWallet,
  pushMessage,
  refreshTempls
}) {
  const [localChatId, setLocalChatId] = useState(templRecord?.telegramChatId || '');
  const [chatIdHidden, setChatIdHidden] = useState(Boolean(templRecord?.telegramChatIdHidden));
  const [currentPriest, setCurrentPriest] = useState(templRecord?.priest || '');
  const [bindingCode, setBindingCode] = useState(null);
  const [rebindPending, setRebindPending] = useState(false);
  const [rebindError, setRebindError] = useState('');
  const [proposals, setProposals] = useState([]);
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [proposalError, setProposalError] = useState('');
  const [pendingVoteId, setPendingVoteId] = useState(null);
  const [pendingVoteChoice, setPendingVoteChoice] = useState('');

  const provider = useMemo(() => signer?.provider ?? readProvider, [signer, readProvider]);

  useEffect(() => {
    setLocalChatId(templRecord?.telegramChatId || '');
    setChatIdHidden(Boolean(templRecord?.telegramChatIdHidden));
    setCurrentPriest(templRecord?.priest || '');
    if (templRecord?.telegramChatId) {
      setBindingCode(null);
    }
  }, [templRecord?.telegramChatId, templRecord?.priest, templRecord?.telegramChatIdHidden]);

  const isPriestWallet = walletAddress && currentPriest && walletAddress.toLowerCase() === currentPriest.toLowerCase();

  const refreshProposalList = useCallback(async () => {
    if (!templAddress || !provider) {
      setProposals([]);
      return;
    }
    setLoadingProposals(true);
    setProposalError('');
    try {
      const items = await fetchTemplProposals({
        ethers,
        provider,
        templAddress,
        templArtifact,
        voterAddress: walletAddress
      });
      setProposals(items);
    } catch (err) {
      const message = err?.message || 'Failed to load proposals';
      setProposalError(message);
      pushMessage?.(`Failed to load proposals: ${message}`);
    } finally {
      setLoadingProposals(false);
    }
  }, [provider, templAddress, walletAddress, pushMessage]);

  useEffect(() => {
    refreshProposalList();
  }, [refreshProposalList]);

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
  const nowSeconds = Math.floor(Date.now() / 1000);

  const handleQuickVote = useCallback(async (proposalId, support) => {
    if (!signer) {
      onConnectWallet?.();
      return;
    }
    setPendingVoteId(proposalId);
    setPendingVoteChoice(support ? 'yes' : 'no');
    pushMessage?.('Casting vote…');
    try {
      await voteOnProposal({
        ethers,
        signer,
        templAddress,
        templArtifact,
        proposalId,
        support
      });
      pushMessage?.('Vote submitted');
      await refreshProposalList();
    } catch (err) {
      pushMessage?.(`Vote failed: ${err?.message || err}`);
    } finally {
      setPendingVoteId(null);
      setPendingVoteChoice('');
    }
  }, [signer, onConnectWallet, pushMessage, templAddress, refreshProposalList]);

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
              {templRecord?.totalJoins ? (
                <span className={`ml-2 ${text.subtle}`}>({templRecord.totalJoins} total joins)</span>
              ) : null}
            </dd>
          </div>
          {(() => {
            const [treasuryValue, treasuryUnit] = splitDisplay(formatTokenDisplay(ethers.formatUnits, templRecord?.treasuryBalanceRaw || '0', templRecord?.tokenDecimals ?? 18));
            const [poolValue, poolUnit] = splitDisplay(formatTokenDisplay(ethers.formatUnits, templRecord?.memberPoolBalanceRaw || '0', templRecord?.tokenDecimals ?? 18));
            const [burnedValue, burnedUnit] = splitDisplay(formatTokenDisplay(ethers.formatUnits, templRecord?.burnedRaw || '0', templRecord?.tokenDecimals ?? 18));
            return (
              <>
                <div className="space-y-1">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Treasury balance</dt>
                  <dd className={`${text.mono} text-sm`}>
                    <div className="flex w-32 flex-col leading-tight">
                      <span>{treasuryValue}</span>
                      {treasuryUnit ? <span className="text-xs text-slate-500">{treasuryUnit}</span> : null}
                    </div>
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Member pool</dt>
                  <dd className={`${text.mono} text-sm`}>
                    <div className="flex w-32 flex-col leading-tight">
                      <span>{poolValue}</span>
                      {poolUnit ? <span className="text-xs text-slate-500">{poolUnit}</span> : null}
                    </div>
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total burned</dt>
                  <dd className={`${text.mono} text-sm`}>
                    <div className="flex w-32 flex-col leading-tight">
                      <span>{burnedValue}</span>
                      {burnedUnit ? <span className="text-xs text-slate-500">{burnedUnit}</span> : null}
                    </div>
                  </dd>
                </div>
              </>
            );
          })()}
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
      <section className={`${layout.card} space-y-4`}>
        <div className={layout.sectionHeader}>
          <h2 className="text-xl font-semibold text-slate-900">Proposals</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={button.base}
              onClick={refreshProposalList}
              disabled={loadingProposals}
            >
              {loadingProposals ? 'Refreshing…' : 'Refresh proposals'}
            </button>
            <button
              type="button"
              className={button.link}
              onClick={() => onNavigate(`/templs/${templAddress}/proposals/new`)}
            >
              New proposal
            </button>
          </div>
        </div>
        {proposalError && <p className="text-sm text-red-600">{proposalError}</p>}
        {loadingProposals && proposals.length === 0 ? (
          <p className="text-sm text-slate-600">Loading proposals…</p>
        ) : proposals.length === 0 ? (
          <p className="text-sm text-slate-600">No proposals have been created yet.</p>
        ) : (
          <ul className="space-y-4">
            {proposals.map((proposal) => {
              const summary = describeProposalAction(proposal, templRecord);
              const badges = [];
              if (proposal.executed) {
                badges.push({ key: 'executed', text: 'Executed', tone: 'bg-emerald-100 text-emerald-700' });
              } else if (proposal.endTime && nowSeconds >= proposal.endTime) {
                badges.push({
                  key: 'ended',
                  text: proposal.passed ? 'Passed' : 'Voting closed',
                  tone: proposal.passed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
                });
              } else {
                badges.push({ key: 'active', text: 'Active', tone: 'bg-sky-100 text-sky-700' });
              }
              if (proposal.quorumExempt) {
                badges.push({ key: 'quorum-exempt', text: 'Quorum exempt', tone: 'bg-amber-100 text-amber-700' });
              } else if (proposal.quorumReachedAt) {
                badges.push({ key: 'quorum', text: 'Quorum reached', tone: 'bg-amber-100 text-amber-700' });
              }
              const votingOpen = !proposal.executed && (!proposal.endTime || nowSeconds < proposal.endTime);
              const timeRemaining = votingOpen && proposal.endTime ? Math.max(proposal.endTime - nowSeconds, 0) : 0;
              const voteStatus = walletAddress
                ? proposal.voted
                  ? proposal.support ? 'YES' : 'NO'
                  : 'Not yet voted'
                : 'Connect wallet to vote';
              const pending = pendingVoteId === proposal.id;
              const yesVotes = Number.isFinite(proposal.yesVotes) ? proposal.yesVotes : 0;
              const noVotes = Number.isFinite(proposal.noVotes) ? proposal.noVotes : 0;
              return (
                <li key={proposal.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`${surface.badge} font-semibold`}>#{proposal.id}</span>
                      <span className={surface.badge}>{summary.label || ACTION_LABELS[proposal.action] || 'Proposal'}</span>
                      {badges.map((badge) => (
                        <span key={badge.key} className={`${surface.badge} ${badge.tone}`}>
                          {badge.text}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      className={button.link}
                      onClick={() => onNavigate(`/templs/${templAddress}/proposals/${proposal.id}/vote`)}
                    >
                      View proposal
                    </button>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-slate-900">
                    {proposal.title || `Proposal #${proposal.id}`}
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    {proposal.description || 'No description provided.'}
                  </p>
                  {summary.details.length ? (
                    <ul className="mt-3 space-y-1 text-sm text-slate-600">
                      {summary.details.map((detail, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" />
                          <span>{detail}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <span>YES: {yesVotes}</span>
                    <span>NO: {noVotes}</span>
                    <span>
                      {proposal.endTime
                        ? votingOpen
                          ? `Voting ends in ${formatDuration(timeRemaining)}`
                          : `Voting closed ${new Date(proposal.endTime * 1000).toLocaleString()}`
                        : 'Open voting'}
                    </span>
                    <span>
                      {proposal.quorumReachedAt
                        ? `Quorum reached ${new Date(proposal.quorumReachedAt * 1000).toLocaleString()}`
                        : proposal.quorumExempt
                          ? 'Quorum not required'
                          : 'Quorum not reached yet'}
                    </span>
                    <span>Your vote: {voteStatus}</span>
                  </div>
                  <div className={`${layout.cardActions} mt-4`}>
                    <button
                      type="button"
                      className={button.primary}
                      onClick={() => handleQuickVote(proposal.id, true)}
                      disabled={!votingOpen || pending}
                    >
                      {pending && pendingVoteChoice === 'yes' ? 'Submitting…' : 'Vote YES'}
                    </button>
                    <button
                      type="button"
                      className={button.base}
                      onClick={() => handleQuickVote(proposal.id, false)}
                      disabled={!votingOpen || pending}
                    >
                      {pending && pendingVoteChoice === 'no' ? 'Submitting…' : 'Vote NO'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
