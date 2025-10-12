// Aggregated exports for legacy imports
export { deployTempl, registerTemplBackend } from './services/deployment.js';
export {
  purchaseAccess,
  purchaseAndJoin,
  sendMessage,
  getTreasuryInfo,
  getClaimable,
  getExternalRewards,
  claimMemberPool,
  claimExternalToken
} from './services/membership.js';
export { proposeVote, voteOnProposal, executeProposal, watchProposals } from './services/governance.js';
export { delegateMute, muteMember, fetchActiveMutes, fetchDelegates } from './services/moderation.js';
export { listTempls } from './services/templs.js';
