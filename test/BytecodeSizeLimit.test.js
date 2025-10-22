const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const { deployTemplModules } = require("./utils/modules");
const { getTemplAt } = require("./utils/templ");

describe("Bytecode size limits", function () {
  this.timeout(120_000);

  it("deploys via factory and all deployed bytecode stays under 24,576 bytes", async function () {
    const [deployer, protocolFeeRecipient] = await ethers.getSigners();

    const TestToken = await ethers.getContractFactory("TestToken");
    const token = await TestToken.connect(deployer).deploy("Test Token", "TEST", 18);
    await token.waitForDeployment();

    const modules = await deployTemplModules();
    const TemplFactory = await ethers.getContractFactory("TemplFactory");
    const factory = await TemplFactory.connect(deployer).deploy(
      protocolFeeRecipient.address,
      1_000,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule
    );
    await factory.waitForDeployment();

    const tokenAddress = await token.getAddress();
    const predictedAddress = await factory
      .connect(deployer)
      .createTemplFor.staticCall(
        deployer.address,
        tokenAddress,
        10n,
        "Bytecode Size",
        "Limit check",
        "",
        0,
        0
      );

    const tx = await factory.connect(deployer).createTemplFor(
      deployer.address,
      tokenAddress,
      10n,
      "Bytecode Size",
      "Limit check",
      "",
      0,
      0
    );
    await tx.wait();

    expect(predictedAddress).to.be.properAddress;
    const templ = await getTemplAt(predictedAddress, ethers.provider);
    expect(await templ.accessToken()).to.equal(tokenAddress);

    const artifactBase = `${__dirname}/../artifacts/contracts`;
    const contractArtifacts = [
      ["TEMPL.sol", "TEMPL", "templ router"],
      ["TemplMembership.sol", "TemplMembershipModule", "membership module"],
      ["TemplTreasury.sol", "TemplTreasuryModule", "treasury module"],
      ["TemplGovernance.sol", "TemplGovernanceModule", "governance module"]
    ];
    const limit = 24_576; // EIP-170 deployed bytecode size limit
    const sizes = await Promise.all(
      contractArtifacts.map(async ([file, name]) => {
        const artifactPath = require("path").join(artifactBase, file, `${name}.json`);
        const artifact = JSON.parse(require("fs").readFileSync(artifactPath, "utf8"));
        const deployedBytecode = artifact.deployedBytecode || "0x";
        return (deployedBytecode.length - 2) / 2;
      })
    );

    const labels = contractArtifacts.map(([, , label]) => label);
    for (let index = 0; index < sizes.length; index += 1) {
      expect(sizes[index], `module ${labels[index]} exceeds deployment limit`).to.be.at.most(limit);
    }
  });
});

