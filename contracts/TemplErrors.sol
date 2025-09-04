// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title TemplErrors
/// @notice Shared custom errors for TEMPL contracts
library TemplErrors {
    error ReentrantCall();
    error NotMember();
    error NotDAO();
    error ContractPausedError();
    error AlreadyPurchased();
    error InsufficientBalance();
    error TitleRequired();
    error DescriptionRequired();
    error CallDataRequired();
    error CallDataTooShort();
    error ActiveProposalExists();
    error VotingPeriodTooShort();
    error VotingPeriodTooLong();
    error InvalidProposal();
    error VotingEnded();
    error AlreadyVoted();
    error JoinedAfterProposal();
    error VotingNotEnded();
    error AlreadyExecuted();
    error ProposalNotPassed();
    error ProposalExecutionFailed();
    error InvalidRecipient();
    error AmountZero();
    error InsufficientTreasuryBalance();
    error NoTreasuryFunds();
    error EntryFeeTooSmall();
    error InvalidEntryFee();
    error NoRewardsToClaim();
    error InsufficientPoolBalance();
    error LimitOutOfRange();
    error NonZeroBalances();
    error InvalidSender();
    error InvalidCallData();
}

