// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplBase} from "./TemplBase.sol";
import {TemplMembershipModule} from "./TemplMembership.sol";
import {TemplTreasuryModule} from "./TemplTreasury.sol";
import {TemplGovernanceModule} from "./TemplGovernance.sol";
import {TemplCouncilModule} from "./TemplCouncil.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {CurveConfig} from "./TemplCurve.sol";

/// @title Templ Core
/// @notice Wires governance, treasury, and membership modules for a single Templ instance.
/// @author templ.fun
contract TEMPL is TemplBase {
    /// @notice Address of the membership module implementation used for delegatecalls.
    address public immutable MEMBERSHIP_MODULE;
    /// @notice Address of the treasury module implementation used for delegatecalls.
    address public immutable TREASURY_MODULE;
    /// @notice Address of the governance module implementation used for delegatecalls.
    address public immutable GOVERNANCE_MODULE;
    /// @notice Address of the council governance module implementation used for delegatecalls.
    address public immutable COUNCIL_MODULE;

    /// @dev Selector-to-module routing table used by the fallback for delegatecall dispatch.
    mapping(bytes4 => address) private _moduleForSelector;

    /// @notice Emitted when routing is updated for one or more function selectors.
    /// @param module Module address that will handle the specified selectors via delegatecall.
    /// @param selectors Function selectors that were mapped to `module`.
    event RoutingUpdated(address indexed module, bytes4[] selectors);

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
    /// @param _yesVoteThresholdBps Basis points of votes cast required for proposals to pass.
    /// @param _instantQuorumBps Instant quorum threshold (bps) that enables immediate execution when satisfied.
    /// @param _startInCouncilMode Whether the templ should begin with council governance enabled.
    /// @param _membershipModule Address of the deployed membership module implementation.
    /// @param _treasuryModule Address of the deployed treasury module implementation.
    /// @param _governanceModule Address of the deployed governance module implementation.
    /// @param _councilModule Address of the deployed council governance module implementation.
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
        uint256 _yesVoteThresholdBps,
        uint256 _instantQuorumBps,
        bool _startInCouncilMode,
        address _membershipModule,
        address _treasuryModule,
        address _governanceModule,
        address _councilModule,
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
            _referralShareBps,
            _yesVoteThresholdBps,
            _instantQuorumBps
        );
        if (_priest == address(0)) revert TemplErrors.InvalidRecipient();
        if (_entryFee == 0) {
            revert TemplErrors.AmountZero();
        }
        if (_entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
        if (_entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();

        if (
            _membershipModule == address(0) ||
            _treasuryModule == address(0) ||
            _governanceModule == address(0) ||
            _councilModule == address(0)
        ) {
            revert TemplErrors.InvalidCallData();
        }
        if (_startInCouncilMode && _priestIsDictator) revert TemplErrors.CouncilModeActive();

        MEMBERSHIP_MODULE = _membershipModule;
        TREASURY_MODULE = _treasuryModule;
        GOVERNANCE_MODULE = _governanceModule;
        COUNCIL_MODULE = _councilModule;

        _registerMembershipSelectors(_membershipModule);
        _registerTreasurySelectors(_treasuryModule);
        _registerGovernanceSelectors(_governanceModule);
        _registerCouncilSelectors(_councilModule);

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
        _addCouncilMember(_priest, _priest);
        if (_startInCouncilMode) {
            _setCouncilMode(true);
        }
        if (_maxMembers != 0) {
            _setMaxMembers(_maxMembers);
        }

        _configureEntryFeeCurve(_entryFee, _curve);
    }

    /// @notice Accepts ETH so proposals can later disburse it from treasury.
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
    /// @return council Selectors routed to the council governance module.
    function getRegisteredSelectors()
        external
        pure
        returns (
            bytes4[] memory membership,
            bytes4[] memory treasury,
            bytes4[] memory governance,
            bytes4[] memory council
        )
    {
        membership = new bytes4[](17);
        membership[0] = TemplMembershipModule.join.selector;
        membership[1] = TemplMembershipModule.joinWithReferral.selector;
        membership[2] = TemplMembershipModule.joinFor.selector;
        membership[3] = TemplMembershipModule.joinForWithReferral.selector;
        membership[4] = TemplMembershipModule.joinWithMaxEntryFee.selector;
        membership[5] = TemplMembershipModule.joinWithReferralMaxEntryFee.selector;
        membership[6] = TemplMembershipModule.joinForWithMaxEntryFee.selector;
        membership[7] = TemplMembershipModule.joinForWithReferralMaxEntryFee.selector;
        membership[8] = TemplMembershipModule.claimMemberRewards.selector;
        membership[9] = TemplMembershipModule.getClaimableMemberRewards.selector;
        membership[10] = TemplMembershipModule.isMember.selector;
        membership[11] = TemplMembershipModule.getJoinDetails.selector;
        membership[12] = TemplMembershipModule.getTreasuryInfo.selector;
        membership[13] = TemplMembershipModule.getConfig.selector;
        membership[14] = TemplMembershipModule.getMemberCount.selector;
        membership[15] = TemplMembershipModule.getVoteWeight.selector;
        membership[16] = TemplMembershipModule.totalJoins.selector;

        treasury = new bytes4[](22);
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
        treasury[11] = TemplTreasuryModule.setQuorumBpsDAO.selector;
        treasury[12] = TemplTreasuryModule.setPostQuorumVotingPeriodDAO.selector;
        treasury[13] = TemplTreasuryModule.setBurnAddressDAO.selector;
        treasury[14] = TemplTreasuryModule.batchDAO.selector;
        treasury[15] = TemplTreasuryModule.setPreQuorumVotingPeriodDAO.selector;
        treasury[16] = TemplTreasuryModule.setYesVoteThresholdBpsDAO.selector;
        treasury[17] = TemplTreasuryModule.setCouncilModeDAO.selector;
        treasury[18] = TemplTreasuryModule.addCouncilMemberDAO.selector;
        treasury[19] = TemplTreasuryModule.removeCouncilMemberDAO.selector;
        treasury[20] = TemplTreasuryModule.setInstantQuorumBpsDAO.selector;
        treasury[21] = TemplTreasuryModule.sweepMemberPoolRemainderDAO.selector;

        governance = new bytes4[](20);
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
        governance[13] = TemplGovernanceModule.cancelProposal.selector;
        governance[14] = TemplGovernanceModule.executeProposal.selector;
        governance[15] = TemplGovernanceModule.pruneInactiveProposals.selector;
        governance[16] = TemplGovernanceModule.createProposalSetQuorumBps.selector;
        governance[17] = TemplGovernanceModule.createProposalSetPostQuorumVotingPeriod.selector;
        governance[18] = TemplGovernanceModule.createProposalSetBurnAddress.selector;
        governance[19] = TemplGovernanceModule.createProposalSetInstantQuorumBps.selector;
        council = new bytes4[](4);
        council[0] = TemplCouncilModule.createProposalSetYesVoteThreshold.selector;
        council[1] = TemplCouncilModule.createProposalSetCouncilMode.selector;
        council[2] = TemplCouncilModule.createProposalAddCouncilMember.selector;
        council[3] = TemplCouncilModule.createProposalRemoveCouncilMember.selector;
    }

    /// @notice Fallback routes calls to the registered module for the function selector.
    fallback() external payable {
        address module = _moduleForSelector[msg.sig];
        if (module == address(0)) revert TemplErrors.InvalidCallData();
        _delegateTo(module);
    }

    /// @notice Returns the action and ABI-encoded payload for a proposal.
    /// @dev See README Proposal Views for payload types per action.
    /// @param _proposalId Proposal id to inspect.
    /// @return action The proposal action enum value.
    /// @return payload ABI-encoded payload corresponding to `action`.
    function getProposalActionData(uint256 _proposalId) external view returns (Action action, bytes memory payload) {
        if (!(_proposalId < proposalCount)) revert TemplErrors.InvalidProposal();
        Proposal storage p = proposals[_proposalId];
        action = p.action;
        if (action == Action.SetJoinPaused) {
            payload = abi.encode(p.joinPaused);
        } else if (action == Action.UpdateConfig) {
            payload = abi.encode(p.newEntryFee, p.updateFeeSplit, p.newBurnBps, p.newTreasuryBps, p.newMemberPoolBps);
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
            payload = abi.encode(p.token, p.recipient, p.amount);
        } else if (action == Action.DisbandTreasury) {
            payload = abi.encode(p.token);
        } else if (action == Action.ChangePriest) {
            payload = abi.encode(p.recipient);
        } else if (action == Action.SetDictatorship) {
            payload = abi.encode(p.setDictatorship);
        } else if (action == Action.SetQuorumBps) {
            payload = abi.encode(p.newQuorumBps);
        } else if (action == Action.SetPostQuorumVotingPeriod) {
            payload = abi.encode(p.newPostQuorumVotingPeriod);
        } else if (action == Action.SetBurnAddress) {
            payload = abi.encode(p.newBurnAddress);
        } else if (action == Action.SetYesVoteThreshold) {
            payload = abi.encode(p.newYesVoteThresholdBps);
        } else if (action == Action.SetInstantQuorumBps) {
            payload = abi.encode(p.newInstantQuorumBps);
        } else if (action == Action.SetCouncilMode) {
            payload = abi.encode(p.setCouncilMode);
        } else if (action == Action.AddCouncilMember || action == Action.RemoveCouncilMember) {
            payload = abi.encode(p.recipient);
        } else {
            payload = hex"";
        }
    }

    /// @notice Returns core metadata for a proposal including vote totals and status.
    /// @param _proposalId Proposal id to inspect.
    /// @return proposer Address that opened the proposal.
    /// @return yesVotes Count of recorded YES votes.
    /// @return noVotes Count of recorded NO votes.
    /// @return endTime Timestamp when the proposal stops accepting votes (or when instant quorum fired).
    /// @return executed True when the proposal has already been executed.
    /// @return passed True when quorum/delay/YES thresholds are satisfied.
    /// @return title On-chain title recorded for the proposal.
    /// @return description On-chain description recorded for the proposal.
    function getProposal(
        uint256 _proposalId
    )
        external
        view
        returns (
            address proposer,
            uint256 yesVotes,
            uint256 noVotes,
            uint256 endTime,
            bool executed,
            bool passed,
            string memory title,
            string memory description
        )
    {
        if (!(_proposalId < proposalCount)) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];
        passed = _proposalPassed(proposal);

        return (
            proposal.proposer,
            proposal.yesVotes,
            proposal.noVotes,
            proposal.endTime,
            proposal.executed,
            passed,
            proposal.title,
            proposal.description
        );
    }

    /// @notice Returns quorum-related snapshot data for a proposal.
    /// @param _proposalId Proposal id to inspect.
    /// @return eligibleVotersPreQuorum Eligible voter count captured when the proposal was created.
    /// @return eligibleVotersPostQuorum Eligible voter count captured when quorum was reached.
    /// @return preQuorumSnapshotBlock Block number captured at proposal creation.
    /// @return quorumSnapshotBlock Block number captured when quorum was reached (0 when never reached).
    /// @return createdAt Timestamp when the proposal was opened.
    /// @return quorumReachedAt Timestamp when quorum was reached (0 when not yet reached).
    function getProposalSnapshots(
        uint256 _proposalId
    )
        external
        view
        returns (
            uint256 eligibleVotersPreQuorum,
            uint256 eligibleVotersPostQuorum,
            uint256 preQuorumSnapshotBlock,
            uint256 quorumSnapshotBlock,
            uint256 createdAt,
            uint256 quorumReachedAt
        )
    {
        if (!(_proposalId < proposalCount)) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];
        return (
            proposal.eligibleVoters,
            proposal.postQuorumEligibleVoters,
            proposal.preQuorumSnapshotBlock,
            proposal.quorumSnapshotBlock,
            proposal.createdAt,
            proposal.quorumReachedAt
        );
    }

    /// @notice Returns the join sequence snapshots captured for proposal eligibility.
    /// @param _proposalId Proposal id to inspect.
    /// @return preQuorumJoinSequence Join sequence frontier required to vote prior to quorum.
    /// @return quorumJoinSequence Join sequence frontier required once quorum has been reached.
    function getProposalJoinSequences(
        uint256 _proposalId
    ) external view returns (uint256 preQuorumJoinSequence, uint256 quorumJoinSequence) {
        if (!(_proposalId < proposalCount)) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];
        return (proposal.preQuorumJoinSequence, proposal.quorumJoinSequence);
    }

    /// @notice Returns the voting regime snapshot captured for a proposal.
    /// @param _proposalId Proposal id to inspect.
    /// @return councilOnly True when the proposal is locked to council-only voting.
    /// @return councilSnapshotEpoch Council membership epoch captured at proposal creation.
    function getProposalVotingMode(
        uint256 _proposalId
    ) external view returns (bool councilOnly, uint256 councilSnapshotEpoch) {
        if (!(_proposalId < proposalCount)) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];
        return (proposal.councilSnapshotEpoch != 0, proposal.councilSnapshotEpoch);
    }

    /// @notice Returns whether a voter participated in a proposal and their recorded choice.
    /// @param _proposalId Proposal id to inspect.
    /// @param _voter Wallet being checked for participation.
    /// @return voted True when `_voter` has cast a ballot.
    /// @return support Recorded vote choice (true for YES, false for NO).
    function hasVoted(uint256 _proposalId, address _voter) external view returns (bool voted, bool support) {
        if (!(_proposalId < proposalCount)) revert TemplErrors.InvalidProposal();
        Proposal storage proposal = proposals[_proposalId];

        return (proposal.hasVoted[_voter], proposal.voteChoice[_voter]);
    }

    /// @notice Lists proposal ids that are still within their active voting/execution window.
    /// @return proposalIds Array of proposal ids that remain active.
    function getActiveProposals() external view returns (uint256[] memory proposalIds) {
        uint256 len = activeProposalIds.length;
        uint256 currentTime = block.timestamp;
        uint256[] memory temp = new uint256[](len);
        uint256 count = 0;
        for (uint256 i = 0; i < len; ++i) {
            uint256 id = activeProposalIds[i];
            if (_isActiveProposal(proposals[id], currentTime)) {
                temp[count] = id;
                ++count;
            }
        }
        uint256[] memory activeIds = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            activeIds[i] = temp[i];
        }
        return activeIds;
    }

    /// @notice Returns active proposal ids using offset + limit pagination.
    /// @param offset Number of active proposals to skip from the start of the active set.
    /// @param limit Maximum number of active ids to return (1-100).
    /// @return proposalIds Array of active proposal ids bounded by the provided window.
    /// @return hasMore True when additional active entries exist beyond the returned page.
    function getActiveProposalsPaginated(
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory proposalIds, bool hasMore) {
        if (limit == 0 || limit > 100) revert TemplErrors.LimitOutOfRange();
        uint256 currentTime = block.timestamp;
        uint256 len = activeProposalIds.length;
        uint256 totalActive = 0;
        for (uint256 i = 0; i < len; ++i) {
            if (_isActiveProposal(proposals[activeProposalIds[i]], currentTime)) {
                ++totalActive;
            }
        }
        if (!(offset < totalActive)) {
            return (new uint256[](0), false);
        }

        uint256[] memory tempIds = new uint256[](limit);
        uint256 count = 0;
        uint256 activeSeen = 0;
        for (uint256 i = 0; i < len && count < limit; ++i) {
            uint256 id = activeProposalIds[i];
            if (!_isActiveProposal(proposals[id], currentTime)) {
                continue;
            }
            if (activeSeen < offset) {
                ++activeSeen;
                continue;
            }
            tempIds[count] = id;
            ++count;
        }

        hasMore = (offset + count) < totalActive;

        proposalIds = new uint256[](count);
        for (uint256 i = 0; i < count; ++i) {
            proposalIds[i] = tempIds[i];
        }

        return (proposalIds, hasMore);
    }

    /// @notice Delegatecalls the registered `module` forwarding calldata and bubbling return/revert data.
    /// @param module Destination module address resolved for the current selector.
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

    /// @notice Registers membership function selectors to dispatch to `module`.
    /// @param module Module address that implements membership functions.
    function _registerMembershipSelectors(address module) internal {
        bytes4[] memory selectors = new bytes4[](17);
        selectors[0] = TemplMembershipModule.join.selector;
        selectors[1] = TemplMembershipModule.joinWithReferral.selector;
        selectors[2] = TemplMembershipModule.joinFor.selector;
        selectors[3] = TemplMembershipModule.joinForWithReferral.selector;
        selectors[4] = TemplMembershipModule.joinWithMaxEntryFee.selector;
        selectors[5] = TemplMembershipModule.joinWithReferralMaxEntryFee.selector;
        selectors[6] = TemplMembershipModule.joinForWithMaxEntryFee.selector;
        selectors[7] = TemplMembershipModule.joinForWithReferralMaxEntryFee.selector;
        selectors[8] = TemplMembershipModule.claimMemberRewards.selector;
        selectors[9] = TemplMembershipModule.getClaimableMemberRewards.selector;
        selectors[10] = TemplMembershipModule.isMember.selector;
        selectors[11] = TemplMembershipModule.getJoinDetails.selector;
        selectors[12] = TemplMembershipModule.getTreasuryInfo.selector;
        selectors[13] = TemplMembershipModule.getConfig.selector;
        selectors[14] = TemplMembershipModule.getMemberCount.selector;
        selectors[15] = TemplMembershipModule.getVoteWeight.selector;
        selectors[16] = TemplMembershipModule.totalJoins.selector;
        _registerModule(module, selectors);
    }

    /// @notice Registers treasury function selectors to dispatch to `module`.
    /// @param module Module address that implements treasury functions.
    function _registerTreasurySelectors(address module) internal {
        bytes4[] memory selectors = new bytes4[](22);
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
        selectors[11] = TemplTreasuryModule.setQuorumBpsDAO.selector;
        selectors[12] = TemplTreasuryModule.setPostQuorumVotingPeriodDAO.selector;
        selectors[13] = TemplTreasuryModule.setBurnAddressDAO.selector;
        selectors[14] = TemplTreasuryModule.batchDAO.selector;
        selectors[15] = TemplTreasuryModule.setPreQuorumVotingPeriodDAO.selector;
        selectors[16] = TemplTreasuryModule.setYesVoteThresholdBpsDAO.selector;
        selectors[17] = TemplTreasuryModule.setCouncilModeDAO.selector;
        selectors[18] = TemplTreasuryModule.addCouncilMemberDAO.selector;
        selectors[19] = TemplTreasuryModule.removeCouncilMemberDAO.selector;
        selectors[20] = TemplTreasuryModule.setInstantQuorumBpsDAO.selector;
        selectors[21] = TemplTreasuryModule.sweepMemberPoolRemainderDAO.selector;
        _registerModule(module, selectors);
    }

    /// @notice Registers governance function selectors to dispatch to `module`.
    /// @param module Module address that implements governance functions.
    function _registerGovernanceSelectors(address module) internal {
        bytes4[] memory selectors = new bytes4[](20);
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
        selectors[13] = TemplGovernanceModule.cancelProposal.selector;
        selectors[14] = TemplGovernanceModule.executeProposal.selector;
        selectors[15] = TemplGovernanceModule.pruneInactiveProposals.selector;
        selectors[16] = TemplGovernanceModule.createProposalSetQuorumBps.selector;
        selectors[17] = TemplGovernanceModule.createProposalSetPostQuorumVotingPeriod.selector;
        selectors[18] = TemplGovernanceModule.createProposalSetBurnAddress.selector;
        selectors[19] = TemplGovernanceModule.createProposalSetInstantQuorumBps.selector;
        _registerModule(module, selectors);
    }

    /// @notice Registers council governance selectors to dispatch to `module`.
    /// @param module Module address that implements council governance functions.
    function _registerCouncilSelectors(address module) internal {
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = TemplCouncilModule.createProposalSetYesVoteThreshold.selector;
        selectors[1] = TemplCouncilModule.createProposalSetCouncilMode.selector;
        selectors[2] = TemplCouncilModule.createProposalAddCouncilMember.selector;
        selectors[3] = TemplCouncilModule.createProposalRemoveCouncilMember.selector;
        _registerModule(module, selectors);
    }

    /// @notice Assigns each `selectors[i]` to `module` so delegatecalls are routed correctly.
    /// @param module Module address to associate with the selectors.
    /// @param selectors Function selectors implemented by `module`.
    function _registerModule(address module, bytes4[] memory selectors) internal {
        uint256 len = selectors.length;
        for (uint256 i = 0; i < len; ++i) {
            _moduleForSelector[selectors[i]] = module;
        }
    }

    /// @notice Updates routing for function selectors to a module via DAO governance.
    /// @dev This enables upgrading/replacing module implementations without redeploying the router.
    ///      Call via a governance proposal using `createProposalCallExternal` targeting this TEMPL address.
    ///      When dictatorship is disabled, `onlyDAO` enforces that calls originate from the router itself.
    /// @param module Module address that will handle `selectors` via delegatecall.
    /// @param selectors Function selectors to associate with `module`.
    function setRoutingModuleDAO(address module, bytes4[] calldata selectors) external onlyDAO {
        if (module == address(0)) revert TemplErrors.InvalidRecipient();
        if (module.code.length == 0) revert TemplErrors.InvalidCallData();
        if (selectors.length == 0) revert TemplErrors.InvalidCallData();
        _registerModule(module, selectors);
        emit RoutingUpdated(module, selectors);
    }
}
