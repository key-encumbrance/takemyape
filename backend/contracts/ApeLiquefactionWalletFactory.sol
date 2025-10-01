// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {BasicEncumberedWallet, EIP712DomainParams} from "../liquefaction/contracts/wallet/BasicEncumberedWallet.sol";
import {IEncumbrancePolicy} from "../liquefaction/contracts/wallet/IEncumbrancePolicy.sol";
import {INFTAuctionPolicy} from "./INFTAuctionPolicy.sol";
import {IConstrainedTransactionPolicy} from "./IConstrainedTransactionPolicy.sol";
import {IEncumberedWallet} from "../liquefaction/contracts/wallet/IEncumberedWallet.sol";
import {DestinationAsset} from "./DestinationAsset.sol";

/**
 * @title ApeLiquefactionWalletFactory
 * @notice A factory contract that creates new wallets within a pre-deployed BasicEncumberedWallet,
 *         auto-initializing them with an encumbrance policy we trust. Implements IEncumberedWallet.
 */
contract ApeLiquefactionWalletFactory {
    /**
     * @notice Pre-deployed BasicEncumberedWallet contract address
     */
    IEncumberedWallet public immutable signingWallet;

    /**
     * @notice Transaction policy
     */
    IConstrainedTransactionPolicy public immutable txPolicy;

    /**
     * @notice NFT auction policy
     */
    INFTAuctionPolicy public immutable nftAuctionPolicy;

    /**
     * @notice Message policy used for auto-initialization
     */
    IEncumbrancePolicy public messagePolicy;

    /**
     * @notice Expiration time for the initial encumbrance contract (in seconds)
     */
    uint256 public immutable initialEncumbranceExpiration;

    /**
     * @notice Records whether a particular address was created through this factory
     */
    mapping(address => bool) private createdFromFactory;
    mapping(address => address) private creator;

    /**
     * @notice Constructor for ApeEncumbranceFactory.
     * @param _parentWallet The pre-deployed BasicEncumberedWallet contract address.
     * @param _txPolicy The transaction policy contract address.
     * @param _nftAuctionPolicy The policy governing the NFT auction
     * @param _initialEncumbranceExpiration The expiration time for the initial encumbrance contract (in seconds).
     * @dev Initializes the contract with the provided parameters.
     */
    constructor(
        address _parentWallet,
        IConstrainedTransactionPolicy _txPolicy,
        INFTAuctionPolicy _nftAuctionPolicy,
        IEncumbrancePolicy _messagePolicy,
        uint256 _initialEncumbranceExpiration
    ) {
        signingWallet = BasicEncumberedWallet(_parentWallet);
        txPolicy = _txPolicy;
        nftAuctionPolicy = _nftAuctionPolicy;
        messagePolicy = _messagePolicy;
        initialEncumbranceExpiration = _initialEncumbranceExpiration;
    }

    /**
     * @notice Initializes a wallet with the encumbrance policies.
     * @param index The index of the wallet.
     * @dev Enters the encumbrance contracts on behalf of the wallet.
     */
    function _initializeWalletWithPolicies(uint256 index) internal {
        bytes32[] memory txPolicyAssets = new bytes32[](1);
        // Ethereum transaction asset type
        txPolicyAssets[0] = bytes32(uint256(0x02));
        uint256 expiration = block.timestamp + initialEncumbranceExpiration;

        // Enter the encumbrance contract on behalf of the wallet
        bytes memory txPolicyData = abi.encode(address(this));
        signingWallet.enterEncumbranceContract(index, txPolicyAssets, txPolicy, expiration, txPolicyData);

        // Setup for message signing policy
        bytes32[] memory messageAssets = new bytes32[](2);
        // EIP-191 "Ethereum Signed Message" messages
        messageAssets[0] = bytes32(uint256(0x1945));
        messageAssets[1] = bytes32(uint256(0x0));
        // You can add other message types here if needed

        // Enter the message signing encumbrance contract
        bytes memory senderAsData = abi.encode(msg.sender);
        signingWallet.enterEncumbranceContract(index, messageAssets, messagePolicy, expiration, senderAsData);

        // Enter transaction sub-policy contract
        address encWalletAddr = signingWallet.getWalletAddress(index);
        // Record that this address was created in the factory
        require(!createdFromFactory[encWalletAddr], "Already recorded in createdFromFactory");
        createdFromFactory[encWalletAddr] = true;
        creator[encWalletAddr] = msg.sender;

        // Enter transaction sub-policy contract
        DestinationAsset[] memory nftAuctionPolicyAssets = new DestinationAsset[](1);
        nftAuctionPolicyAssets[0] = nftAuctionPolicy.getNFTAsset();
        txPolicy.enterEncumbranceContract(
            encWalletAddr,
            nftAuctionPolicyAssets,
            nftAuctionPolicy,
            expiration,
            abi.encode(msg.sender)
        );

        // Transfer the manager role to the NFT auction policy
        // This design is mostly for ease of use in this demo and notifying the
        // NFT auction policy. Usually, you would not need to do this because
        // the encumbrance contract is all you need.
        txPolicy.transferManagerOwnership(encWalletAddr, address(nftAuctionPolicy));
    }

    /**
     * @notice Derives a unique wallet index for the caller based on the provided index.
     * @param walletIndex The base index to derive the wallet index from.
     * @return The derived wallet index, unique to the caller.
     * @dev This approach ensures that different callers each receive a distinct wallet index.
     */
    function deriveWalletIndex(uint256 walletIndex) public view returns (uint256) {
        uint256 yourIndex = uint256(keccak256(bytes.concat(bytes20(msg.sender), bytes32(walletIndex))));
        return yourIndex;
    }

    /**
     * @notice Creates a new encumbered wallet and auto-enrolls it into the required encumbrance policies.
     * @param walletIndex The index of the new wallet.
     * @return created True if a new wallet was created, false otherwise.
     * @return accountIndex Account index of the account in the recipient's wallet (TODO: this could be encrypted)
     */
    function createWallet(uint256 walletIndex) public returns (bool created, uint256 accountIndex) {
        // Create a new wallet within the pre-deployed BasicEncumberedWallet
        require(msg.sender != address(0), "Unauthenticated call (you are the zero address)");
        uint256 yourIndex = deriveWalletIndex(walletIndex);
        created = signingWallet.createWallet(yourIndex);

        if (created) {
            // Auto-initialize the wallet with the encumbrance policy
            _initializeWalletWithPolicies(yourIndex);
            accountIndex = BasicEncumberedWallet(address(signingWallet)).transferAccountOwnership(
                yourIndex,
                msg.sender
            );
        }
    }

    /**
     * @notice Returns whether an address was created in this factory by the sender.
     * @param addr Address to check
     * @return True if the address was generated in this factory by the sender.
     */
    function createdBySender(address addr) public view returns (bool) {
        return msg.sender != address(0) && creator[addr] == msg.sender;
    }

    /**
     * @notice Returns whether an address was created in this factory.
     * @param addr Address to check
     * @return True if the address was generated in this factory.
     */
    function createdByFactory(address addr) public view returns (bool) {
        // For privacy, we would add this require statement, but in order for
        // us to debug the demo, we'll make this public.

        // require(msg.sender == address(nftAuctionPolicy), "Only the auction policy can call this function");
        return creator[addr] != address(0);
    }
}
