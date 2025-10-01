// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// The purpose of this file is simply to bring in artifacts from the Liquefaction repository to this project.
import {
    TrivialBlockHashOracle
} from "../../liquefaction/contracts/wallet/encumbrance-policies/examples/TrivialBlockHashOracle.sol";
import {MinimalUpgradableWalletReceiver} from "../../liquefaction/contracts/wallet/MinimalUpgradableWalletReceiver.sol";
