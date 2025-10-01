// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

interface ITrivialBlockHashOracle {
    function setBlockHash(uint256 _blockNumber, bytes32 _hash) external;
    function transferOwnership(address newOwner) external;
}
