// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {IEncumbrancePolicy} from "../liquefaction/contracts/wallet/IEncumbrancePolicy.sol";
import {DestinationAsset} from "./DestinationAsset.sol";

interface IConstrainedTransactionPolicy is IEncumbrancePolicy {
    // Irrevocably transfer manager status to another account
    function transferManagerOwnership(address account, address newManager) external;

    // Manager can enter into a sub-policy
    function enterEncumbranceContract(
        address account,
        DestinationAsset[] calldata destinations,
        IEncumbrancePolicy subPolicy,
        uint256 expiry,
        bytes calldata
    ) external;
}
