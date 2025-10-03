import { useCallback, useEffect, useMemo, useState } from 'react';
import templArtifact from '../contracts/TEMPL.json';
import { fetchGovernanceParameters, proposeVote } from '../services/governance.js';
import { fetchTemplStats } from '../services/templs.js';
import { button, form, layout, surface, text } from '../ui/theme.js';
import { formatDuration } from '../ui/format.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const CURVE_STYLE_INDEX = {
  static: 0,
  linear: 1,
  exponential: 2
};
const CURVE_STYLE_OPTIONS = [
  { value: 'static', label: 'Static (no change)' },
  { value: 'linear', label: 'Linear' },
  { value: 'exponential', label: 'Exponential' }
];

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
  { value: 'updateHomeLink', label: 'Update templ home link' },
  { value: 'setEntryFeeCurve', label: 'Update entry fee curve' }
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
  const resolveCurveStyleValue = (styleKey) => {
    switch (styleKey) {
      case 'linear':
        return CURVE_STYLE_INDEX.linear;
      case 'exponential':
        return CURVE_STYLE_INDEX.exponential;
      default:
        return CURVE_STYLE_INDEX.static;
    }
  };
  const parseCurveRate = (value, styleKey) => {
    const parsed = Number.parseInt(String(value ?? '0'), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    if (styleKey === 'static') {
      return 0;
    }
    return Math.min(parsed, 1_000_000);
  };
  switch (kind) {
    case 'pause':
      return { action: 'setJoinPaused', params: { paused: true } };
    case 'unpause':
      return { action: 'setJoinPaused', params: { paused: false } };
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
        const toBps = (value) => value * 100;
        nextParams.updateFeeSplit = true;
        nextParams.newBurnPercent = toBps(burn);
        nextParams.newTreasuryPercent = toBps(treasury);
        nextParams.newMemberPoolPercent = toBps(member);
      }
      if (!('newEntryFee' in nextParams) && !shouldUpdateSplit) {
        throw new Error('Provide at least one config change');
      }
      return { action: 'updateConfig', params: nextParams };
    }
    case 'updateHomeLink':
      if (!params.homeLink) throw new Error('Home link is required');
      return { action: 'setHomeLink', params: { newHomeLink: params.homeLink } };
    case 'setEntryFeeCurve': {
      const baseEntryFee = parseBigInt(params.curveBaseEntryFee, 'base entry fee', { allowZero: false });
      const curve = {
        primary: {
          style: resolveCurveStyleValue(params.curvePrimaryStyle),
          rateBps: parseCurveRate(params.curvePrimaryRateBps, params.curvePrimaryStyle)
        }
      };
      return {
        action: 'setEntryFeeCurve',
        params: {
          curve,
          baseEntryFee
        }
      };
    }
    default:
      throw new Error('Unsupported proposal type');
  }
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
  const [curvePrimaryStyle, setCurvePrimaryStyle] = useState('exponential');
  const [curvePrimaryRateBps, setCurvePrimaryRateBps] = useState('11000');
  const [curveUpdateBase, setCurveUpdateBase] = useState(false);
  const [curveBaseEntryFee, setCurveBaseEntryFee] = useState('0');
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
    executionDelay: 0,
    baseEntryFee: null
  });

  const requiresPriest = useMemo(() => proposalType === 'changePriest', [proposalType]);
  const requiresMaxMembers = useMemo(() => proposalType === 'setMaxMembers', [proposalType]);
  const requiresHomeLink = useMemo(() => proposalType === 'updateHomeLink', [proposalType]);
  const requiresWithdrawal = useMemo(() => proposalType === 'withdrawTreasury', [proposalType]);
  const requiresDisband = useMemo(() => proposalType === 'disbandTreasury', [proposalType]);
  const requiresConfigUpdate = useMemo(() => proposalType === 'updateConfig', [proposalType]);
  const requiresCurveUpdate = useMemo(() => proposalType === 'setEntryFeeCurve', [proposalType]);
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
          if (params.baseEntryFee) {
            setCurveBaseEntryFee((prev) => (prev && prev !== '0' ? prev : params.baseEntryFee));
          }
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
      const baseEntryFeeValue = (() => {
        const raw = String(curveBaseEntryFee ?? '').trim();
        if (raw) return raw;
        const fallback = governanceInfo.baseEntryFee;
        return fallback ? String(fallback) : '0';
      })();
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
        memberPercent: updateMemberPercent,
        curvePrimaryStyle,
        curvePrimaryRateBps,
        curveBaseEntryFee: baseEntryFeeValue
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
        <h1 className="text-3xl font-semibold tracking-tight">New Proposal</h1>
        <span className={surface.pill}>Templ {templAddress}</span>
      </header>
      <section className={`${layout.card} space-y-3 text-sm text-slate-700`}>
        <h2 className="text-base font-semibold text-slate-900">Governance basics</h2>
        <p>
          Quorum is satisfied when YES votes represent at least{' '}
          <strong>{governanceInfo.quorumPercent}%</strong> of the eligible members captured when the proposal was
          created. Once quorum is achieved, the proposal waits{' '}
          <strong>{formatDuration(governanceInfo.executionDelay)}</strong> before it can be executed, provided YES votes
          still outnumber NO votes.
        </p>
        <p className={text.subtle}>
          Leaving the voting period blank or setting it to 0 seconds will use the templ default of{' '}
          <strong>
            {governanceInfo.defaultVotingPeriod} seconds ({formatDuration(governanceInfo.defaultVotingPeriod)})
          </strong>
          . Voting windows must be at least{' '}
          <strong>
            {governanceInfo.minVotingPeriod} seconds ({formatDuration(governanceInfo.minVotingPeriod)})
          </strong>{' '}
          and no longer than{' '}
          <strong>
            {governanceInfo.maxVotingPeriod} seconds ({formatDuration(governanceInfo.maxVotingPeriod)})
          </strong>
          .
        </p>
      </section>
      <form className={`${layout.card} flex flex-col gap-4`} onSubmit={handleSubmit}>
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
            placeholder="Explain the proposal"
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
          <div className="space-y-4">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-slate-600">Treasury available</span>
                <span className="font-semibold text-slate-900">
                  {treasurySnapshot.treasuryBalanceFormatted} {treasuryTokenSymbol}
                </span>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                  <span>Withdraw percentage</span>
                  <span>
                    {withdrawPercent}% · {currentPercentAmountFormatted} {treasuryTokenSymbol}
                  </span>
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
            </div>
            <div className="grid gap-4 md:grid-cols-2">
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
                  <span className={text.hint}>
                    Defaults to {treasurySnapshot.tokenAddress}
                  </span>
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
                  placeholder="1000000000000000000"
                />
              </label>
              <label className={form.label}>
                Withdrawal reason
                <textarea
                  className={`${form.textarea} min-h-[80px]`}
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                  placeholder="Explain the withdrawal"
                />
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
            )}
            {updateFeeSplit && (
              <p className={text.hint}>
                Burn + treasury + member pool must total {feeSplitTarget}%
                {protocolPercentNumber !== null ? ` (protocol keeps ${protocolPercentNumber}%)` : ''}.
              </p>
            )}
          </div>
        )}
        {requiresCurveUpdate && (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <p>
                Define how the entry fee should evolve. Enable "Update base entry fee" to recalibrate the curve using a new
                anchor. When disabled, the existing base entry fee is preserved.
              </p>
            </div>
            <label className={form.checkbox}>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                checked={curveUpdateBase}
                onChange={(event) => setCurveUpdateBase(event.target.checked)}
              />
              Update base entry fee
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className={form.label}>
                Base entry fee (wei)
                <input
                  type="text"
                  className={form.input}
                  value={curveBaseEntryFee}
                  onChange={(event) => setCurveBaseEntryFee(event.target.value.trim())}
                  disabled={!curveUpdateBase}
                />
                <span className={text.hint}>
                  Defaulted to the current base entry fee. Enable editing to recalibrate the curve anchor.
                </span>
              </label>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <label className={form.label}>
                Primary style
                <select
                  className={form.input}
                  value={curvePrimaryStyle}
                  onChange={(event) => {
                    const next = event.target.value;
                    setCurvePrimaryStyle(next);
                    if (next === 'static') {
                      setCurvePrimaryRateBps('0');
                    } else if (curvePrimaryRateBps === '0') {
                      setCurvePrimaryRateBps(next === 'exponential' ? '11000' : '500');
                    }
                  }}
                >
                  {CURVE_STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={form.label}>
                Primary rate (basis points)
                <input
                  type="number"
                  min="0"
                  className={form.input}
                  value={curvePrimaryRateBps}
                  onChange={(event) => setCurvePrimaryRateBps(event.target.value)}
                  disabled={curvePrimaryStyle === 'static'}
                />
              </label>
            </div>
          </div>
        )}
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
            Enter 0 to fall back to {governanceInfo.defaultVotingPeriod} seconds ({formatDuration(governanceInfo.defaultVotingPeriod)}).
          </span>
        </label>
        <button type="submit" className={button.primary} disabled={submitting}>
          {submitting ? 'Submitting…' : 'Create proposal'}
        </button>
      </form>
    </div>
  );
}
