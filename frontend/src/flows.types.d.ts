// Minimal type declarations for flows.js consumers
export type Address = string

export interface DeployRequest {
  ethers: any
  xmtp?: any
  signer: any
  walletAddress: Address
  tokenAddress: Address
  entryFee: number | string | bigint
  burnPercent: number | string | bigint
  treasuryPercent: number | string | bigint
  memberPoolPercent: number | string | bigint
  quorumPercent?: number | string | bigint
  executionDelaySeconds?: number | string | bigint
  burnAddress?: Address
  priestIsDictator?: boolean
  factoryAddress: Address
  factoryArtifact: { abi: any }
  templArtifact: { abi: any; bytecode?: string }
  maxMembers?: number | string | bigint
  backendUrl?: string
  txOptions?: Record<string, any>
  curveProvided?: boolean
  curveConfig?: Record<string, any> | null
  templHomeLink?: string | null
}

export interface DeployResponse {
  contractAddress: Address
  groupId: string
  group: any | null
}

export interface JoinRequest {
  ethers: any
  xmtp: any
  signer: any
  walletAddress?: Address
  templAddress: Address
  templArtifact: { abi: any }
  backendUrl?: string
  txOptions?: Record<string, any>
  onProgress?: (stage: string) => void
}

export interface JoinResponse {
  groupId: string
  group: any | null
}

export interface PurchaseAccessRequest {
  ethers: any
  signer: any
  walletAddress?: Address
  templAddress: Address
  templArtifact: any
  tokenAddress?: Address
  amount?: number | string | bigint
  txOptions?: any
}

export function deployTempl(req: DeployRequest): Promise<DeployResponse>
export function purchaseAndJoin(req: JoinRequest): Promise<JoinResponse>
export function purchaseAccess(args: PurchaseAccessRequest): Promise<boolean>
export function sendMessage(args: { group: any; content: string }): Promise<void>
export interface ProposeVoteArgs {
  ethers: any
  signer: any
  templAddress: Address
  templArtifact: any
  action?: string
  params?: Record<string, any>
  callData?: string
  votingPeriod?: number
  txOptions?: any
  title?: string
  description?: string
}

export function proposeVote(args: ProposeVoteArgs): Promise<{ receipt: any; proposalId: number | null }>
export function voteOnProposal(args: { ethers: any; signer: any; templAddress: Address; templArtifact: any; proposalId: number; support: boolean; txOptions?: any }): Promise<void>
export function executeProposal(args: { ethers: any; signer: any; templAddress: Address; templArtifact: any; proposalId: number; txOptions?: any }): Promise<void>
export function watchProposals(args: { ethers: any; provider: any; templAddress: Address; templArtifact: any; onProposal: Function; onVote: Function }): () => void
export function delegateMute(args: { signer: any; contractAddress: Address; priestAddress: Address; delegateAddress: Address; backendUrl?: string }): Promise<boolean>
export function muteMember(args: { signer: any; contractAddress: Address; moderatorAddress: Address; targetAddress: Address; backendUrl?: string }): Promise<number>
export function fetchActiveMutes(args: { contractAddress: Address; backendUrl?: string }): Promise<Array<{ address: Address; count: number; until: number }>>
export function fetchDelegates(args: { contractAddress: Address; backendUrl?: string }): Promise<Address[]>
export function getTreasuryInfo(args: { ethers: any; providerOrSigner: any; templAddress: Address; templArtifact: any }): Promise<{ treasury: string; memberPool: string; totalReceived: string; totalBurnedAmount: string; totalProtocolFees: string; protocolAddress: Address }>
export function getClaimable(args: { ethers: any; providerOrSigner: any; templAddress: Address; templArtifact: any; memberAddress: Address }): Promise<string>
export function getExternalRewards(args: { ethers: any; providerOrSigner: any; templAddress: Address; templArtifact: any; memberAddress?: Address }): Promise<Array<{ token: Address; poolBalance: string; cumulativeRewards: string; remainder: string; claimable: string }>>
export function claimMemberPool(args: { ethers: any; signer: any; templAddress: Address; templArtifact: any; txOptions?: any }): Promise<void>
export function claimExternalToken(args: { ethers: any; signer: any; templAddress: Address; templArtifact: any; token: Address; txOptions?: any }): Promise<void>
export function getClaimablePoolAmount(args: { ethers: any; providerOrSigner: any; templAddress: Address; templArtifact: any; memberAddress: Address }): Promise<string>
