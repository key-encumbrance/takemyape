// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {INFTAuctionPolicy} from "./INFTAuctionPolicy.sol";
import {ICurrentOwnerMessageReceiver} from "./NFTAuctionPolicy.sol";

contract NFTOwnerControls is ICurrentOwnerMessageReceiver {
    // Auction policy which knows who has the NFT
    INFTAuctionPolicy auctionPolicy;

    // Blur state of the NFT image
    bool public isImageBlurred = false;

    // Function signatures
    bytes4 private constant SET_IMAGE_BLURRED_SIG = bytes4(keccak256("setImageBlurred(bool)"));

    constructor(INFTAuctionPolicy _auctionPolicy) {
        auctionPolicy = _auctionPolicy;
    }

    function getImageBlurred() public view returns (bool) {
        return isImageBlurred;
    }

    function onCurrentOwnerMessage(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(auctionPolicy), "Not sent by the auction policy");
        require(data.length >= 4, "Invalid data length");
        bytes4 functionSignature = bytes4(data[0:4]);

        if (functionSignature == SET_IMAGE_BLURRED_SIG) {
            bool _isBlurred = abi.decode(data[4:], (bool));
            isImageBlurred = _isBlurred;
        } else {
            revert("Unknown function signature");
        }

        return "";
    }
}
