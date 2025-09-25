import { useState } from 'react';
import templArtifact from '../contracts/TEMPL.json';
import { voteOnProposal } from '../services/governance.js';

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
    <div className="page">
      <header className="page-header">
        <h1>Vote on Proposal</h1>
        <span className="pill">Templ {templAddress}</span>
      </header>
      <form className="card form" onSubmit={handleSubmit}>
        <p>Proposal #{proposalId}</p>
        <label className="radio">
          <input type="radio" name="support" value="yes" checked={support === 'yes'} onChange={(e) => setSupport(e.target.value)} /> Yes
        </label>
        <label className="radio">
          <input type="radio" name="support" value="no" checked={support === 'no'} onChange={(e) => setSupport(e.target.value)} /> No
        </label>
        <button type="submit" className="primary" disabled={pending}>
          {pending ? 'Submitting…' : 'Submit vote'}
        </button>
      </form>
    </div>
  );
}
