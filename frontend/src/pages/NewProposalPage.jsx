import { useCallback, useEffect, useMemo, useState } from 'react';
import templArtifact from '../contracts/TEMPL.json';
import { fetchGovernanceParameters, proposeVote } from '../services/governance.js';
import { fetchTemplStats } from '../services/templs.js';
import { button, form, layout, surface, text } from '../ui/theme.js';
import { formatDuration } from '../ui/format.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// eslint-disable-next-line react-refresh/only-export-components
export const ACTIONS = [
  { value: 'pause', label: 'Pause templ' },
  { value: 'unpause', label: 'Unpause templ' },
  { value: 'changePriest', label: 'Change priest' },
  { value: 'setMaxMembers', label: 'Set max members' },
  { value: 'enableDictatorship', label: 'Enable dictatorship' },
  { value: 'disableDictatorship', label: 'Disable dictatorship' },
  { value: 'withdrawTreasury', label: 'Withdraw treasury funds' },
  { value: 'disbandTreasury', label: 'Disband treasury' },
  { value: 'updateConfig', label: 'Update templ config' },
  { value: 'updateHomeLink', label: 'Update templ home link' }
];

function normalizeAddress(value, label, ethersLib) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  if (ethersLib?.isAddress?.(trimmed)) {
    return ethersLib?.getAddress?.(trimmed) || trimmed;
  }
  throw new Error(`Invalid ${label}`);
}

function parseBigInt(value, label, { allowZero = false } = {}) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  try {
    const parsed = BigInt(trimmed);
    if (!allowZero && parsed <= 0n) {
      throw new Error(`${label} must be greater than zero`);
    }
    if (allowZero && parsed < 0n) {
      throw new Error(`${label} must be non-negative`);
    }
    return parsed;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function parsePercent(value, label) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new Error(`${label} must be an integer`);
  }
  if (num < 0 || num > 100) {
    throw new Error(`${label} must be between 0 and 100`);
  }
  return num;
}

// eslint-disable-next-line react-refresh/only-export-components
export function buildActionConfig(kind, params, helpers = {}) {
  const ethersLib = helpers?.ethers;
  const protocolPercentRaw = helpers?.protocolPercent;
  const resolvedProtocolPercent = Number.isFinite(Number(protocolPercentRaw))
    ? Number(protocolPercentRaw)
    : null;
  switch (kind) {
    case 'pause':
      return { action: 'setPaused', params: { paused: true } };
    case 'unpause':
      return { action: 'setPaused', params: { paused: false } };
    case 'changePriest':
      if (!params.newPriest) throw new Error('New priest address is required');
      return { action: 'changePriest', params: { newPriest: params.newPriest } };
    case 'setMaxMembers':
      if (!params.maxMembers) throw new Error('Max members value is required');
      return { action: 'setMaxMembers', params: { newMaxMembers: params.maxMembers } };
    case 'enableDictatorship':
      return { action: 'setDictatorship', params: { enable: true } };
    case 'disableDictatorship':
      return { action: 'setDictatorship', params: { enable: false } };
    case 'withdrawTreasury': {
      const tokenInput = String(params.token ?? '').trim();
      if (!tokenInput) throw new Error('Withdrawal token is required');
      let tokenAddress;
      if (tokenInput.toLowerCase() === 'eth') {
        tokenAddress = ethersLib?.ZeroAddress ?? ZERO_ADDRESS;
      } else {
        tokenAddress = normalizeAddress(tokenInput, 'withdrawal token address', ethersLib);
      }
      const recipient = normalizeAddress(params.recipient, 'recipient address', ethersLib);
      const amount = parseBigInt(params.amount, 'withdrawal amount');
      const reason = String(params.reason ?? '').trim();
      return {
        action: 'withdrawTreasury',
        params: { token: tokenAddress, recipient, amount, reason }
      };
    }
    case 'disbandTreasury': {
      const mode = String(params.tokenMode || 'accessToken');
      if (mode === 'custom') {
        const customToken = normalizeAddress(params.customToken, 'treasury token', ethersLib);
        return { action: 'disbandTreasury', params: { token: customToken } };
      }
      if (mode === 'eth') {
        return { action: 'disbandTreasury', params: { token: 'eth' } };
      }
      return { action: 'disbandTreasury', params: { token: '' } };
    }
    case 'updateConfig': {
      const entryFeeRaw = String(params.entryFee ?? '').trim();
      const shouldUpdateSplit = params.updateFeeSplit === true;
      const nextParams = {};
      if (entryFeeRaw) {
        const entryFee = parseBigInt(entryFeeRaw, 'entry fee', { allowZero: true });
        nextParams.newEntryFee = entryFee;
      }
      if (shouldUpdateSplit) {
        const burn = parsePercent(params.burnPercent, 'burn percent');
        const treasury = parsePercent(params.treasuryPercent, 'treasury percent');
        const member = parsePercent(params.memberPercent, 'member pool percent');
        const protocolCut = resolvedProtocolPercent ?? 0;
        const targetSplit = 100 - protocolCut;
        if (targetSplit < 0) {
          throw new Error('Protocol percent exceeds 100');
        }
        const total = burn + treasury + member;
        if (total !== targetSplit) {
          throw new Error(`Fee split must add up to ${targetSplit} (received ${total})`);
        }
        nextParams.updateFeeSplit = true;
        nextParams.newBurnPercent = burn;
        nextParams.newTreasuryPercent = treasury;
        nextParams.newMemberPoolPercent = member;
      }
      if (!('newEntryFee' in nextParams) && !shouldUpdateSplit) {
        throw new Error('Provide at least one config change');
      }
      return { action: 'updateConfig', params: nextParams };
    }
    case 'updateHomeLink':
      if (!params.homeLink) throw new Error('Home link is required');
      return { action: 'setHomeLink', params: { newHomeLink: params.homeLink } };
    default:
      throw new Error('Unsupported proposal type');
  }
}

function SummaryTile({ label, value, hint }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-base font-semibold text-slate-900">{value}</span>
      {hint ? <span className={text.hint}>{hint}</span> : null}
    </div>
  );
}

function FormSection({ title, description, children }) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        {description ? <p className="text-sm text-slate-600">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function NewProposalPage({
  ethers,
  signer,
  templAddress,
  readProvider,
  onConnectWallet,
  pushMessage,
  onNavigate
}) {
  const [proposalType, setProposalType] = useState('pause');
  const [newPriest, setNewPriest] = useState('');
  const [maxMembers, setMaxMembers] = useState('');
  const [votingPeriod, setVotingPeriod] = useState('0');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [homeLink, setHomeLink] = useState('');
  const [withdrawToken, setWithdrawToken] = useState('');
  const [withdrawRecipient, setWithdrawRecipient] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const [withdrawPercent, setWithdrawPercent] = useState(0);
  const [disbandTokenMode, setDisbandTokenMode] = useState('accessToken');
  const [disbandCustomToken, setDisbandCustomToken] = useState('');
  const [updateEntryFee, setUpdateEntryFee] = useState('');
  const [updateFeeSplit, setUpdateFeeSplit] = useState(false);
  const [updateBurnPercent, setUpdateBurnPercent] = useState('');
  const [updateTreasuryPercent, setUpdateTreasuryPercent] = useState('');
  const [updateMemberPercent, setUpdateMemberPercent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [protocolPercent, setProtocolPercent] = useState(null);
  const [treasurySnapshot, setTreasurySnapshot] = useState({
    tokenAddress: '',
    tokenSymbol: '',
    tokenDecimals: 18,
    treasuryBalanceRaw: '0',
    treasuryBalanceFormatted: '0'
  });
  const [governanceInfo, setGovernanceInfo] = useState({
    defaultVotingPeriod: 7 * 24 * 60 * 60,
    minVotingPeriod: 7 * 24 * 60 * 60,
    maxVotingPeriod: 30 * 24 * 60 * 60,
    quorumPercent: 0,
    executionDelay: 0
  });

  const requiresPriest = useMemo(() => proposalType === 'changePriest', [proposalType]);
  const requiresMaxMembers = useMemo(() => proposalType === 'setMaxMembers', [proposalType]);
  const requiresHomeLink = useMemo(() => proposalType === 'updateHomeLink', [proposalType]);
  const requiresWithdrawal = useMemo(() => proposalType === 'withdrawTreasury', [proposalType]);
  const requiresDisband = useMemo(() => proposalType === 'disbandTreasury', [proposalType]);
  const requiresConfigUpdate = useMemo(() => proposalType === 'updateConfig', [proposalType]);
  const protocolPercentNumber = useMemo(() => {
    if (protocolPercent === null || protocolPercent === undefined) {
      return null;
    }
    const parsed = Number(protocolPercent);
    return Number.isFinite(parsed) ? parsed : null;
  }, [protocolPercent]);
  const feeSplitTarget = useMemo(() => {
    if (protocolPercentNumber === null) {
      return 100;
    }
    const value = 100 - protocolPercentNumber;
    return value < 0 ? 0 : value;
  }, [protocolPercentNumber]);

  const availableTreasuryBalance = useMemo(() => {
    try {
      return BigInt(treasurySnapshot.treasuryBalanceRaw || '0');
    } catch {
      return 0n;
    }
  }, [treasurySnapshot.treasuryBalanceRaw]);

  const treasuryTokenDecimals = treasurySnapshot.tokenDecimals ?? 18;
  const treasuryTokenSymbol = treasurySnapshot.tokenSymbol || 'tokens';

  const formatTokenAmount = (amount) => {
    if (!amount) {
      return '0';
    }
    try {
      return ethers?.formatUnits ? ethers.formatUnits(amount, treasuryTokenDecimals) : amount.toString();
    } catch {
      return amount.toString();
    }
  };

  const amountFromPercent = useCallback((percent) => {
    if (availableTreasuryBalance === 0n) {
      return 0n;
    }
    const pct = percent < 0 ? 0 : percent > 100 ? 100 : percent;
    return (availableTreasuryBalance * BigInt(pct)) / 100n;
  }, [availableTreasuryBalance]);

  const currentPercentAmount = useMemo(() => amountFromPercent(withdrawPercent), [withdrawPercent, amountFromPercent]);
  const currentPercentAmountFormatted = formatTokenAmount(currentPercentAmount);

  const handleWithdrawAmountInput = (value) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setWithdrawPercent(0);
      setWithdrawAmount('');
      return;
    }
    try {
      let parsed = BigInt(trimmed);
      if (parsed <= 0n) {
        setWithdrawPercent(0);
        setWithdrawAmount('');
        return;
      }
      if (availableTreasuryBalance > 0n && parsed > availableTreasuryBalance) {
        parsed = availableTreasuryBalance;
      }
      setWithdrawAmount(parsed.toString());
      if (availableTreasuryBalance > 0n) {
        let percent = Number((parsed * 100n) / availableTreasuryBalance);
        if (!Number.isFinite(percent)) {
          percent = 0;
        }
        if (percent > 100) percent = 100;
        if (percent < 0) percent = 0;
        setWithdrawPercent(percent);
      } else {
        setWithdrawPercent(0);
      }
    } catch {
      setWithdrawAmount(trimmed);
    }
  };

  const handleWithdrawPercentChange = (value) => {
    const next = Number(value);
    if (!Number.isFinite(next)) {
      setWithdrawPercent(0);
      setWithdrawAmount('');
      return;
    }
    const clamped = Math.min(Math.max(Math.floor(next), 0), 100);
    setWithdrawPercent(clamped);
    const amount = amountFromPercent(clamped);
    setWithdrawAmount(amount.toString());
  };

  useEffect(() => {
    let cancelled = false;
    const provider = signer?.provider ?? readProvider;
    if (!ethers || !provider || !templAddress) {
      return undefined;
    }
    (async () => {
      try {
        const params = await fetchGovernanceParameters({
          ethers,
          provider,
          templAddress,
          templArtifact
        });
        if (params && !cancelled) {
          setGovernanceInfo((prev) => ({
            ...prev,
            ...params
          }));
        }
      } catch (err) {
        console.warn('[templ] Failed to load templ governance config', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ethers, signer, readProvider, templAddress]);

  useEffect(() => {
    let cancelled = false;
    const provider = signer?.provider ?? readProvider;
    if (!ethers || !provider || !templAddress) {
      return undefined;
    }
    (async () => {
      try {
        const stats = await fetchTemplStats({
          ethers,
          provider,
          templAddress
        });
        if (!stats || cancelled) {
          return;
        }
        setTreasurySnapshot({
          tokenAddress: stats.tokenAddress || '',
          tokenSymbol: stats.tokenSymbol || '',
          tokenDecimals: stats.tokenDecimals ?? 18,
          treasuryBalanceRaw: stats.treasuryBalanceRaw || '0',
          treasuryBalanceFormatted: stats.treasuryBalanceFormatted || '0'
        });
        setWithdrawToken((prev) => prev || stats.tokenAddress || '');
        setProtocolPercent(Number.isFinite(Number(stats.protocolPercent)) ? Number(stats.protocolPercent) : null);
      } catch (err) {
        console.warn('[templ] Failed to load templ treasury snapshot', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ethers, signer, readProvider, templAddress]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!signer) {
      onConnectWallet?.();
      return;
    }
    const nextTitle = title.trim();
    const nextDescription = description.trim();
    if (!nextTitle) {
      pushMessage?.('Proposal title is required');
      return;
    }
    setSubmitting(true);
    pushMessage?.('Submitting proposal…');
    try {
      const { action, params } = buildActionConfig(proposalType, {
        newPriest,
        maxMembers,
        homeLink,
        token: withdrawToken,
        recipient: withdrawRecipient,
        amount: withdrawAmount,
        reason: withdrawReason,
        tokenMode: disbandTokenMode,
        customToken: disbandCustomToken,
        entryFee: updateEntryFee,
        updateFeeSplit,
        burnPercent: updateBurnPercent,
        treasuryPercent: updateTreasuryPercent,
        memberPercent: updateMemberPercent
      }, { ethers, protocolPercent: protocolPercentNumber });
      const votingPeriodValue = Number(votingPeriod || '0');
      const result = await proposeVote({
        ethers,
        signer,
        templAddress,
        templArtifact,
        action,
        params,
        votingPeriod: Number.isFinite(votingPeriodValue) ? votingPeriodValue : 0,
        title: nextTitle,
        description: nextDescription
      });
      const proposalId = result?.proposalId ?? 'unknown';
      pushMessage?.(`Proposal created (id: ${proposalId})`);
      onNavigate?.(`/templs/${templAddress}/proposals/${proposalId}/vote`);
    } catch (err) {
      pushMessage?.(`Proposal failed: ${err?.message || err}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Create a proposal</h1>
          <p className="max-w-2xl text-sm text-slate-600">
            Outline the change, supply any required parameters, and choose a voting window that gives members enough time to respond.
          </p>
        </div>
        <span className={surface.pill}>Templ {templAddress}</span>
      </header>
      <section className={`${layout.card} space-y-4`}>
        <div className={layout.sectionHeader}>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Governance snapshot</h2>
            <p className={text.hint}>These values come directly from the templ contract.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SummaryTile label="Quorum requirement" value={`${governanceInfo.quorumPercent}%`} hint="Minimum YES voting power" />
          <SummaryTile label="Execution delay" value={formatDuration(governanceInfo.executionDelay)} hint="Wait before execution" />
          <SummaryTile
            label="Voting window range"
            value={`${formatDuration(governanceInfo.minVotingPeriod)} – ${formatDuration(governanceInfo.maxVotingPeriod)}`}
            hint="Allowed minimum and maximum voting periods"
          />
        </div>
        <p className={text.hint}>
          Leave the voting period blank to use the default of {governanceInfo.defaultVotingPeriod} seconds ({formatDuration(governanceInfo.defaultVotingPeriod)}).
        </p>
      </section>
      <form className={`${layout.card} space-y-6`} onSubmit={handleSubmit}>
        <FormSection
          title="Proposal basics"
          description="Give members context so the change is easy to evaluate."
        >
          <label className={form.label}>
            Title
            <input
              type="text"
              className={form.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short summary"
            />
          </label>
          <label className={form.label}>
            Description
            <textarea
              className={`${form.textarea} min-h-[120px]`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Explain the motivation, impact, and any risks"
            />
          </label>
          <label className={form.label}>
            Proposal type
            <select
              className={`${form.input} appearance-none`}
              value={proposalType}
              onChange={(e) => setProposalType(e.target.value)}
            >
              {ACTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </FormSection>
        <FormSection
          title="Action configuration"
          description="Provide the inputs required for the selected action."
        >
          {requiresPriest && (
            <label className={form.label}>
              New priest address
              <input
                type="text"
                className={form.input}
                value={newPriest}
                onChange={(e) => setNewPriest(e.target.value.trim())}
                placeholder="0x…"
              />
            </label>
          )}
          {requiresMaxMembers && (
            <label className={form.label}>
              Max members
              <input
                type="text"
                className={form.input}
                value={maxMembers}
                onChange={(e) => setMaxMembers(e.target.value.trim())}
                placeholder="0 for unlimited"
              />
            </label>
          )}
          {requiresHomeLink && (
            <label className={form.label}>
              New home link
              <input
                type="text"
                className={form.input}
                value={homeLink}
                onChange={(e) => setHomeLink(e.target.value.trim())}
                placeholder="https://t.me/..."
              />
            </label>
          )}
          {requiresWithdrawal && (
            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">Treasury available</span>
                <span className="font-semibold text-slate-900">
                  {treasurySnapshot.treasuryBalanceFormatted} {treasuryTokenSymbol}
                </span>
              </div>
              <div className="space-y-3">
                <label className={form.label}>
                  Withdrawal token (address or "ETH")
                  <input
                    type="text"
                    className={form.input}
                    value={withdrawToken}
                    onChange={(e) => setWithdrawToken(e.target.value.trim())}
                    placeholder="0x… or ETH"
                  />
                  {treasurySnapshot.tokenAddress && (
                    <span className={text.hint}>Access token: {treasurySnapshot.tokenAddress}</span>
                  )}
                </label>
                <label className={form.label}>
                  Withdrawal recipient
                  <input
                    type="text"
                    className={form.input}
                    value={withdrawRecipient}
                    onChange={(e) => setWithdrawRecipient(e.target.value.trim())}
                    placeholder="0x…"
                  />
                </label>
                <label className={form.label}>
                  Withdrawal amount (wei)
                  <input
                    type="text"
                    className={form.input}
                    value={withdrawAmount}
                    onChange={(e) => handleWithdrawAmountInput(e.target.value)}
                    placeholder="Raw units"
                  />
                  <span className={text.hint}>
                    Use the slider to estimate an amount based on current treasury balance.
                  </span>
                </label>
                <div>
                  <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                    <span>Percent of treasury</span>
                    <span>{withdrawPercent}% · {currentPercentAmountFormatted} {treasuryTokenSymbol}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={withdrawPercent}
                    onChange={(e) => handleWithdrawPercentChange(e.target.value)}
                    className="mt-2 w-full accent-primary"
                    disabled={availableTreasuryBalance === 0n}
                  />
                  {availableTreasuryBalance === 0n && (
                    <p className="mt-2 text-xs text-slate-500">No treasury balance is currently available to withdraw.</p>
                  )}
                </div>
                <label className={form.label}>
                  Withdrawal reason
                  <textarea
                    className={`${form.textarea} min-h-[80px]`}
                    value={withdrawReason}
                    onChange={(e) => setWithdrawReason(e.target.value)}
                    placeholder="Explain why funds are being moved"
                  />
                  <span className={text.hint}>Optional context members will see before voting.</span>
                </label>
              </div>
            </div>
          )}
          {requiresDisband && (
            <div className="grid gap-4 md:grid-cols-2">
              <label className={form.label}>
                Treasury token source
                <select
                  className={`${form.input} appearance-none`}
                  value={disbandTokenMode}
                  onChange={(e) => setDisbandTokenMode(e.target.value)}
                >
                  <option value="accessToken">Use templ access token</option>
                  <option value="eth">Native ETH</option>
                  <option value="custom">Custom token address</option>
                </select>
              </label>
              {disbandTokenMode === 'custom' && (
                <label className={form.label}>
                  Custom token address
                  <input
                    type="text"
                    className={form.input}
                    value={disbandCustomToken}
                    onChange={(e) => setDisbandCustomToken(e.target.value.trim())}
                    placeholder="0x…"
                  />
                </label>
              )}
            </div>
          )}
          {requiresConfigUpdate && (
            <div className="space-y-4">
              <label className={form.label}>
                New entry fee (wei)
                <input
                  type="text"
                  className={form.input}
                  value={updateEntryFee}
                  onChange={(e) => setUpdateEntryFee(e.target.value.trim())}
                  placeholder="Leave blank to keep current fee"
                />
              </label>
              <label className={form.checkbox}>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                  checked={updateFeeSplit}
                  onChange={(e) => setUpdateFeeSplit(e.target.checked)}
                />
                Update fee split
              </label>
              {updateFeeSplit && (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className={form.label}>
                      Burn percent
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className={form.input}
                        value={updateBurnPercent}
                        onChange={(e) => setUpdateBurnPercent(e.target.value)}
                      />
                    </label>
                    <label className={form.label}>
                      Treasury percent
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className={form.input}
                        value={updateTreasuryPercent}
                        onChange={(e) => setUpdateTreasuryPercent(e.target.value)}
                      />
                    </label>
                    <label className={form.label}>
                      Member pool percent
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className={form.input}
                        value={updateMemberPercent}
                        onChange={(e) => setUpdateMemberPercent(e.target.value)}
                      />
                    </label>
                  </div>
                  <p className={text.hint}>
                    Burn + treasury + member pool must total {feeSplitTarget}%{protocolPercentNumber !== null ? ` (protocol keeps ${protocolPercentNumber}%)` : ''}.
                  </p>
                </>
              )}
            </div>
          )}
          {!(requiresPriest || requiresMaxMembers || requiresHomeLink || requiresWithdrawal || requiresDisband || requiresConfigUpdate) && (
            <p className={text.hint}>No additional parameters required for this proposal type.</p>
          )}
        </FormSection>
        <FormSection
          title="Voting schedule"
          description="Choose how long members have to vote before the proposal closes."
        >
          <label className={form.label}>
            Voting period (seconds)
            <input
              type="number"
              min="0"
              className={form.input}
              value={votingPeriod}
              onChange={(e) => setVotingPeriod(e.target.value)}
            />
            <span className={text.hint}>
              Enter 0 to fall back to the default of {governanceInfo.defaultVotingPeriod} seconds ({formatDuration(governanceInfo.defaultVotingPeriod)}).
            </span>
          </label>
        </FormSection>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={button.primary} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Create proposal'}
          </button>
          <span className={text.hint}>Your connected wallet will sign the transaction.</span>
        </div>
      </form>
    </div>
  );
}
