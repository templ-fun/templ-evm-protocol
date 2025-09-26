import { useState } from 'react';
import templArtifact from '../contracts/TEMPL.json';
import { voteOnProposal } from '../services/governance.js';
import { button, form, layout, surface } from '../ui/theme.js';

export function VoteProposalPage({
  ethers,
  signer,
  templAddress,
  proposalId,
  onConnectWallet,
  pushMessage
}) {
  const [support, setSupport] = useState('yes');
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!signer) {
      onConnectWallet?.();
      return;
    }
    setPending(true);
    pushMessage?.('Casting vote…');
    try {
      await voteOnProposal({
        ethers,
        signer,
        templAddress,
        templArtifact,
        proposalId,
        support: support === 'yes'
      });
      pushMessage?.('Vote submitted');
    } catch (err) {
      pushMessage?.(`Vote failed: ${err?.message || err}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={layout.page}>
      <header className={layout.header}>
        <h1 className="text-3xl font-semibold tracking-tight">Vote on Proposal</h1>
        <span className={surface.pill}>Templ {templAddress}</span>
      </header>
      <form className={`${layout.card} flex flex-col gap-4`} onSubmit={handleSubmit}>
        <p className="text-sm text-slate-600">Proposal #{proposalId}</p>
        <label className={form.radio}>
          <input
            type="radio"
            name="support"
            value="yes"
            className="h-4 w-4 border-slate-300 text-primary focus:ring-primary"
            checked={support === 'yes'}
            onChange={(e) => setSupport(e.target.value)}
          />
          Yes
        </label>
        <label className={form.radio}>
          <input
            type="radio"
            name="support"
            value="no"
            className="h-4 w-4 border-slate-300 text-primary focus:ring-primary"
            checked={support === 'no'}
            onChange={(e) => setSupport(e.target.value)}
          />
          No
        </label>
        <button type="submit" className={button.primary} disabled={pending}>
          {pending ? 'Submitting…' : 'Submit vote'}
        </button>
      </form>
    </div>
  );
}
