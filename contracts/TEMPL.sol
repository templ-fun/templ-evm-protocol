// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { TemplBase } from "./TemplBase.sol";
import { TemplMembershipModule } from "./TemplMembership.sol";
import { TemplTreasuryModule } from "./TemplTreasury.sol";
import { TemplGovernanceModule } from "./TemplGovernance.sol";
import { TemplErrors } from "./TemplErrors.sol";
import { CurveConfig } from "./TemplCurve.sol";

/// @title Templ Core
/// @notice Wires governance, treasury, and membership modules for a single Templ instance.
/// @author Templ
contract TEMPL is TemplBase {
    /// @notice Module contract handling membership-related functions via delegatecall.
    address public immutable MEMBERSHIP_MODULE;
    /// @notice Module contract handling treasury configuration and DAO-only actions via delegatecall.
    address public immutable TREASURY_MODULE;
    /// @notice Module contract handling proposals, voting, and execution via delegatecall.
    address public immutable GOVERNANCE_MODULE;

    mapping(bytes4 => address) private _moduleForSelector;
    /// @notice Initializes a new templ with the provided configuration and priest.
    /// @param _priest Wallet that oversees configuration changes until governance replaces it.
    /// @param _protocolFeeRecipient Address that receives the protocol share of every entry fee.
    /// @param _token ERC-20 token used as the access currency for the templ.
    /// @param _entryFee Amount of `_token` required to join the templ.
    /// @param _burnBps Basis points of each entry fee that are burned.
    /// @param _treasuryBps Basis points of each entry fee routed to the templ treasury.
    /// @param _memberPoolBps Basis points of each entry fee streamed to existing members.
    /// @param _protocolBps Basis points of each entry fee forwarded to the protocol.
    /// @param _quorumBps YES vote threshold (basis points) required to satisfy quorum.
    /// @param _executionDelay Seconds to wait after quorum before executing a proposal.
    /// @param _burnAddress Address that receives the burn allocation (defaults to the dead address).
    /// @param _priestIsDictator Whether the templ starts in priest-only governance mode.
    /// @param _maxMembers Optional membership cap (0 keeps membership uncapped).
    /// @param _name Human-readable templ name surfaced in frontends.
    /// @param _description Short templ description surfaced in frontends.
    /// @param _logoLink Canonical logo URL for the templ.
    /// @param _proposalCreationFeeBps Proposal creation fee expressed in basis points of the current entry fee.
    /// @param _referralShareBps Referral share expressed in basis points of the member pool allocation.
    /// @param _membershipModule Module contract handling membership functions (delegatecalled).
    /// @param _treasuryModule Module contract handling treasury/governance config (delegatecalled).
    /// @param _governanceModule Module contract handling proposals/voting/execution (delegatecalled).
    /// @param _curve Pricing curve configuration applied to future joins.
    constructor(
        address _priest,
        address _protocolFeeRecipient,
        address _token,
        uint256 _entryFee,
        uint256 _burnBps,
        uint256 _treasuryBps,
        uint256 _memberPoolBps,
        uint256 _protocolBps,
        uint256 _quorumBps,
        uint256 _executionDelay,
        address _burnAddress,
        bool _priestIsDictator,
        uint256 _maxMembers,
        string memory _name,
        string memory _description,
        string memory _logoLink,
        uint256 _proposalCreationFeeBps,
        uint256 _referralShareBps,
        address _membershipModule,
        address _treasuryModule,
        address _governanceModule,
        CurveConfig memory _curve
    ) {
        _initializeTempl(
            _protocolFeeRecipient,
            _token,
            _burnBps,
            _treasuryBps,
            _memberPoolBps,
            _protocolBps,
            _quorumBps,
            _executionDelay,
            _burnAddress,
            _priestIsDictator,
            _name,
            _description,
            _logoLink,
            _proposalCreationFeeBps,
            _referralShareBps
        );
        if (_priest == address(0)) revert TemplErrors.InvalidRecipient();
        if (_entryFee == 0) {
            revert TemplErrors.AmountZero();
        }
        if (_entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
        if (_entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();

        if (_membershipModule == address(0) || _treasuryModule == address(0) || _governanceModule == address(0)) {
            revert TemplErrors.InvalidCallData();
        }

        MEMBERSHIP_MODULE = _membershipModule;
        TREASURY_MODULE = _treasuryModule;
        GOVERNANCE_MODULE = _governanceModule;

        _registerMembershipSelectors(_membershipModule);
        _registerTreasurySelectors(_treasuryModule);
        _registerGovernanceSelectors(_governanceModule);

        priest = _priest;
        joinPaused = false;
        Member storage priestMember = members[_priest];
        priestMember.joined = true;
        priestMember.timestamp = block.timestamp;
        priestMember.blockNumber = block.number;
        priestMember.rewardSnapshot = cumulativeMemberRewards;
        joinSequence = 1;
        priestMember.joinSequence = 1;
        memberCount = 1;
        if (_maxMembers != 0) {
            _setMaxMembers(_maxMembers);
        }

        _configureEntryFeeCurve(_entryFee, _curve);
    }

    /// @notice Accepts ETH so proposals can later disburse it as external rewards.
    receive() external payable {}

    /// @notice Exposes the module registered for a given function selector.
    /// @param selector The 4-byte function selector.
    /// @return module Address of the module that will handle calls for `selector` (zero address if none).
    function getModuleForSelector(bytes4 selector) external view returns (address module) {
        return _moduleForSelector[selector];
    }

    /// @notice Returns the static selector sets handled by each module.
    /// @dev Helpful for tooling and off-chain introspection. These mirror the
    ///      registrations performed in the constructor and do not change at runtime.
    /// @return membership Selectors routed to the membership module.
    /// @return treasury Selectors routed to the treasury module.
    /// @return governance Selectors routed to the governance module.
    function getRegisteredSelectors()
        external
        pure
        returns (bytes4[] memory membership, bytes4[] memory treasury, bytes4[] memory governance)
    {
        membership = new bytes4[](18);
        membership[0] = TemplMembershipModule.join.selector;
        membership[1] = TemplMembershipModule.joinWithReferral.selector;
        membership[2] = TemplMembershipModule.joinFor.selector;
        membership[3] = TemplMembershipModule.joinForWithReferral.selector;
        membership[4] = TemplMembershipModule.claimMemberRewards.selector;
        membership[5] = TemplMembershipModule.claimExternalReward.selector;
        membership[6] = TemplMembershipModule.getClaimableMemberRewards.selector;
        membership[7] = TemplMembershipModule.getExternalRewardTokens.selector;
        membership[8] = TemplMembershipModule.getExternalRewardState.selector;
        membership[9] = TemplMembershipModule.getClaimableExternalReward.selector;
        membership[10] = TemplMembershipModule.isMember.selector;
        membership[11] = TemplMembershipModule.getJoinDetails.selector;
        membership[12] = TemplMembershipModule.getTreasuryInfo.selector;
        membership[13] = TemplMembershipModule.getConfig.selector;
        membership[14] = TemplMembershipModule.getMemberCount.selector;
        membership[15] = TemplMembershipModule.getVoteWeight.selector;
        membership[16] = TemplMembershipModule.totalJoins.selector;
        membership[17] = TemplMembershipModule.getExternalRewardTokensPaginated.selector;

        treasury = new bytes4[](16);
        treasury[0] = TemplTreasuryModule.withdrawTreasuryDAO.selector;
        treasury[1] = TemplTreasuryModule.updateConfigDAO.selector;
        treasury[2] = TemplTreasuryModule.setJoinPausedDAO.selector;
        treasury[3] = TemplTreasuryModule.setMaxMembersDAO.selector;
        treasury[4] = TemplTreasuryModule.disbandTreasuryDAO.selector;
        treasury[5] = TemplTreasuryModule.changePriestDAO.selector;
        treasury[6] = TemplTreasuryModule.setDictatorshipDAO.selector;
        treasury[7] = TemplTreasuryModule.setTemplMetadataDAO.selector;
        treasury[8] = TemplTreasuryModule.setProposalCreationFeeBpsDAO.selector;
        treasury[9] = TemplTreasuryModule.setReferralShareBpsDAO.selector;
        treasury[10] = TemplTreasuryModule.setEntryFeeCurveDAO.selector;
        treasury[11] = TemplTreasuryModule.cleanupExternalRewardToken.selector;
        treasury[12] = TemplTreasuryModule.setQuorumBpsDAO.selector;
        treasury[13] = TemplTreasuryModule.setExecutionDelayAfterQuorumDAO.selector;
        treasury[14] = TemplTreasuryModule.setBurnAddressDAO.selector;
        treasury[15] = TemplTreasuryModule.batchDAO.selector;

        governance = new bytes4[](25);
        governance[0] = TemplGovernanceModule.createProposalSetJoinPaused.selector;
        governance[1] = TemplGovernanceModule.createProposalUpdateConfig.selector;
        governance[2] = TemplGovernanceModule.createProposalSetMaxMembers.selector;
        governance[3] = TemplGovernanceModule.createProposalUpdateMetadata.selector;
        governance[4] = TemplGovernanceModule.createProposalSetProposalFeeBps.selector;
        governance[5] = TemplGovernanceModule.createProposalSetReferralShareBps.selector;
        governance[6] = TemplGovernanceModule.createProposalSetEntryFeeCurve.selector;
        governance[7] = TemplGovernanceModule.createProposalCallExternal.selector;
        governance[8] = TemplGovernanceModule.createProposalWithdrawTreasury.selector;
        governance[9] = TemplGovernanceModule.createProposalDisbandTreasury.selector;
        governance[10] = TemplGovernanceModule.createProposalChangePriest.selector;
        governance[11] = TemplGovernanceModule.createProposalSetDictatorship.selector;
        governance[12] = TemplGovernanceModule.vote.selector;
        governance[13] = TemplGovernanceModule.executeProposal.selector;
        governance[14] = TemplGovernanceModule.getProposal.selector;
        governance[15] = TemplGovernanceModule.getProposalSnapshots.selector;
        governance[16] = TemplGovernanceModule.hasVoted.selector;
        governance[17] = TemplGovernanceModule.getActiveProposals.selector;
        governance[18] = TemplGovernanceModule.getActiveProposalsPaginated.selector;
        governance[19] = TemplGovernanceModule.pruneInactiveProposals.selector;
        governance[20] = TemplGovernanceModule.getProposalJoinSequences.selector;
        governance[21] = TemplGovernanceModule.createProposalCleanupExternalRewardToken.selector;
        governance[22] = TemplGovernanceModule.createProposalSetQuorumBps.selector;
        governance[23] = TemplGovernanceModule.createProposalSetExecutionDelay.selector;
        governance[24] = TemplGovernanceModule.createProposalSetBurnAddress.selector;
    }

    /// @notice Fallback routes unknown selectors to the registered module via delegatecall.
    fallback() external payable {
        address module = _moduleForSelector[msg.sig];
        if (module == address(0)) revert TemplErrors.InvalidCallData();
        _delegateTo(module);
    }

    /// @notice Delegate the current call to `module`, returning or bubbling up revert data.
    /// @dev Performs the delegatecall to a module and bubbles up revert data.
    /// @param module Target module address to delegate the call to.
    function _delegateTo(address module) internal {
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), module, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }

    /// @notice Registers membership selectors to be handled by `module`.
    /// @param module Address of the membership module.
    function _registerMembershipSelectors(address module) internal {
        bytes4[] memory selectors = new bytes4[](18);
        selectors[0] = TemplMembershipModule.join.selector;
        selectors[1] = TemplMembershipModule.joinWithReferral.selector;
        selectors[2] = TemplMembershipModule.joinFor.selector;
        selectors[3] = TemplMembershipModule.joinForWithReferral.selector;
        selectors[4] = TemplMembershipModule.claimMemberRewards.selector;
        selectors[5] = TemplMembershipModule.claimExternalReward.selector;
        selectors[6] = TemplMembershipModule.getClaimableMemberRewards.selector;
        selectors[7] = TemplMembershipModule.getExternalRewardTokens.selector;
        selectors[8] = TemplMembershipModule.getExternalRewardState.selector;
        selectors[9] = TemplMembershipModule.getClaimableExternalReward.selector;
        selectors[10] = TemplMembershipModule.isMember.selector;
        selectors[11] = TemplMembershipModule.getJoinDetails.selector;
        selectors[12] = TemplMembershipModule.getTreasuryInfo.selector;
        selectors[13] = TemplMembershipModule.getConfig.selector;
        selectors[14] = TemplMembershipModule.getMemberCount.selector;
        selectors[15] = TemplMembershipModule.getVoteWeight.selector;
        selectors[16] = TemplMembershipModule.totalJoins.selector;
        selectors[17] = TemplMembershipModule.getExternalRewardTokensPaginated.selector;
        _registerModule(module, selectors);
    }

    /// @notice Registers treasury selectors to be handled by `module`.
    /// @param module Address of the treasury module.
    function _registerTreasurySelectors(address module) internal {
        bytes4[] memory selectors = new bytes4[](16);
        selectors[0] = TemplTreasuryModule.withdrawTreasuryDAO.selector;
        selectors[1] = TemplTreasuryModule.updateConfigDAO.selector;
        selectors[2] = TemplTreasuryModule.setJoinPausedDAO.selector;
        selectors[3] = TemplTreasuryModule.setMaxMembersDAO.selector;
        selectors[4] = TemplTreasuryModule.disbandTreasuryDAO.selector;
        selectors[5] = TemplTreasuryModule.changePriestDAO.selector;
        selectors[6] = TemplTreasuryModule.setDictatorshipDAO.selector;
        selectors[7] = TemplTreasuryModule.setTemplMetadataDAO.selector;
        selectors[8] = TemplTreasuryModule.setProposalCreationFeeBpsDAO.selector;
        selectors[9] = TemplTreasuryModule.setReferralShareBpsDAO.selector;
        selectors[10] = TemplTreasuryModule.setEntryFeeCurveDAO.selector;
        selectors[11] = TemplTreasuryModule.cleanupExternalRewardToken.selector;
        selectors[12] = TemplTreasuryModule.setQuorumBpsDAO.selector;
        selectors[13] = TemplTreasuryModule.setExecutionDelayAfterQuorumDAO.selector;
        selectors[14] = TemplTreasuryModule.setBurnAddressDAO.selector;
        selectors[15] = TemplTreasuryModule.batchDAO.selector;
        _registerModule(module, selectors);
    }

    /// @notice Registers governance selectors to be handled by `module`.
    /// @param module Address of the governance module.
    function _registerGovernanceSelectors(address module) internal {
        bytes4[] memory selectors = new bytes4[](25);
        selectors[0] = TemplGovernanceModule.createProposalSetJoinPaused.selector;
        selectors[1] = TemplGovernanceModule.createProposalUpdateConfig.selector;
        selectors[2] = TemplGovernanceModule.createProposalSetMaxMembers.selector;
        selectors[3] = TemplGovernanceModule.createProposalUpdateMetadata.selector;
        selectors[4] = TemplGovernanceModule.createProposalSetProposalFeeBps.selector;
        selectors[5] = TemplGovernanceModule.createProposalSetReferralShareBps.selector;
        selectors[6] = TemplGovernanceModule.createProposalSetEntryFeeCurve.selector;
        selectors[7] = TemplGovernanceModule.createProposalCallExternal.selector;
        selectors[8] = TemplGovernanceModule.createProposalWithdrawTreasury.selector;
        selectors[9] = TemplGovernanceModule.createProposalDisbandTreasury.selector;
        selectors[10] = TemplGovernanceModule.createProposalChangePriest.selector;
        selectors[11] = TemplGovernanceModule.createProposalSetDictatorship.selector;
        selectors[12] = TemplGovernanceModule.vote.selector;
        selectors[13] = TemplGovernanceModule.executeProposal.selector;
        selectors[14] = TemplGovernanceModule.getProposal.selector;
        selectors[15] = TemplGovernanceModule.getProposalSnapshots.selector;
        selectors[16] = TemplGovernanceModule.hasVoted.selector;
        selectors[17] = TemplGovernanceModule.getActiveProposals.selector;
        selectors[18] = TemplGovernanceModule.getActiveProposalsPaginated.selector;
        selectors[19] = TemplGovernanceModule.pruneInactiveProposals.selector;
        selectors[20] = TemplGovernanceModule.getProposalJoinSequences.selector;
        selectors[21] = TemplGovernanceModule.createProposalCleanupExternalRewardToken.selector;
        selectors[22] = TemplGovernanceModule.createProposalSetQuorumBps.selector;
        selectors[23] = TemplGovernanceModule.createProposalSetExecutionDelay.selector;
        selectors[24] = TemplGovernanceModule.createProposalSetBurnAddress.selector;
        _registerModule(module, selectors);
    }

    /// @notice Returns the action and ABI-encoded payload for a proposal.
    /// @dev See README Proposal Views for payload types per action.
    /// @param _proposalId Proposal id to inspect.
    /// @return action The proposal action enum value.
    /// @return payload ABI-encoded payload corresponding to `action`.
    function getProposalActionData(uint256 _proposalId) external view returns (Action action, bytes memory payload) {
        if (_proposalId < proposalCount) {
            Proposal storage p = proposals[_proposalId];
            action = p.action;
            if (action == Action.SetJoinPaused) {
                payload = abi.encode(p.joinPaused);
            } else if (action == Action.UpdateConfig) {
                payload = abi.encode(
                    p.token,
                    p.newEntryFee,
                    p.updateFeeSplit,
                    p.newBurnBps,
                    p.newTreasuryBps,
                    p.newMemberPoolBps
                );
            } else if (action == Action.SetMaxMembers) {
                payload = abi.encode(p.newMaxMembers);
            } else if (action == Action.SetMetadata) {
                payload = abi.encode(p.newTemplName, p.newTemplDescription, p.newLogoLink);
            } else if (action == Action.SetProposalFee) {
                payload = abi.encode(p.newProposalCreationFeeBps);
            } else if (action == Action.SetReferralShare) {
                payload = abi.encode(p.newReferralShareBps);
            } else if (action == Action.SetEntryFeeCurve) {
                CurveConfig memory curve = p.curveConfig;
                payload = abi.encode(curve, p.curveBaseEntryFee);
            } else if (action == Action.CallExternal) {
                payload = abi.encode(p.externalCallTarget, p.externalCallValue, p.externalCallData);
            } else if (action == Action.WithdrawTreasury) {
                payload = abi.encode(p.token, p.recipient, p.amount, p.reason);
            } else if (action == Action.DisbandTreasury) {
                payload = abi.encode(p.token);
            } else if (action == Action.CleanupExternalRewardToken) {
                payload = abi.encode(p.token);
            } else if (action == Action.ChangePriest) {
                payload = abi.encode(p.recipient);
            } else if (action == Action.SetDictatorship) {
                payload = abi.encode(p.setDictatorship);
            } else if (action == Action.SetQuorumBps) {
                payload = abi.encode(p.newQuorumBps);
            } else if (action == Action.SetExecutionDelay) {
                payload = abi.encode(p.newExecutionDelay);
            } else if (action == Action.SetBurnAddress) {
                payload = abi.encode(p.newBurnAddress);
            } else {
                payload = hex"";
            }
            return (action, payload);
        }
        revert TemplErrors.InvalidProposal();
    }

    /// @notice Internal helper that maps function selectors to a module address.
    /// @param module Destination module to handle the selectors.
    /// @param selectors List of selectors to route to `module`.
    function _registerModule(address module, bytes4[] memory selectors) internal {
        uint256 len = selectors.length;
        for (uint256 i = 0; i < len; ++i) {
            _moduleForSelector[selectors[i]] = module;
        }
    }
}
