// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {IEncumbrancePolicy} from "../liquefaction/contracts/wallet/IEncumbrancePolicy.sol";
import {DestinationAsset} from "./DestinationAsset.sol";

interface INFTAuctionPolicy is IEncumbrancePolicy {
    // Get the NFT asset being passed around
    function getNFTAsset() external view returns (DestinationAsset memory);
    // Get the current owner (who transferred the NFT to his/her address or
    // has the capability to do so)
    function currentOwner() external view returns (address);
}
