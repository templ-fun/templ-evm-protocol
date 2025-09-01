import { test, expect, TestToken } from './fixtures.js'
import { ethers } from 'ethers'
import { readFileSync } from 'fs'
import path from 'path'

test('Governance lifecycle uses separate member signer', async ({ page, wallets }) => {
  // Deploy TestToken
  const tokenFactory = new ethers.ContractFactory(TestToken.abi, TestToken.bytecode, wallets.priest)
  const token = await tokenFactory.deploy('Test', 'TEST', 18)
  await token.waitForDeployment()
  const tokenAddress = await token.getAddress()

  // Mint tokens to member for governance actions
  const memberAddr = await wallets.member.getAddress()
  let tx = await token.connect(wallets.member).mint(memberAddr, ethers.parseEther('1000'))
  await tx.wait()

  // Connect app and deploy TEMPL via UI (priest account)
  await page.goto('./')
  await page.click('button:has-text("Connect Wallet")')
  await page.fill('input[placeholder*="Token address"]', tokenAddress)
  await page.fill('input[placeholder*="Protocol fee recipient"]', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
  await page.fill('input[placeholder*="Entry fee"]', '100')
  await page.click('button:has-text("Deploy")')
  const contractElement = await page.locator('text=Contract:').textContent({ timeout: 30000 })
  const templAddress = contractElement.split(':')[1].trim()

  // Approve and purchase as member via Node ethers (no UI signer use)
  const templAbi = JSON.parse(readFileSync(path.join(process.cwd(), 'src/contracts/TEMPL.json'), 'utf8')).abi
  const templ = new ethers.Contract(templAddress, templAbi, wallets.member)
  const tokenAsMember = new ethers.Contract(tokenAddress, ['function approve(address,uint256) returns (bool)'], wallets.member)
  tx = await tokenAsMember.approve(templAddress, 100)
  await tx.wait()
  tx = await templ.purchaseAccess()
  await tx.wait()

  // Create, vote, and execute proposal via member/priest wallets
  const iface = new ethers.Interface(['function setPausedDAO(bool)'])
  const callData = iface.encodeFunctionData('setPausedDAO', [true])
  tx = await templ.createProposal('P', 'D', callData, 0)
  await tx.wait()
  tx = await templ.vote(0, true)
  await tx.wait()
  await fetch('http://localhost:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_increaseTime', params: [7 * 24 * 60 * 60] }) })
  await fetch('http://localhost:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_mine', params: [] }) })
  const templPriest = new ethers.Contract(templAddress, templAbi, wallets.priest)
  tx = await templPriest.executeProposal(0)
  await tx.wait()

  // Assert paused
  expect(await templPriest.paused()).toBe(true)
})
