// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TemplBase} from "./TemplBase.sol";
import {TemplMembershipModule} from "./TemplMembership.sol";
import {TemplTreasuryModule} from "./TemplTreasury.sol";
import {TemplGovernanceModule} from "./TemplGovernance.sol";
import {TemplErrors} from "./TemplErrors.sol";
import {CurveConfig} from "./TemplCurve.sol";

/// @title templ.fun core templ implementation
/// @notice Wires governance, treasury, and membership modules for a single templ instance.
contract TEMPL is TemplBase {
    address public immutable membershipModule;
    address public immutable treasuryModule;
    address public immutable governanceModule;

    mapping(bytes4 => address) private _moduleForSelector;
    /// @notice Initializes a new templ with the provided configuration and priest.
    /// @param _priest Wallet that oversees configuration changes until governance replaces it.
    /// @param _protocolFeeRecipient Address that receives the protocol share of every entry fee.
    /// @param _token ERC-20 token used as the access currency for the templ.
    /// @param _entryFee Amount of `_token` required to join the templ.
    /// @param _burnPercent Percent of each entry fee that is burned.
    /// @param _treasuryPercent Percent of each entry fee routed to the templ treasury.
    /// @param _memberPoolPercent Percent of each entry fee streamed to existing members.
    /// @param _protocolPercent Percent of each entry fee forwarded to the protocol.
    /// @param _quorumPercent Percent of members that must vote YES to satisfy quorum.
    /// @param _executionDelay Seconds to wait after quorum before executing a proposal.
    /// @param _burnAddress Address that receives the burn allocation (defaults to the dead address).
    /// @param _priestIsDictator Whether the templ starts in priest-only governance mode.
    /// @param _maxMembers Optional membership cap (0 keeps membership uncapped).
    /// @param _name Human-readable templ name surfaced in frontends.
    /// @param _description Short templ description surfaced in frontends.
    /// @param _logoLink Canonical logo URL for the templ.
    /// @param _proposalCreationFeeBps Proposal creation fee expressed in basis points of the current entry fee.
    /// @param _referralShareBps Referral share expressed in basis points of the member pool allocation.
    /// @param _curve Pricing curve configuration applied to future joins.
    constructor(
        address _priest,
        address _protocolFeeRecipient,
        address _token,
        uint256 _entryFee,
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent,
        uint256 _protocolPercent,
        uint256 _quorumPercent,
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
            _burnPercent,
            _treasuryPercent,
            _memberPoolPercent,
            _protocolPercent,
            _quorumPercent,
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

        membershipModule = _membershipModule;
        treasuryModule = _treasuryModule;
        governanceModule = _governanceModule;

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
        memberCount = 1;
        if (_maxMembers != 0) {
            _setMaxMembers(_maxMembers);
        }

        _configureEntryFeeCurve(_entryFee, _curve);
    }

    /// @notice Accepts ETH so proposals can later disburse it as external rewards.
    receive() external payable {}
    /// @notice Exposes the module registered for a given function selector.
    function getModuleForSelector(bytes4 selector) external view returns (address) {
        return _moduleForSelector[selector];
    }

    fallback() external payable {
        address module = _moduleForSelector[msg.sig];
        if (module == address(0)) revert TemplErrors.InvalidCallData();
        _delegateTo(module);
    }

    function _delegateTo(address module) internal {
        assembly ("memory-safe") {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), module, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }

    function _registerMembershipSelectors(address module) internal {
        bytes4[] memory selectors = new bytes4[](17);
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
        _registerModule(module, selectors);
    }

    function _registerTreasurySelectors(address module) internal {
        bytes4[] memory selectors = new bytes4[](12);
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
        _registerModule(module, selectors);
    }

    function _registerGovernanceSelectors(address module) internal {
        bytes4[] memory selectors = new bytes4[](19);
        selectors[0] = TemplGovernanceModule.createProposalSetJoinPaused.selector;
        selectors[1] = TemplGovernanceModule.createProposalUpdateConfig.selector;
        selectors[2] = TemplGovernanceModule.createProposalSetMaxMembers.selector;
        selectors[3] = TemplGovernanceModule.createProposalUpdateMetadata.selector;
        selectors[4] = TemplGovernanceModule.createProposalSetProposalFeeBps.selector;
        selectors[5] = TemplGovernanceModule.createProposalSetReferralShareBps.selector;
        selectors[6] = TemplGovernanceModule.createProposalSetEntryFeeCurve.selector;
        selectors[7] = TemplGovernanceModule.createProposalWithdrawTreasury.selector;
        selectors[8] = TemplGovernanceModule.createProposalDisbandTreasury.selector;
        selectors[9] = TemplGovernanceModule.createProposalChangePriest.selector;
        selectors[10] = TemplGovernanceModule.createProposalSetDictatorship.selector;
        selectors[11] = TemplGovernanceModule.vote.selector;
        selectors[12] = TemplGovernanceModule.executeProposal.selector;
        selectors[13] = TemplGovernanceModule.getProposal.selector;
        selectors[14] = TemplGovernanceModule.getProposalSnapshots.selector;
        selectors[15] = TemplGovernanceModule.hasVoted.selector;
        selectors[16] = TemplGovernanceModule.getActiveProposals.selector;
        selectors[17] = TemplGovernanceModule.getActiveProposalsPaginated.selector;
        selectors[18] = TemplGovernanceModule.pruneInactiveProposals.selector;
        _registerModule(module, selectors);
    }

    function _registerModule(address module, bytes4[] memory selectors) internal {
        uint256 len = selectors.length;
        for (uint256 i = 0; i < len; i++) {
            _moduleForSelector[selectors[i]] = module;
        }
    }
}
