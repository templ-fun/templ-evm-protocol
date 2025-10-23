// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title Bytecode Utils
/// @notice Helpers for constructing creation code and reading deployed bytecode ranges.
/// @author templ.fun
library Bytecode {
    error InvalidCodeAtRange(uint256 size, uint256 start, uint256 end);

    /// @notice Generate creation code that results in a contract with `_code` as bytecode.
    /// @param _code Runtime code for the deployed contract.
    /// @return Creation code that deploys a contract with `_code` as runtime bytecode.
    function creationCodeFor(bytes memory _code) internal pure returns (bytes memory) {
        return abi.encodePacked(hex"63", uint32(_code.length), hex"80_60_0E_60_00_39_60_00_F3", _code);
    }

    /// @notice Returns the size of the code stored at `_addr`.
    /// @param _addr Address to inspect.
    /// @return size Size of the runtime bytecode at the address.
    function codeSize(address _addr) internal view returns (uint256 size) {
        assembly ("memory-safe") {
            size := extcodesize(_addr)
        }
    }

    /// @notice Returns the code stored at `_addr` within the specified window.
    /// @param _addr Address to read from.
    /// @param _start Inclusive start offset within the runtime bytecode.
    /// @param _end Exclusive end offset within the runtime bytecode.
    /// @return code Slice of code bytes in the requested range.
    function codeAt(address _addr, uint256 _start, uint256 _end) internal view returns (bytes memory code) {
        uint256 csize = codeSize(_addr);
        if (csize == 0) return bytes("");
        if (_start > csize) return bytes("");
        if (_end < _start) revert InvalidCodeAtRange(csize, _start, _end);

        unchecked {
            uint256 reqSize = _end - _start;
            uint256 maxSize = csize - _start;
            uint256 size = maxSize < reqSize ? maxSize : reqSize;

            assembly ("memory-safe") {
                code := mload(0x40)
                mstore(0x40, add(code, and(add(add(size, 0x20), 0x1f), not(0x1f))))
                mstore(code, size)
                extcodecopy(_addr, add(code, 0x20), _start, size)
            }
        }
    }
}
