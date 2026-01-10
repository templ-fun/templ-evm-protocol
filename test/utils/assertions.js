const { expect } = require("chai");

async function expectProposalBasics({ templ, id, proposer, title, description, action }) {
  const proposal = await templ.proposals(id);
  expect(proposal.proposer).to.equal(proposer);
  if (title !== undefined) {
    expect(proposal.title).to.equal(title);
  }
  if (description !== undefined) {
    expect(proposal.description).to.equal(description);
  }
  if (action !== undefined) {
    expect(BigInt(proposal.action)).to.equal(BigInt(action));
  }
  return proposal;
}

async function expectProposalExecuted({ templ, id }) {
  const proposal = await templ.getProposal(id);
  expect(proposal.executed).to.equal(true);
  expect(await templ.hasActiveProposal(proposal.proposer)).to.equal(false);
  expect(await templ.activeProposalId(proposal.proposer)).to.equal(0n);
  return proposal;
}

module.exports = {
  expectProposalBasics,
  expectProposalExecuted,
};
