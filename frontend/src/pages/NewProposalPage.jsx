import { useMemo, useState } from 'react';
import templArtifact from '../contracts/TEMPL.json';
import { proposeVote } from '../services/governance.js';

const ACTIONS = [
  { value: 'pause', label: 'Pause templ' },
  { value: 'unpause', label: 'Unpause templ' },
  { value: 'changePriest', label: 'Change priest' },
  { value: 'setMaxMembers', label: 'Set max members' },
  { value: 'enableDictatorship', label: 'Enable dictatorship' },
  { value: 'disableDictatorship', label: 'Disable dictatorship' }
];

function buildActionConfig(kind, params) {
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
    default:
      throw new Error('Unsupported proposal type');
  }
}

export function NewProposalPage({
  ethers,
  signer,
  templAddress,
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
  const [submitting, setSubmitting] = useState(false);

  const requiresPriest = useMemo(() => proposalType === 'changePriest', [proposalType]);
  const requiresMaxMembers = useMemo(() => proposalType === 'setMaxMembers', [proposalType]);

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
        maxMembers
      });
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
    <div className="page">
      <header className="page-header">
        <h1>New Proposal</h1>
        <span className="pill">Templ {templAddress}</span>
      </header>
      <form className="card form" onSubmit={handleSubmit}>
        <label>
          Title
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" />
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Explain the proposal" />
        </label>
        <label>
          Proposal type
          <select value={proposalType} onChange={(e) => setProposalType(e.target.value)}>
            {ACTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        {requiresPriest && (
          <label>
            New priest address
            <input type="text" value={newPriest} onChange={(e) => setNewPriest(e.target.value.trim())} placeholder="0x…" />
          </label>
        )}
        {requiresMaxMembers && (
          <label>
            Max members
            <input type="text" value={maxMembers} onChange={(e) => setMaxMembers(e.target.value.trim())} placeholder="0 for unlimited" />
          </label>
        )}
        <label>
          Voting period (seconds)
          <input type="number" min="0" value={votingPeriod} onChange={(e) => setVotingPeriod(e.target.value)} />
        </label>
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Create proposal'}
        </button>
      </form>
    </div>
  );
}
