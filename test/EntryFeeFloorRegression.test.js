const { expect } = require("chai");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers } = require("./utils/mintAndPurchase");

describe("Entry fee floor invariants", function () {
  it("clamps decaying exponential curves to the minimum entry fee", async function () {
    const curve = { primary: { style: 2, rateBps: 50, length: 0 }, additionalSegments: [] };
    const entryFee = 10n;
    const { templ, token, accounts } = await deployTempl({ entryFee, curve });
    const [, , member] = accounts;

    await mintToUsers(token, [member], 1000n);

    const templAddress = await templ.getAddress();
    await token.connect(member).approve(templAddress, entryFee);
    await templ.connect(member).join();

    const nextFee = await templ.entryFee();
    expect(nextFee).to.equal(10n);
    expect(nextFee % 10n).to.equal(0n);
  });
});
