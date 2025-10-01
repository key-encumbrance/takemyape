// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {IEncumbrancePolicy} from "../liquefaction/contracts/wallet/IEncumbrancePolicy.sol";
import {BasicEncumberedWallet} from "../liquefaction/contracts/wallet/BasicEncumberedWallet.sol";
import {EIP712DomainParams} from "../liquefaction/contracts/parsing/EIP712Utils.sol";

/**
 * @title WalletConnect Message Policy
 * @notice A policy that allows signing of non-transaction messages for WalletConnect
 */
contract WalletConnectMessagePolicy is IEncumbrancePolicy {
    // The encumbered wallet contract
    BasicEncumberedWallet public encumberedWallet;

    // The address that is allowed to use this policy (wallet owner)
    mapping(address => address) public authorizedManagers;

    /**
     * @param _encumberedWallet The address of the BasicEncumberedWallet contract
     */
    constructor(address _encumberedWallet) {
        encumberedWallet = BasicEncumberedWallet(_encumberedWallet);
    }

    /**
     * @notice Called when the policy is enrolled for an account
     * @dev Stores the account owner as authorized to use this policy for the account
     */
    function notifyEncumbranceEnrollment(
        address /* accountOwner */,
        address account,
        bytes32[] calldata /* assets */,
        uint256 /* expiration */,
        bytes calldata data
    ) external override {
        // Only allow the encumbered wallet to call this function
        require(msg.sender == address(encumberedWallet), "Unauthorized enrollment");

        // Store the authorized account owner
        authorizedManagers[account] = abi.decode(data, (address));
    }

    /**
     * @notice Sign a message through the encumbered wallet
     * @param message The message to sign
     * @return The signature
     */
    function signMessage(bytes calldata message, address account) external view returns (bytes memory) {
        // Verify the message is not a transaction (transactions start with 0x02)
        // This is checked at the wallet level anyway, but this provides a friendly
        // message explaining the reason.
        require(message.length == 0 || message[0] != hex"02", "Transaction signing not allowed");
        // Ensure sender is the authorized account owner for this account
        require(authorizedManagers[account] == msg.sender, "Only account owner can sign");

        // Call the encumbered wallet to sign the message
        return encumberedWallet.signMessage(account, message);
    }

    /**
     * @notice Sign typed data through the encumbered wallet
     * @param account The wallet address that should sign the data
     * @param domain EIP-712 domain
     * @param dataType Data type according to EIP-712
     * @param data Struct containing the data contents
     * @return The signature
     */
    function signTypedData(
        address account,
        EIP712DomainParams memory domain,
        string calldata dataType,
        bytes calldata data
    ) external view returns (bytes memory) {
        // Ensure sender is the authorized account owner for this account
        require(authorizedManagers[account] == msg.sender, "Only account owner can sign");

        // Call the encumbered wallet to sign the typed data
        return encumberedWallet.signTypedData(account, domain, dataType, data);
    }
}
