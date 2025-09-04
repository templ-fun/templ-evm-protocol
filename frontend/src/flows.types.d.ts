// Minimal type declarations for flows.js consumers
export type Address = string

export interface DeployRequest {
  ethers: any
  xmtp?: any
  signer: any
  walletAddress: Address
  tokenAddress: Address
  protocolFeeRecipient: Address
  entryFee: number | string | bigint
  priestVoteWeight?: number | string | bigint
  priestWeightThreshold?: number | string | bigint
  templArtifact: { abi: any; bytecode: string }
  backendUrl?: string
  txOptions?: Record<string, any>
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
  walletAddress: Address
  templAddress: Address
  templArtifact: { abi: any }
  backendUrl?: string
  txOptions?: Record<string, any>
}

export interface JoinResponse {
  groupId: string
  group: any | null
}

export function deployTempl(req: DeployRequest): Promise<DeployResponse>
export function purchaseAndJoin(req: JoinRequest): Promise<JoinResponse>
export function sendMessage(args: { group: any; content: string }): Promise<void>
export function proposeVote(args: { ethers: any; signer: any; templAddress: Address; templArtifact: any; title: string; description: string; callData: string; votingPeriod?: number; txOptions?: any }): Promise<void>
export function voteOnProposal(args: { ethers: any; signer: any; templAddress: Address; templArtifact: any; proposalId: number; support: boolean; txOptions?: any }): Promise<void>
export function executeProposal(args: { ethers: any; signer: any; templAddress: Address; templArtifact: any; proposalId: number; txOptions?: any }): Promise<void>
export function watchProposals(args: { ethers: any; provider: any; templAddress: Address; templArtifact: any; onProposal: Function; onVote: Function }): any
export function delegateMute(args: { signer: any; contractAddress: Address; priestAddress: Address; delegateAddress: Address; backendUrl?: string }): Promise<boolean>
export function muteMember(args: { signer: any; contractAddress: Address; moderatorAddress: Address; targetAddress: Address; backendUrl?: string }): Promise<number>
export function fetchActiveMutes(args: { contractAddress: Address; backendUrl?: string }): Promise<Array<{ address: Address; count: number; until: number }>>

