// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Minimal ERC-721 for governance transfer tests.
contract TestNFT is ERC721 {
    uint256 private _tokenId;

    constructor(string memory name, string memory symbol) ERC721(name, symbol) {}

    function mint(address to) external returns (uint256 tokenId) {
        unchecked {
            tokenId = ++_tokenId;
        }
        _mint(to, tokenId);
    }
}
