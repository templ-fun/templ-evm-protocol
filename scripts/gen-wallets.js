#!/usr/bin/env node
/*
 Generate fresh local wallets and fund them from Hardhat #0.
 Usage:
   node scripts/gen-wallets.js [count]
   node scripts/gen-wallets.js 3 --token <erc20_address>

 Writes wallets.local.json at repo root and prints the keys.
*/
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

async function main() {
  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const countArg = Number(process.argv[2] || '3');
  const count = Number.isFinite(countArg) && countArg > 0 ? countArg : 3;
  const args = process.argv.slice(3);
  let tokenAddress = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--token' && args[i+1]) { tokenAddress = args[i+1]; i++; }
  }

  // Hardhat account #0
  const FUNDER_PK = process.env.FUNDER_PK || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const funder = new ethers.Wallet(FUNDER_PK, provider);

  const chain = await provider.getNetwork().catch(() => ({ chainId: 0n }));
  if (chain.chainId !== 1337n) {
    console.warn('[warn] This script is intended for Hardhat localhost (chainId 1337). Proceeding anyway.');
  }

  const wallets = [];
  for (let i = 0; i < count; i++) {
    wallets.push(ethers.Wallet.createRandom());
  }

  // Fund each wallet with 100 ETH
  let nonce = await funder.getNonce();
  const amount = ethers.parseEther('100');
  console.log(`[gen-wallets] Funding ${count} wallets from ${await funder.getAddress()} with 100 ETH each...`);
  for (const w of wallets) {
    const to = await w.getAddress();
    const tx = await funder.sendTransaction({ to, value: amount, nonce: nonce++ });
    await tx.wait();
  }

  // Optionally mint ERC-20 if a TestToken-like contract is provided
  if (tokenAddress && ethers.isAddress(tokenAddress)) {
    try {
      console.log(`[gen-wallets] Minting TestToken to new wallets at ${tokenAddress} ...`);
      const erc20 = new ethers.Contract(tokenAddress, [
        'function mint(address to, uint256 amount)',
        'function decimals() view returns (uint8)'
      ], funder);
      let decimals = 18;
      try { decimals = await erc20.decimals(); } catch {}
      const qty = ethers.parseUnits('1000000', decimals);
      let n2 = await funder.getNonce();
      for (const w of wallets) {
        const to = await w.getAddress();
        const tx = await erc20.mint(to, qty, { nonce: n2++ });
        await tx.wait();
      }
    } catch (e) {
      console.warn('[warn] ERC-20 mint failed:', e?.message || e);
    }
  }

  const out = {
    date: new Date().toISOString(),
    rpcUrl,
    chainId: Number(chain.chainId || 0n),
    wallets: wallets.map((w, i) => ({
      role: i === 0 ? 'priest' : i === 1 ? 'member' : i === 2 ? 'delegate' : `wallet_${i+1}`,
      privateKey: w.privateKey,
      address: w.address
    }))
  };
  const file = path.join(process.cwd(), 'wallets.local.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\n[gen-wallets] Wrote ${file}`);
  console.log('\nImport these keys in MetaMask (Hardhat network):');
  for (const w of out.wallets) {
    console.log(`- ${w.role}: ${w.address}  pk=${w.privateKey}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

