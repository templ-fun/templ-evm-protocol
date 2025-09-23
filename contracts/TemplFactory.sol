// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TEMPL} from "./TEMPL.sol";
import {TemplErrors} from "./TemplErrors.sol";

contract TemplFactory {
    uint256 internal constant TOTAL_PERCENT = 100;
    uint256 internal constant DEFAULT_BURN_PERCENT = 30;
    uint256 internal constant DEFAULT_TREASURY_PERCENT = 30;
    uint256 internal constant DEFAULT_MEMBER_POOL_PERCENT = 30;
    uint256 internal constant DEFAULT_QUORUM_PERCENT = 33;
    uint256 internal constant DEFAULT_EXECUTION_DELAY = 7 days;
    address internal constant DEFAULT_BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    struct CreateConfig {
        address priest;
        address token;
        uint256 entryFee;
        uint256 burnPercent;
        uint256 treasuryPercent;
        uint256 memberPoolPercent;
        uint256 quorumPercent;
        uint256 executionDelaySeconds;
        address burnAddress;
        bool priestIsDictator;
    }

    address public immutable protocolFeeRecipient;
    uint256 public immutable protocolPercent;

    event TemplCreated(
        address indexed templ,
        address indexed creator,
        address indexed priest,
        address token,
        uint256 entryFee,
        uint256 burnPercent,
        uint256 treasuryPercent,
        uint256 memberPoolPercent,
        uint256 quorumPercent,
        uint256 executionDelaySeconds,
        address burnAddress,
        bool priestIsDictator
    );

    constructor(address _protocolFeeRecipient, uint256 _protocolPercent) {
        if (_protocolFeeRecipient == address(0)) revert TemplErrors.InvalidRecipient();
        if (_protocolPercent > TOTAL_PERCENT) revert TemplErrors.InvalidPercentageSplit();
        protocolFeeRecipient = _protocolFeeRecipient;
        protocolPercent = _protocolPercent;
    }

    function createTempl(address _token, uint256 _entryFee) external returns (address templAddress) {
        CreateConfig memory cfg = CreateConfig({
            priest: msg.sender,
            token: _token,
            entryFee: _entryFee,
            burnPercent: DEFAULT_BURN_PERCENT,
            treasuryPercent: DEFAULT_TREASURY_PERCENT,
            memberPoolPercent: DEFAULT_MEMBER_POOL_PERCENT,
            quorumPercent: DEFAULT_QUORUM_PERCENT,
            executionDelaySeconds: DEFAULT_EXECUTION_DELAY,
            burnAddress: DEFAULT_BURN_ADDRESS,
            priestIsDictator: false
        });
        return _deploy(cfg);
    }

    function createTemplWithConfig(CreateConfig calldata config) external returns (address templAddress) {
        CreateConfig memory cfg = config;
        if (cfg.priest == address(0)) {
            cfg.priest = msg.sender;
        }
        if (cfg.quorumPercent == 0) {
            cfg.quorumPercent = DEFAULT_QUORUM_PERCENT;
        }
        if (cfg.executionDelaySeconds == 0) {
            cfg.executionDelaySeconds = DEFAULT_EXECUTION_DELAY;
        }
        if (cfg.burnAddress == address(0)) {
            cfg.burnAddress = DEFAULT_BURN_ADDRESS;
        }
        if (cfg.burnPercent == 0 && cfg.treasuryPercent == 0 && cfg.memberPoolPercent == 0) {
            cfg.burnPercent = DEFAULT_BURN_PERCENT;
            cfg.treasuryPercent = DEFAULT_TREASURY_PERCENT;
            cfg.memberPoolPercent = DEFAULT_MEMBER_POOL_PERCENT;
        }
        return _deploy(cfg);
    }

    function _deploy(CreateConfig memory cfg) internal returns (address templAddress) {
        if (cfg.token == address(0)) revert TemplErrors.InvalidRecipient();
        if (cfg.entryFee < 10) revert TemplErrors.EntryFeeTooSmall();
        if (cfg.entryFee % 10 != 0) revert TemplErrors.InvalidEntryFee();
        if (cfg.quorumPercent > TOTAL_PERCENT) revert TemplErrors.InvalidPercentage();
        _validatePercentSplit(cfg.burnPercent, cfg.treasuryPercent, cfg.memberPoolPercent);

        TEMPL templ = new TEMPL(
            cfg.priest,
            protocolFeeRecipient,
            cfg.token,
            cfg.entryFee,
            cfg.burnPercent,
            cfg.treasuryPercent,
            cfg.memberPoolPercent,
            protocolPercent,
            cfg.quorumPercent,
            cfg.executionDelaySeconds,
            cfg.burnAddress,
            cfg.priestIsDictator
        );
        templAddress = address(templ);
        emit TemplCreated(
            templAddress,
            msg.sender,
            cfg.priest,
            cfg.token,
            cfg.entryFee,
            cfg.burnPercent,
            cfg.treasuryPercent,
            cfg.memberPoolPercent,
            cfg.quorumPercent,
            cfg.executionDelaySeconds,
            cfg.burnAddress,
            cfg.priestIsDictator
        );
    }

    function _validatePercentSplit(
        uint256 _burnPercent,
        uint256 _treasuryPercent,
        uint256 _memberPoolPercent
    ) internal view {
        if (_burnPercent + _treasuryPercent + _memberPoolPercent + protocolPercent != TOTAL_PERCENT) {
            revert TemplErrors.InvalidPercentageSplit();
        }
    }
}
