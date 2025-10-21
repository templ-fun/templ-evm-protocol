const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { attachTemplInterface } = require("./templ");

const STATIC_CURVE = {
  primary: { style: 0, rateBps: 0, length: 0 },
  additionalSegments: []
};

const EXPONENTIAL_CURVE = {
  primary: { style: 2, rateBps: 11_000, length: 0 },
  additionalSegments: []
};

function normalizeCurve(curve) {
  if (!curve) {
    return {
      primary: { ...STATIC_CURVE.primary },
      additionalSegments: []
    };
  }
  const normalized = {
    primary: {
      style: curve.primary.style,
      rateBps: curve.primary.rateBps,
      length: curve.primary.length ?? 0
    },
    additionalSegments: []
  };
  const extras = curve.additionalSegments || [];
  if (extras.length > 0) {
    normalized.additionalSegments = extras.map((segment) => ({
      style: segment.style,
      rateBps: segment.rateBps,
      length: segment.length ?? 0
    }));
  }
  return normalized;
}

async function deployTemplContracts({
  entryFee = ethers.parseUnits("100", 18),
  burnBps = 3000,
  treasuryBps = 3000,
  memberPoolBps = 3000,
  protocolBps = 1000,
  quorumBps = 3300,
  executionDelay = 7 * 24 * 60 * 60,
  burnAddress = "0x000000000000000000000000000000000000dEaD",
  protocolFeeRecipient,
  priestIsDictator = false,
  maxMembers = 0,
  name = "Templ",
  description = "",
  logoLink = "",
  proposalFeeBps = 0,
  referralShareBps = 0,
  curve = STATIC_CURVE,
} = {}) {
  const accounts = await ethers.getSigners();
  const [owner, priest] = accounts;

  const Token = await ethers.getContractFactory(
    "contracts/mocks/TestToken.sol:TestToken"
  );
  const token = await Token.deploy("Test Token", "TEST", 18);
  await token.waitForDeployment();

  const MembershipModule = await ethers.getContractFactory("TemplMembershipModule");
  const membershipModule = await MembershipModule.deploy();
  await membershipModule.waitForDeployment();

  const TreasuryModule = await ethers.getContractFactory("TemplTreasuryModule");
  const treasuryModule = await TreasuryModule.deploy();
  await treasuryModule.waitForDeployment();

  const GovernanceModule = await ethers.getContractFactory("TemplGovernanceModule");
  const governanceModule = await GovernanceModule.deploy();
  await governanceModule.waitForDeployment();

  const TEMPL = await ethers.getContractFactory("TEMPL");
  const protocolRecipient = protocolFeeRecipient || priest.address;
  const normalizedCurve = normalizeCurve(curve);

  let templ = await TEMPL.deploy(
    priest.address,
    protocolRecipient,
    await token.getAddress(),
    entryFee,
    burnBps,
    treasuryBps,
    memberPoolBps,
    protocolBps,
    quorumBps,
    executionDelay,
    burnAddress,
    priestIsDictator,
    maxMembers,
    name,
    description,
    logoLink,
    proposalFeeBps,
    referralShareBps,
    await membershipModule.getAddress(),
    await treasuryModule.getAddress(),
    await governanceModule.getAddress(),
    normalizedCurve
  );
  await templ.waitForDeployment();
  templ = await attachTemplInterface(templ);
  try {
    const { attachCreateProposalCompat, attachProposalMetadataShim } = require("./proposal");
    attachCreateProposalCompat(templ);
    attachProposalMetadataShim(templ);
  } catch {}

  return {
    templ,
    token,
    accounts,
    owner,
    priest,
  };
}

const fixtureCache = new Map();

function serializeOption(value) {
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (Array.isArray(value)) {
    return value.map(serializeOption);
  }
  if (value && typeof value === "object") {
    const ordered = {};
    for (const [key, val] of Object.entries(value).sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0))) {
      ordered[key] = serializeOption(val);
    }
    return ordered;
  }
  return value;
}

async function deployTempl(options = {}) {
  const key = JSON.stringify(serializeOption(options));
  let fixture = fixtureCache.get(key);
  if (!fixture) {
    const normalizedOptions = { ...options };
    fixture = async function templFixture() {
      return deployTemplContracts(normalizedOptions);
    };
    fixtureCache.set(key, fixture);
  }
  return loadFixture(fixture);
}

module.exports = {
  deployTempl,
  deployTemplContracts,
  STATIC_CURVE,
  EXPONENTIAL_CURVE,
};
