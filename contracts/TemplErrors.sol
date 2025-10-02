// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title TemplErrors
/// @notice Shared custom errors for TEMPL contracts
library TemplErrors {
    /// @notice Thrown when the caller has not joined the templ.
    error NotMember();
    /// @notice Thrown when a function restricted to the DAO is called externally.
    error NotDAO();
    /// @notice Thrown when a function requires the priest caller under dictatorship mode.
    error PriestOnly();
    /// @notice Thrown when joins are paused by governance.
    error JoinIntakePaused();
    /// @notice Thrown when attempting to join more than once.
    error MemberAlreadyJoined();
    /// @notice Thrown when an account lacks sufficient token balance.
    error InsufficientBalance();
    /// @notice Thrown when an address already has an active proposal.
    error ActiveProposalExists();
    /// @notice Thrown when a voting period is shorter than allowed.
    error VotingPeriodTooShort();
    /// @notice Thrown when a voting period exceeds the maximum allowed.
    error VotingPeriodTooLong();
    /// @notice Thrown when referencing a proposal that does not exist.
    error InvalidProposal();
    /// @notice Thrown when attempting to vote after a proposal's voting period has ended.
    error VotingEnded();
    /// @notice Thrown when a voter joined after the proposal was created.
    error JoinedAfterProposal();
    /// @notice Thrown when trying to execute logic before voting has ended.
    error VotingNotEnded();
    /// @notice Thrown when attempting to execute a proposal that has already been executed.
    error AlreadyExecuted();
    /// @notice Thrown when attempting to execute a proposal that did not pass.
    error ProposalNotPassed();
    /// @notice Thrown when a low-level call in proposal execution fails.
    error ProposalExecutionFailed();
    /// @notice Thrown when a contract deployment fails.
    error DeploymentFailed();
    /// @notice Thrown when the recipient address is the zero address.
    error InvalidRecipient();
    /// @notice Thrown when a required amount parameter is zero.
    error AmountZero();
    /// @notice Thrown when the treasury has insufficient balance.
    error InsufficientTreasuryBalance();
    /// @notice Thrown when the treasury has no funds available.
    error NoTreasuryFunds();
    /// @notice Thrown when the entry fee is below the minimum threshold.
    error EntryFeeTooSmall();
    /// @notice Thrown when the entry fee is not a multiple of ten.
    error InvalidEntryFee();
    /// @notice Thrown when an entry fee curve configuration is invalid.
    error InvalidCurveConfig();
    /// @notice Thrown when fee percentages do not sum correctly or exceed limits.
    error InvalidPercentageSplit();
    /// @notice Thrown when there are no rewards available to claim.
    error NoRewardsToClaim();
    /// @notice Thrown when the member pool lacks sufficient funds.
    error InsufficientPoolBalance();
    /// @notice Thrown when attempting to set the member limit below the current member count.
    error MemberLimitTooLow();
    /// @notice Thrown when attempting to join while the membership cap is already full.
    error MemberLimitReached();
    /// @notice Thrown when a limit is zero or exceeds the maximum allowed.
    error LimitOutOfRange();
    /// @notice Thrown when the caller is the contract itself.
    error InvalidSender();
    /// @notice Thrown when provided call data does not match an allowed function signature.
    error InvalidCallData();
    /// @notice Thrown when attempting to change the access token via governance.
    error TokenChangeDisabled();
    /// @notice Thrown when an action requires members but none exist.
    error NoMembers();
    /// @notice Thrown when attempting to execute a proposal that has not reached quorum.
    error QuorumNotReached();
    /// @notice Thrown when execution delay after quorum has not elapsed.
    error ExecutionDelayActive();
    /// @notice Thrown when a provided percentage value is invalid.
    error InvalidPercentage();
    /// @notice Thrown when priest dictatorship mode disables proposal-based governance.
    error DictatorshipEnabled();
    /// @notice Thrown when attempting to toggle dictatorship to its current state.
    error DictatorshipUnchanged();
    /// @notice Thrown when the external reward registry has reached its capacity.
    error ExternalRewardLimitReached();
    /// @notice Thrown when attempting to clear an external reward token that still holds value.
    error ExternalRewardsNotSettled();
    /// @notice Thrown when templ creation is restricted to the factory deployer.
    error FactoryAccessRestricted();
    /// @notice Thrown when a non-deployer attempts to update factory permissionless settings.
    error NotFactoryDeployer();
    /// @notice Thrown when attempting to set permissionless mode to its current state.
    error PermissionlessUnchanged();
}
