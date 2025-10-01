// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IEncumbrancePolicy} from "../liquefaction/contracts/wallet/IEncumbrancePolicy.sol";
import {IEncumberedWallet} from "../liquefaction/contracts/wallet/IEncumberedWallet.sol";
import {TransactionSerializer} from "../liquefaction/contracts/parsing/TransactionSerializer.sol";
import {Type2TxMessage, Type2TxMessageSigned} from "../liquefaction/contracts/parsing/EthereumTransaction.sol";
import {StorageProof, ProvethVerifier, TransactionProof} from "../liquefaction/contracts/proveth/ProvethVerifier.sol";
import {IBlockHashOracle} from "../liquefaction/contracts/wallet/IBlockHashOracle.sol";
import {RLPReader} from "solidity-rlp/contracts/RLPReader.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {DelayedFinalization} from "./DelayedFinalization.sol";
import {DestinationAsset} from "./DestinationAsset.sol";
import {IConstrainedTransactionPolicy} from "./IConstrainedTransactionPolicy.sol";

struct SignedIncludedTx {
    bytes32 unsignedTxHash;
    uint256 blockNumber;
}

/**
 * @title Constrained Transaction Encumbrance Policy
 * @notice Policy that handles logic for controlling sub-policies that require Ethereum transaction signatures.
 */
contract ConstrainedTransactionPolicy is IConstrainedTransactionPolicy, EIP712 {
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for bytes;

    using DelayedFinalization for mapping(bytes32 => DelayedFinalization.ValueStatus);

    // Storage mapping for testing values

    /// @notice The encumbered wallet contract that this policy trusts
    IEncumberedWallet walletContract;
    /// @notice Trusted oracle for block hashes from Ethereum
    IBlockHashOracle public ethBlockHashOracle;
    /// @notice Library for verifying transaction inclusion and state proofs
    ProvethVerifier public stateVerifier;
    /// @notice policy address => encumbered address => chain ID => balance
    /// ETH balances allocated to each sub-policy on each chain
    mapping(bytes32 => DelayedFinalization.ValueStatus) private subPolicyEthBalance;
    /// @notice Mapping from encumbered address and asset to the sub-policy contract
    mapping(address => mapping(bytes32 => IEncumbrancePolicy)) private encumbranceSubContract;
    /// @notice Mapping from encumbered address and asset to the expiry time
    mapping(address => mapping(bytes32 => uint256)) private encumbranceExpiry;
    /// @notice Account nonce mapping: encumbered address => chain ID => transaction count
    mapping(bytes32 => DelayedFinalization.ValueStatus) public transactionCounts;
    /// @notice Tracks deposit transactions that have been included
    mapping(bytes32 => bool) public depositTransactionsSeen;
    /// @notice Expiration time for this contract on a particular encumbered account
    mapping(address => uint256) private ourExpiration;
    /// @notice Manager for a particular encumbered account
    mapping(address => address) private manager;
    /// @notice Stores all signed transactions by account and sub-policy
    mapping(address => mapping(address => SignedIncludedTx[])) private signedIncludedTransactions;
    /// @notice Tracks the balance of the sub-policy on the TEE blockchain:
    ///         sub-policy -> encumbered address -> chain ID -> value
    mapping(bytes32 => DelayedFinalization.ValueStatus) private subPolicyLocalBalance;

    /**
     * @notice Construct a new EthTransactionPolicy
     * @param encumberedWallet The encumbered wallet contract that acts as the super-policy
     * @param _ethBlockHashOracle Trusted oracle for block hashes
     * @param _stateVerifier Library for verifying transaction inclusion and state proofs
     */
    constructor(
        IEncumberedWallet encumberedWallet,
        IBlockHashOracle _ethBlockHashOracle,
        ProvethVerifier _stateVerifier
    ) EIP712("EthTransactionPolicy", "1") {
        walletContract = encumberedWallet;
        ethBlockHashOracle = _ethBlockHashOracle;
        stateVerifier = _stateVerifier;
    }

    function min(uint a, uint b) internal pure returns (uint) {
        return a < b ? a : b;
    }

    /**
     * @notice Encodes the given asset into a bytes32
     * @param asset The asset to encode
     * @return encodedAsset The encoded asset as a bytes32
     */
    function getEncodedAsset(DestinationAsset memory asset) public pure returns (bytes32 encodedAsset) {
        return keccak256(abi.encode(asset.chainId, asset.to));
    }

    /**
     * @notice Get the asset ID of a transaction
     * @param transaction The transaction to examine
     * @return asset The asset ID
     */
    function findAssetFromTx(Type2TxMessage memory transaction) public pure returns (bytes32 asset) {
        return
            getEncodedAsset(
                DestinationAsset({chainId: transaction.chainId, to: address(bytes20(transaction.destination))})
            );
    }

    /**
     * @notice Estimate the gas cost of submitting an inclusion proof
     * @param length The length of the transaction, in bytes
     * @return cost The estimated gas cost of the transaction
     */
    function estimateInclusionProofCost(uint256 length) public pure returns (uint256) {
        return ((length / 1024) * 86853 + 289032) * 100e9;
    }

    /**
     * @notice Get the maximum cost of a transaction
     * @param transaction The transaction to get the cost of
     * @return cost The cost of the transaction
     */
    function getMaxTransactionCost(Type2TxMessage memory transaction) public pure returns (uint256 cost) {
        cost = transaction.amount + transaction.gasLimit * transaction.maxFeePerGas;
    }

    /**
     * @notice Get the balance of an account that is controlled by a given sub-policy
     * @dev This function is only callable by an enrolled sub-policy
     * @param account The account to get the balance for
     * @param chainId The chain ID to get the balance for
     * @return balance The balance owned by the sub-policy
     */
    function getEthBalance(address account, uint256 chainId) public view returns (uint256) {
        // Prevent leaking which accounts are not encumbered (thwarting deniability) using the zero address's balance
        require(msg.sender != address(0), "Authentication required");
        return subPolicyEthBalance.finalizedValue(keccak256(abi.encode(msg.sender, account, chainId)));
    }

    /**
     * @notice Get the next nonce of an account that is controlled by a given sub-policy
     * @dev This function is only callable by an enrolled sub-policy
     * @param account The account to get the balance for
     * @param chainId The chain ID to get the balance for
     * @return The transaction count of this account
     */
    function getNextNonce(address account, uint256 chainId) public view returns (uint256) {
        require(msg.sender != address(0), "Authentication required");
        require(msg.sender == manager[account], "Not the current manager");
        return transactionCounts.finalizedValue(keccak256(abi.encode(account, chainId)));
    }

    /**
     * @notice Get the balance owned by a sub-policy on the TEE blockchain
     * @param account The account to get the local balance for
     * @param chainId The chain ID to get the local balance for
     * @return balance The local balance owned by the sub-policy on the TEE blockchain
     */
    function getSubpolicyLocalBalance(address account, uint256 chainId) public view returns (uint256) {
        return subPolicyLocalBalance.finalizedValue(keccak256(abi.encode(msg.sender, account, chainId)));
    }

    /**
     * @notice Get all the signed transactions included in the chain for a specific sub-policy
     * @dev We expect msg.sender to be a sub-policy
     * @param account The account to get the signed transactions for
     */
    function getSignedIncludedTransaction(
        address account,
        uint256 index
    ) public view returns (SignedIncludedTx memory) {
        return signedIncludedTransactions[account][msg.sender][index];
    }

    /**
     * @dev NOTE: This function will leak the transaction in question via depositTransactionsSeen storage access.
     * This may be mitigated by requiring authentication to *some* enrolled sub-policy when accessing
     * confidential storage slots (e.g., in commitToDeposit), at the cost of deniability. Alternatively,
     * with no such mitigation, non-encumbered transactions may have their transactions committed and "deposited"
     * to no real effect as a distraction, adding deniability.
     * @notice Deposits funds that have been committed into the account
     * @param signedTx The signed transaction that has been used to deposit funds into the account
     * @param inclusionProof The inclusion proof of the transaction
     * @param proofBlockNumber The number of the block where the transaction was included
     */
    function depositFunds(
        Type2TxMessageSigned calldata signedTx,
        TransactionProof memory inclusionProof,
        uint256 proofBlockNumber
    ) public {
        // Verify that the transaction has been included in the chain
        Type2TxMessageSigned memory signedTxCopy = signedTx;
        signedTxCopy.v -= 27;
        bytes memory includedTx = stateVerifier.validateTxProof(inclusionProof);
        bytes32 signedTxHash = keccak256(TransactionSerializer.serializeSignedTransaction(signedTxCopy));

        // Authenticate
        require(msg.sender != address(0), "Unauthenticated");

        require(depositTransactionsSeen[signedTxHash] == false, "Transaction already seen");
        require(keccak256(includedTx) == signedTxHash, "Inclusion proof of an incorrect or absent transaction");

        // Calculate signer address
        bytes memory unsignedTxData = TransactionSerializer.serializeTransaction(signedTx.transaction);
        bytes32 unsignedTxHash = keccak256(unsignedTxData);
        bytes memory signature = bytes.concat(bytes32(signedTx.r), bytes32(signedTx.s), bytes1(uint8(signedTx.v)));
        (, ECDSA.RecoverError error, ) = ECDSA.tryRecover(unsignedTxHash, signature);
        require(error == ECDSA.RecoverError.NoError, "Invalid signature");

        // Prove inclusion
        require(
            keccak256(inclusionProof.rlpBlockHeader) == ethBlockHashOracle.getBlockHash(proofBlockNumber),
            "Block hash incorrect or not found in oracle"
        );

        // Update account balances
        uint256 chainId = signedTx.transaction.chainId;
        address destination = address(bytes20(signedTx.transaction.destination));
        uint256 amount = signedTx.transaction.amount;

        // TODO: For this version of the policy (for the demo), we'll protect against funding before the manager has been set
        require(manager[destination] != address(0), "Manager not set yet for this account");

        subPolicyEthBalance.increaseValue(keccak256(abi.encode(manager[destination], destination, chainId)), amount);
        depositTransactionsSeen[signedTxHash] = true;
    }

    /**
     * @notice Deposits funds into the local balance of a sub-policy
     * @param account The account to deposit the funds into
     * @param chainId The chain ID to deposit the funds into
     */
    function depositLocalFunds(address account, uint256 chainId) public payable {
        address subPolicy = manager[account];
        require(subPolicy != address(0), "Manager not set yet for this account");
        require(msg.value > 0, "No funds to deposit");
        subPolicyLocalBalance.increaseValue(keccak256(abi.encode(subPolicy, account, chainId)), msg.value);
    }

    /**
     * @dev Called by the key-encumbered wallet contract when an account is enrolled in this policy
     * @notice Notifies the policy that encumbrance has begun
     * @param account The address of the account that is being encumbered
     * @param assets The assets that the account is enrolled in
     * @param expiration The expiration time of the encumbrance
     * @param data This should include the managerAddress in address format
     */
    function notifyEncumbranceEnrollment(
        address,
        address account,
        bytes32[] calldata assets,
        uint256 expiration,
        bytes calldata data
    ) public {
        // Ensure the sender is a wallet linked to this policy
        require(msg.sender == address(walletContract), "Not a wallet contract under this policy");
        require(expiration >= block.timestamp, "Expiration is in the past");
        bool correctAsset = false;
        for (uint256 i = 0; i < assets.length; i++) {
            if (assets[i] == bytes32(uint256(0x02))) {
                correctAsset = true;
            }
        }
        require(correctAsset, "Ethereum transaction asset is required");
        ourExpiration[account] = expiration;
        address managerAddr = abi.decode(data, (address));
        manager[account] = managerAddr;
    }

    /**
     * @notice Irrevocably transfers the manager role to another address.
     * @param account Encumbered account
     * @param newManager New manager address
     */
    function transferManagerOwnership(address account, address newManager) public {
        require(msg.sender == manager[account], "Not the current manager");
        manager[account] = newManager;
    }

    function isContract(address _addr) public view returns (bool) {
        uint32 size;
        assembly {
            size := extcodesize(_addr)
        }
        return size > 0;
    }

    /**
     * @notice Enrolls an sub-policy in an encumbrance contract via this policy
     * @param account The encumbered account that the sub-policy will gain control over
     * @param destinations The destination assets that will be enrolled
     * @param subPolicy The sub-policy that is being enrolled
     * @param expiry The expiry time of the sub-policy controll over the encumbered account
     */
    function enterEncumbranceContract(
        address account,
        DestinationAsset[] calldata destinations,
        IEncumbrancePolicy subPolicy,
        uint256 expiry,
        bytes calldata data
    ) public {
        require(block.timestamp < expiry, "Already expired");
        require(address(subPolicy) != address(0), "Policy not specified");
        require(msg.sender == manager[account], "Not encumbered account's tx manager");
        require(expiry <= ourExpiration[account], "Expiry is after account's encumbrance expires");
        bytes32[] memory assets = new bytes32[](destinations.length);
        for (uint256 i = 0; i < destinations.length; i++) {
            bytes32 asset = getEncodedAsset(destinations[i]);
            uint256 previousExpiry = encumbranceExpiry[account][asset];
            require(previousExpiry == 0 || previousExpiry < block.timestamp, "Already encumbered");
            encumbranceSubContract[account][asset] = subPolicy;
            encumbranceExpiry[account][asset] = expiry;
            assets[i] = asset;
        }

        if (isContract(address(subPolicy))) {
            subPolicy.notifyEncumbranceEnrollment(manager[account], account, assets, expiry, data);
        }
    }

    /**
     * @notice Proves the inclusion of a transaction on the other chain
     * @param signedTx The signed transaction to prove inclusion of
     * @param inclusionProof The inclusion proof of the transaction
     * @param proofBlockNumber The number of the block where the transaction was included
     */
    function proveTransactionInclusion(
        Type2TxMessageSigned calldata signedTx,
        TransactionProof memory inclusionProof,
        uint256 proofBlockNumber
    ) public {
        uint256 chainId = signedTx.transaction.chainId;

        // Calculate signer address
        bytes memory unsignedTxData = TransactionSerializer.serializeTransaction(signedTx.transaction);
        address signerAccount;
        bytes32 unsignedTxHash = keccak256(unsignedTxData);
        {
            bytes memory signature = bytes.concat(bytes32(signedTx.r), bytes32(signedTx.s), bytes1(uint8(signedTx.v)));
            ECDSA.RecoverError error;
            (signerAccount, error, ) = ECDSA.tryRecover(unsignedTxHash, signature);
            require(error == ECDSA.RecoverError.NoError, "Invalid signature");
        }

        // Prove inclusion
        require(
            keccak256(inclusionProof.rlpBlockHeader) == ethBlockHashOracle.getBlockHash(proofBlockNumber),
            "Block hash incorrect or not found in oracle"
        );

        Type2TxMessageSigned memory signedTxCopy = signedTx;
        signedTxCopy.v -= 27;
        bytes memory includedTx = stateVerifier.validateTxProof(inclusionProof);
        bytes32 signedTxHash = keccak256(TransactionSerializer.serializeSignedTransaction(signedTxCopy));
        require(keccak256(includedTx) == signedTxHash, "Inclusion proof of an incorrect or absent transaction");

        // Update nonce
        require(
            signedTx.transaction.nonce ==
                transactionCounts.finalizedValue(keccak256(abi.encode(signerAccount, chainId))),
            "Proof out of order"
        );
        transactionCounts.setIncreasedValue(
            keccak256(abi.encode(signerAccount, chainId)),
            signedTx.transaction.nonce + 1
        );
        // Update account balances
        // TODO: Could use receipt to update gas cost.
        bytes32 asset = getEncodedAsset(
            DestinationAsset({
                chainId: signedTx.transaction.chainId,
                to: address(bytes20(signedTx.transaction.destination))
            })
        );

        address subPolicy = address(encumbranceSubContract[signerAccount][asset]);
        uint256 policyEthBalance = subPolicyEthBalance.finalizedValue(
            keccak256(abi.encode(subPolicy, signerAccount, chainId))
        );
        uint256 cost = getMaxTransactionCost(signedTx.transaction);

        // The cost should have been verified at the time of signing
        uint256 finalCost = min(policyEthBalance, cost);
        subPolicyEthBalance.decreaseValue(keccak256(abi.encode(subPolicy, signerAccount, chainId)), finalCost);

        // Record the transaction as signed
        signedIncludedTransactions[signerAccount][address(subPolicy)].push(
            SignedIncludedTx({unsignedTxHash: unsignedTxHash, blockNumber: proofBlockNumber})
        );

        // Pay for the gas cost
        uint256 transferAmount = min(
            estimateInclusionProofCost(signedTx.transaction.payload.length),
            subPolicyLocalBalance.finalizedValue(keccak256(abi.encode(address(subPolicy), signerAccount, chainId)))
        );

        // This contract's balance should never be less.
        transferAmount = min(transferAmount, address(this).balance);

        subPolicyLocalBalance.decreaseValue(
            keccak256(abi.encode(address(subPolicy), signerAccount, chainId)),
            transferAmount
        );
        payable(msg.sender).transfer(transferAmount);
    }

    /**
     * @notice Signs a transaction off-chain using the encumbered account's key
     * @param account The encumbered account which which signs the transaction
     * @param transaction The transaction to sign
     */
    function signTransaction(address account, Type2TxMessage memory transaction) public view returns (bytes memory) {
        require(
            estimateInclusionProofCost(transaction.payload.length) <=
                subPolicyLocalBalance.finalizedValue(keccak256(abi.encode(msg.sender, account, transaction.chainId))),
            "Insufficient local balance to pay for inclusion proof"
        );
        bytes32 asset = findAssetFromTx(transaction);
        require(address(encumbranceSubContract[account][asset]) == msg.sender, "Not the enrolled subpolicy");
        require(block.timestamp < encumbranceExpiry[account][asset], "Sub-policy lease expired");
        require(
            transaction.nonce == transactionCounts.finalizedValue(keccak256(abi.encode(account, transaction.chainId))),
            "Incorrect nonce"
        );
        require(
            subPolicyEthBalance.finalizedValue(keccak256(abi.encode(msg.sender, account, transaction.chainId))) >=
                getMaxTransactionCost(transaction),
            "Insufficient balance to send this transaction"
        );

        // Update nonce to correct nonce of transaction and return the signed message
        return walletContract.signMessage(account, TransactionSerializer.serializeTransaction(transaction));
    }
}
