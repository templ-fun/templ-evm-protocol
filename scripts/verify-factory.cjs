const hre = require("hardhat");
require("dotenv").config();

function normalizeNetworkName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveNetworkName(network) {
  const envNetwork = normalizeNetworkName(process.env.HARDHAT_NETWORK);
  if (envNetwork) return envNetwork;
  const hreNetwork = normalizeNetworkName(hre.network?.name);
  if (hreNetwork) return hreNetwork;
  const providerName = normalizeNetworkName(network?.name);
  if (providerName) return providerName;
  return "hardhat";
}

function readCliOption(argv, flags) {
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (!flags.includes(current)) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('-')) {
      return next;
    }
  }
  return undefined;
}

function pickFactoryAddress(argv) {
  const cli = readCliOption(argv, ['--factory', '--address']);
  if (cli) return cli;
  const envAddress = process.env.FACTORY_ADDRESS;
  if (envAddress) return envAddress;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg && !arg.startsWith('-')) {
      return arg;
    }
  }
  return undefined;
}

async function main() {
  const factoryAddressRaw = pickFactoryAddress(process.argv);
  if (!factoryAddressRaw) {
    throw new Error(
      'FACTORY_ADDRESS must be set (Hardhat run blocks custom flags). Use FACTORY_ADDRESS=0x... npm run verify:factory'
    );
  }
  const factoryAddress = hre.ethers.getAddress(factoryAddressRaw);

  const provider = hre.ethers.provider;
  const network = await provider.getNetwork();
  const networkName = resolveNetworkName(network);
  console.log(`Using Hardhat network: ${networkName} (chainId ${network.chainId})`);
  const code = await provider.getCode(factoryAddress);
  if (!code || code === '0x') {
    const chain = network?.chainId ? String(network.chainId) : 'unknown chain';
    throw new Error(
      `No contract code at ${factoryAddress} while connected to "${networkName}" (chain ${chain}). Ensure HARDHAT_NETWORK is set to the correct network (or pass --network ${networkName}) and provide a valid FACTORY_ADDRESS.`
    );
  }

  const factory = await hre.ethers.getContractAt('TemplFactory', factoryAddress);

  const factoryDeployer = await factory.factoryDeployer();
  const protocolFeeRecipient = await factory.PROTOCOL_FEE_RECIPIENT();
  const protocolBps = await factory.PROTOCOL_BPS();
  const membershipModule = await factory.MEMBERSHIP_MODULE();
  const treasuryModule = await factory.TREASURY_MODULE();
  const governanceModule = await factory.GOVERNANCE_MODULE();
  const councilModule = await factory.COUNCIL_MODULE();
  const templDeployer = await factory.TEMPL_DEPLOYER();

  console.log('Verifying TemplFactory with constructor arguments:');
  console.table({
    factoryDeployer,
    protocolFeeRecipient,
    protocolBps: protocolBps.toString(),
    membershipModule,
    treasuryModule,
    governanceModule,
    councilModule,
    templDeployer
  });

  const constructorArguments = [
    factoryDeployer,
    protocolFeeRecipient,
    protocolBps,
    membershipModule,
    treasuryModule,
    governanceModule,
    councilModule,
    templDeployer
  ];

  try {
    // Verify modules first (no constructor args)
    console.log('Verifying modules...');
    try {
      await hre.run('verify:verify', {
        address: membershipModule,
        contract: 'contracts/TemplMembership.sol:TemplMembershipModule'
      });
      console.log(`Verified Membership module at ${membershipModule}`);
    } catch (err) {
      const message = err?.message || String(err);
      if (/already verified/i.test(message)) {
        console.log(`Membership module ${membershipModule} is already verified.`);
      } else {
        throw err;
      }
    }
    try {
      await hre.run('verify:verify', {
        address: treasuryModule,
        contract: 'contracts/TemplTreasury.sol:TemplTreasuryModule'
      });
      console.log(`Verified Treasury module at ${treasuryModule}`);
    } catch (err) {
      const message = err?.message || String(err);
      if (/already verified/i.test(message)) {
        console.log(`Treasury module ${treasuryModule} is already verified.`);
      } else {
        throw err;
      }
    }
    try {
      await hre.run('verify:verify', {
        address: governanceModule,
        contract: 'contracts/TemplGovernance.sol:TemplGovernanceModule'
      });
      console.log(`Verified Governance module at ${governanceModule}`);
    } catch (err) {
      const message = err?.message || String(err);
      if (/already verified/i.test(message)) {
        console.log(`Governance module ${governanceModule} is already verified.`);
      } else {
        throw err;
      }
    }
    try {
      await hre.run('verify:verify', {
        address: councilModule,
        contract: 'contracts/TemplCouncil.sol:TemplCouncilModule'
      });
      console.log(`Verified Council module at ${councilModule}`);
    } catch (err) {
      const message = err?.message || String(err);
      if (/already verified/i.test(message)) {
        console.log(`Council module ${councilModule} is already verified.`);
      } else {
        throw err;
      }
    }
    try {
      await hre.run('verify:verify', {
        address: templDeployer,
        contract: 'contracts/TemplDeployer.sol:TemplDeployer'
      });
      console.log(`Verified TemplDeployer at ${templDeployer}`);
    } catch (err) {
      const message = err?.message || String(err);
      if (/already verified/i.test(message)) {
        console.log(`TemplDeployer ${templDeployer} is already verified.`);
      } else {
        throw err;
      }
    }

    await hre.run('verify:verify', {
      address: factoryAddress,
      contract: 'contracts/TemplFactory.sol:TemplFactory',
      constructorArguments
    });
    console.log(`Verification submitted for ${factoryAddress}`);
  } catch (err) {
    const message = err?.message || String(err);
    if (/already verified/i.test(message)) {
      console.log(`Contract ${factoryAddress} is already verified.`);
    } else {
      throw err;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Factory verification failed:', error);
    process.exit(1);
  });
