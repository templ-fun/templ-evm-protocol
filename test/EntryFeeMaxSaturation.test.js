const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Entry fee saturation at MAX_ENTRY_FEE", function () {
  it("linear growth saturates entry fee to the max divisible value when base near MAX", async function () {
    // Compute a base divisible by 10 but very close to 2^128 - 1
    const MAX128 = (1n << 128n) - 1n;
    const maxDivisible = MAX128 - (MAX128 % 10n);
    const base = maxDivisible;
    const linearCurve = { primary: { style: 1, rateBps: 100, length: 0 }, additionalSegments: [] };
    const { templ, token, accounts } = await deployTempl({ entryFee: base, curve: linearCurve });
    const [, , member] = accounts;
    await mintToUsers(token, [member], base);
    await joinMembers(templ, token, [member]);
    const nextFee = await templ.entryFee();
    expect(nextFee).to.equal(maxDivisible);
  });
});
