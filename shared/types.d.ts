export interface ProposalData {
  id: number;
  proposer: string;
  title: string;
  endTime: number;
}

export interface VoteRecord {
  id: number;
  voter: string;
  support: boolean;
  timestamp: number;
}

export interface MuteRecord {
  address: string;
  count: number;
  until: number;
}
