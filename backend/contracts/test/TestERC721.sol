// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract TestERC721 is ERC721URIStorage {
    uint256 public maxTokenId;

    constructor() ERC721("TestERC721", "TE7") {}

    function safeMint(address recipient) public returns (uint256) {
        uint256 newItemId = maxTokenId;
        maxTokenId++;
        _safeMint(recipient, newItemId);
        return newItemId;
    }
}
