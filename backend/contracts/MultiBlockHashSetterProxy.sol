// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ITrivialBlockHashOracle} from "./ITrivialBlockHashOracle.sol";

contract MultiBlockHashSetterProxy is Ownable2Step {
    ITrivialBlockHashOracle public oracleContract;

    constructor(ITrivialBlockHashOracle _oracleContractAddress) Ownable(msg.sender) {
        oracleContract = _oracleContractAddress;
    }

    function setMultipleBlockHashes(uint256[] calldata _blockNumbers, bytes32[] calldata _hashes) external onlyOwner {
        require(_blockNumbers.length == _hashes.length, "Block numbers and hashes arrays must be of the same length");

        for (uint256 i = 0; i < _blockNumbers.length; i++) {
            oracleContract.setBlockHash(_blockNumbers[i], _hashes[i]);
        }
    }

    function transferOracleOwnership(address newOwner) external onlyOwner {
        oracleContract.transferOwnership(newOwner);
    }
}
