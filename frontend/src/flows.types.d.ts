import type { Signer, InterfaceAbi, TransactionRequest, Provider } from 'ethers';
import type {
  ProposalData,
  VoteRecord,
  MuteRecord
} from '../../shared/types';

export type Address = string;
export type Ethers = typeof import('ethers');
export interface XMTPConversation {
  id: string;
  consentState?: string;
  updateConsentState?: (state: string) => Promise<void>;
  send?: (content: string) => Promise<void>;
}

export interface XMTPClient {
  inboxId?: string;
  address?: string;
  env?: string;
  conversations: {
    getConversationById(id: string): Promise<XMTPConversation>;
    list?: (opts?: { consentStates?: string[] }) => Promise<XMTPConversation[]>;
    sync?: () => Promise<void>;
    syncAll?: (states: string[]) => Promise<void>;
  };
  preferences?: {
    sync?: () => Promise<void>;
    inboxState?: (force?: boolean) => Promise<unknown>;
  };
  findInboxIdByIdentifier?: (identifier: unknown) => Promise<string | null>;
  debugInformation?: { apiAggregateStatistics?: () => Promise<string | undefined> };
}

export interface DeployRequest {
  ethers: Ethers;
  xmtp?: XMTPClient;
  signer: Signer;
  walletAddress: Address;
  tokenAddress: Address;
  protocolFeeRecipient: Address;
  entryFee: number | string | bigint;
  priestVoteWeight?: number | string | bigint;
  priestWeightThreshold?: number | string | bigint;
  templArtifact: { abi: InterfaceAbi; bytecode: string };
  backendUrl?: string;
  txOptions?: TransactionRequest;
}

export interface DeployResponse {
  contractAddress: Address;
  groupId: string;
  group: XMTPConversation | null;
}

export interface JoinRequest {
  ethers: Ethers;
  xmtp: XMTPClient;
  signer: Signer;
  walletAddress: Address;
  templAddress: Address;
  templArtifact: { abi: InterfaceAbi };
  backendUrl?: string;
  txOptions?: TransactionRequest;
}

export interface JoinResponse {
  groupId: string;
  group: XMTPConversation | null;
}

export function deployTempl(req: DeployRequest): Promise<DeployResponse>;
export function purchaseAndJoin(req: JoinRequest): Promise<JoinResponse>;
export function sendMessage(args: { group: XMTPConversation; content: string }): Promise<void>;
export function proposeVote(args: {
  ethers: Ethers;
  signer: Signer;
  templAddress: Address;
  templArtifact: { abi: InterfaceAbi };
  title: string;
  description: string;
  callData: string;
  votingPeriod?: number;
  txOptions?: TransactionRequest;
}): Promise<void>;
export function voteOnProposal(args: {
  ethers: Ethers;
  signer: Signer;
  templAddress: Address;
  templArtifact: { abi: InterfaceAbi };
  proposalId: number;
  support: boolean;
  txOptions?: TransactionRequest;
}): Promise<void>;
export function executeProposal(args: {
  ethers: Ethers;
  signer: Signer;
  templAddress: Address;
  templArtifact: { abi: InterfaceAbi };
  proposalId: number;
  txOptions?: TransactionRequest;
}): Promise<void>;
export function watchProposals(args: {
  ethers: Ethers;
  provider: Provider;
  templAddress: Address;
  templArtifact: { abi: InterfaceAbi };
  onProposal: (p: ProposalData) => void;
  onVote: (v: VoteRecord) => void;
}): () => void;
export function delegateMute(args: {
  signer: Signer;
  contractAddress: Address;
  priestAddress: Address;
  delegateAddress: Address;
  backendUrl?: string;
}): Promise<boolean>;
export function muteMember(args: {
  signer: Signer;
  contractAddress: Address;
  moderatorAddress: Address;
  targetAddress: Address;
  backendUrl?: string;
}): Promise<number>;
export function fetchActiveMutes(args: {
  contractAddress: Address;
  backendUrl?: string;
}): Promise<MuteRecord[]>;

export type { ProposalData, VoteRecord, MuteRecord };
