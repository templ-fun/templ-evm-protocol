const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployTempl } = require('./utils/deploy');
const { mintToUsers, purchaseAccess } = require('./utils/mintAndPurchase');

describe('Proposal metadata', function () {
  it('stores title and description on-chain and in events', async function () {
    const { templ, token, accounts } = await deployTempl();
    const [, , member] = accounts;

    await mintToUsers(token, [member], ethers.parseUnits('10000', 18));
    await purchaseAccess(templ, token, [member]);

    const title = 'Pause templ';
    const description = 'Pause operations while investigating issues';

    const tx = await templ
      .connect(member)
      .createProposalSetPaused(true, 7 * 24 * 60 * 60, title, description);
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((log) => {
        try {
          return templ.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === 'ProposalCreated');

    expect(event, 'ProposalCreated event emitted').to.exist;
    expect(event.args.proposalId).to.equal(0);
    expect(event.args.title).to.equal(title);
    expect(event.args.description).to.equal(description);

    const proposal = await templ.getProposal(0);
    expect(proposal.title).to.equal(title);
    expect(proposal.description).to.equal(description);
  });
});
