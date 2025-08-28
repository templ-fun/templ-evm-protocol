const { expect } = require("chai");

describe("deploy script fee split calculations", function () {
  it("calculates splits correctly for large ENTRY_FEE", function () {
    const ENTRY_FEE = "1000000000000000000000000000000000000";
    const entryFee = BigInt(ENTRY_FEE);
    const thirtyPercent = (entryFee * 30n) / 100n;
    const tenPercent = (entryFee * 10n) / 100n;

    expect(thirtyPercent.toString()).to.equal("300000000000000000000000000000000000");
    expect(tenPercent.toString()).to.equal("100000000000000000000000000000000000");
    expect(thirtyPercent * 3n + tenPercent).to.equal(entryFee);
  });
});
