// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { SSTORE2 } from "./SSTORE2.sol";
import { Bytecode } from "./Bytecode.sol";

/// @title BytecodeHarness
/// @dev Testing harness that exercises SSTORE2 and Bytecode helper branches
contract BytecodeHarness {
    address public lastPointer;

    function store(bytes memory data) external returns (address pointer) {
        pointer = SSTORE2.write(data);
        lastPointer = pointer;
    }

    function readAll(address pointer) external view returns (bytes memory) {
        return SSTORE2.read(pointer);
    }

    function readFrom(address pointer, uint256 start) external view returns (bytes memory) {
        return SSTORE2.read(pointer, start);
    }

    function readRange(address pointer, uint256 start, uint256 end) external view returns (bytes memory) {
        return SSTORE2.read(pointer, start, end);
    }

    function codeAt(address target, uint256 start, uint256 end) external view returns (bytes memory) {
        return Bytecode.codeAt(target, start, end);
    }

    function codeSize(address target) external view returns (uint256) {
        return Bytecode.codeSize(target);
    }

    function creationCode(bytes memory runtime) external pure returns (bytes memory) {
        return Bytecode.creationCodeFor(runtime);
    }
}
