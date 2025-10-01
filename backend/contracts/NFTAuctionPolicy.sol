// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IEncumbrancePolicy} from "../liquefaction/contracts/wallet/IEncumbrancePolicy.sol";
import {ConstrainedTransactionPolicy, SignedIncludedTx} from "./ConstrainedTransactionPolicy.sol";
import {Type2TxMessage, Type2TxMessageSigned} from "../liquefaction/contracts/parsing/EthereumTransaction.sol";
import {TransactionSerializer} from "../liquefaction/contracts/parsing/TransactionSerializer.sol";
import {DelayedFinalizationAddress} from "../liquefaction/contracts/wallet/DelayedFinalizationAddress.sol";

import {DestinationAsset} from "./DestinationAsset.sol";
import {INFTAuctionPolicy} from "./INFTAuctionPolicy.sol";
import {IWalletFactory} from "./IWalletFactory.sol";

// For receiving messages proven to be sent by the current owner
interface ICurrentOwnerMessageReceiver {
    function onCurrentOwnerMessage(bytes calldata data) external returns (bytes memory);
}

/**
 * @title NFT Encumbrance Auction Policy
 * @notice Manages an NFT's ownership through a second-price auction
 */
contract NFTAuctionPolicy is INFTAuctionPolicy, Pausable, Ownable2Step {
    // Mapping of encumbered account => authorized manager
    mapping(address => address) private authorizedManagers;
    // Mapping of encumbered account => encumbrance expiration time
    mapping(address => uint256) private expirationTimes;

    // hash(auction start time, address)
    mapping(bytes32 => bool) private hasBid;

    using DelayedFinalizationAddress for DelayedFinalizationAddress.AddressStatus;
    mapping(bytes32 => DelayedFinalizationAddress.AddressStatus) private owners;

    // Encumbered wallet with the NFT
    address public encumberedWallet;
    IWalletFactory public trustedWalletFactory;

    // Minimum remaining time the account must be enrolled in this encumbrance policy
    uint256 public minEncumbranceTimeLeft;

    // NFT details
    address public nftContract;
    uint256 public nftTokenId;
    uint256 public nftChainId;

    // Minimum values to participate in the auction
    uint256 public minEthBalance;
    uint256 public minRoseBalance;

    // We ensure the storage slots used for bids are always nonzero by reserving
    // the two most significant bits and swapping which one is used on each bid.
    // The idea is to keep the gas cost identical no matter how you bid.

    // The bid flag is always set.
    uint256 private constant BID_FLAG = (1 << 255);
    // Used to swap bits
    uint256 private constant BID_FLAG_MASK = ((1 << 255) | (1 << 254));
    // The mask to retrieve the actual bid (bypassing the bid flag)
    uint256 private constant BID_MASK = ((1 << 254) - 1);
    // The mask to retrieve the bidder (bypassing the bid flag)
    uint256 private constant BIDDER_MASK = ((1 << 160) - 1);

    // Auction details
    uint256 public minOwnershipTime;
    uint256 public auctionStartTime;
    bytes32 private topBidder = bytes32(BID_FLAG);
    uint256 private topBid = BID_FLAG;
    uint256 private secondBid = BID_FLAG;

    // Last winner paid this much
    uint256 public lastPaid;
    // Faucet address where bids will go to (defaults to the zero address)
    address public faucetAddress;

    // Bid balance
    mapping(address => uint256) private bidBalances;

    // Block number of the last proven transfer
    uint256 public previousTransferBlockNumber;

    // Constrained transaction policy
    ConstrainedTransactionPolicy public txPolicy;

    // Whitelist-only for early testing
    bool public whitelistEnabled = true;
    mapping(address => bool) public whitelisted;

    /**
     * @param _encumberedWallet Encumbered wallet with the NFT
     * @param _nftContract NFT contract address
     * @param _nftChainId Chain ID of the NFT contract
     * @param _nftTokenId NFT token ID
     * @param _minOwnershipTime Minimum ownership time
     * @param _minEncumbranceTimeLeft Minimum time an encumbrance policy must have remaining in order to bid
     * @param _constrainedPolicy Constrained transaction policy
     * @param _previousOwner Non-encumbered holder of the NFT whose transfer to
     * the first encumbered account must be proven
     */
    constructor(
        address _encumberedWallet,
        address _nftContract,
        uint256 _nftChainId,
        uint256 _nftTokenId,
        uint256 _minOwnershipTime,
        uint256 _minEncumbranceTimeLeft,
        ConstrainedTransactionPolicy _constrainedPolicy,
        address _previousOwner
    ) /*EIP712("NFTAuctionPolicy", "1")*/ Ownable(msg.sender) {
        encumberedWallet = _encumberedWallet;
        nftContract = _nftContract;
        nftChainId = _nftChainId;
        nftTokenId = _nftTokenId;
        minOwnershipTime = _minOwnershipTime;
        minEncumbranceTimeLeft = _minEncumbranceTimeLeft;
        txPolicy = _constrainedPolicy;
        auctionStartTime = 0;

        minEthBalance = 0.0004 ether;
        minRoseBalance = 0.1 ether;

        owners[keccak256("previousProvenOwner")].updateAddress(_previousOwner);
        whitelisted[msg.sender] = true;
    }

    function currentOwner() public view returns (address) {
        return owners[keccak256("currentOwner")].getFinalizedAddress();
    }

    function previousOwner() public view returns (address) {
        return owners[keccak256("previousProvenOwner")].getFinalizedAddress();
    }

    function getNFTAssetHash() public view returns (bytes32) {
        return txPolicy.getEncodedAsset(getNFTAsset());
    }

    function getNFTAsset() public view returns (DestinationAsset memory) {
        return DestinationAsset({chainId: nftChainId, to: nftContract});
    }

    /**
     * @notice Notifies the policy of encumbrance enrollment
     * @param account The account to be enrolled
     * @param assets The assets being encumbered
     * @param data Any additional data required by the policy (e.g. payment details)
     */
    function notifyEncumbranceEnrollment(
        address,
        address account,
        bytes32[] calldata assets,
        uint256 expiration,
        bytes calldata data
    ) external override {
        require(msg.sender == address(txPolicy), "Only the authorized tx policy can enroll");
        require(trustedWalletFactory.createdByFactory(account), "Not created by the trusted wallet factory");
        authorizedManagers[account] = abi.decode(data, (address));
        require(!whitelistEnabled || whitelisted[authorizedManagers[account]], "Not in the whitelist");

        bool hasRequiredAsset = false;
        bytes32 requiredAsset = getNFTAssetHash();

        for (uint i = 0; i < assets.length; i++) {
            if (assets[i] == requiredAsset) {
                hasRequiredAsset = true;
            }
        }
        require(hasRequiredAsset, "Required asset access not given");

        require(expirationTimes[account] == 0, "Already participated; create a new encumbered account");
        require(expiration >= block.timestamp + minEncumbranceTimeLeft, "Expiration time too soon");
        expirationTimes[account] = expiration;
    }

    /**
     * @notice Gets the ETH balance of your encumbered account that is
     * controlled by this policy.
     * @param account Encumbered account address
     * @param targetChainId Chain ID
     * @return ethBalance ETH balance controlled by this policy
     */
    function getEthBalance(address account, uint256 targetChainId) public view returns (uint256 ethBalance) {
        require(msg.sender == authorizedManagers[account], "Not authorized manager of the account");
        return txPolicy.getEthBalance(account, targetChainId);
    }

    /**
     * @notice Gets the local chain's balance of your encumbered account that
     * is controlled by this policy.
     * @param account Encumbered account address
     * @param chainId Chain ID
     * @return localBalance Local chain balance controlled by this policy
     */
    function getLocalBalance(address account, uint256 chainId) public view returns (uint256 localBalance) {
        require(msg.sender == authorizedManagers[account], "Not authorized manager of the account");
        return txPolicy.getSubpolicyLocalBalance(account, chainId);
    }

    /**
     * @notice Gets the deposited bid balance that can be used or withdrawn.
     * @param account Encumbered account address
     * @return bidBalance Available balance for bidding on the NFT
     */
    function getBidBalance(address account) public view returns (uint256 bidBalance) {
        // For privacy, we would include the check below, but for
        // usability with the demo, we'll relax this requirement.
        // require(authorizedManagers[account] == msg.sender, "Only the authorized manager can view this");
        return bidBalances[account];
    }

    function withdrawBidBalance(address account) public {
        require(authorizedManagers[account] == msg.sender, "Only the authorized manager can bid");
        bytes32 bidKey = keccak256(abi.encode(auctionStartTime, account));
        require(!hasBid[bidKey], "Already bid/withdrawn: wait until the next round to withdraw");
        hasBid[bidKey] = true;

        uint256 withdrawalAmount = bidBalances[account];
        bidBalances[account] = 0;
        payable(msg.sender).transfer(withdrawalAmount);
    }

    // Convert a boolean to a uint256
    function boolToUint(bool b) internal pure returns (uint256) {
        return b ? 1 : 0;
    }

    /**
     * @notice Places a bid for the NFT using an encumbered account.
     * @param account Encumbered account to use for the bid
     * @param amount Bid amount
     */
    function placeBid(address account, uint256 amount) external payable whenNotPaused {
        // Must have enough ETH to bid(!)
        require(authorizedManagers[account] == msg.sender, "Only the authorized manager can bid");
        require(block.timestamp > auctionStartTime, "Auction has not started yet");
        require(
            block.timestamp - auctionStartTime < minOwnershipTime || auctionStartTime == 0,
            "Auction ended (call finalizeAuction)"
        );
        require(
            expirationTimes[account] >= auctionStartTime + minOwnershipTime + minEncumbranceTimeLeft,
            "Not enough encumbrance time left; create a new encumbered account"
        );
        require(getEthBalance(account, nftChainId) >= minEthBalance, "Not enough ETH balance to participate");
        require(getLocalBalance(account, nftChainId) >= minRoseBalance, "Not enough ROSE balance to participate");
        // Account might not have enough ETH in it, since the transaction it
        // signed (most likely) hasn't been proven yet to the transaction policy.
        if (account == owners[keccak256("previousProvenOwner")].getFinalizedAddress()) {
            require(
                getEthBalance(account, nftChainId) >= minEthBalance * 2,
                "Proven owner: Not enough ETH balance to participate"
            );
            require(
                getLocalBalance(account, nftChainId) >= minRoseBalance * 2,
                "Proven owner: Not enough ROSE balance to participate"
            );
        }

        require(amount > 0, "Bid amount must be greater than zero");
        require(amount <= BID_MASK, "Bid too high");

        bytes32 bidKey = keccak256(abi.encode(auctionStartTime, account));
        require(!hasBid[bidKey], "Bid already placed this round");
        hasBid[bidKey] = true;

        // Require bid balance to be paid via payable
        bidBalances[account] += msg.value;
        require(bidBalances[account] >= amount, "Bid greater than account's bid balance");

        // Flip the two bid flag bits to keep the gas cost of setting the
        // storage slot constant
        uint256 newFlag = (topBid & BID_FLAG_MASK) ^ BID_FLAG_MASK;

        // Prevent leaks through the gas cost
        // There are still some jumps due to the ternary operators...
        uint256 prevTop = topBid & BID_MASK;
        uint256 prevTopBidder = uint256(topBidder) & BIDDER_MASK;
        uint256 prevSecond = secondBid & BID_MASK;

        uint256 isTop = (amount > prevTop) ? type(uint256).max : 0;
        uint256 isSecond = ((boolToUint(isTop == 0) & boolToUint(amount > prevSecond)) != 0) ? type(uint256).max : 0;
        uint256 isNeither = ((isTop | isSecond) == 0) ? type(uint256).max : 0;

        topBid = (isTop & amount) | (isSecond & prevTop) | (isNeither & prevTop) | newFlag;
        topBidder = bytes32(
            uint256(
                (uint160(isTop) & uint160(account)) |
                    (uint160(isSecond) & uint160(prevTopBidder)) |
                    (uint160(isNeither) & uint160(prevTopBidder))
            ) | newFlag
        );
        secondBid = (isTop & prevTop) | (isSecond & amount) | (isNeither & prevSecond) | newFlag;

        /*
        if (topBid == 0 || amount > topBid) {
            secondBid = prevTop;
            secondBidder = prevTopBidder;
            topBid = amount;
            topBidder = account;
        } else if (amount > secondBid) {
            secondBid = amount;
            secondBidder = account;
        }
        */
    }

    function nextAuctionEnd() public view whenNotPaused returns (uint256 time) {
        return auctionStartTime + minOwnershipTime;
    }

    function isAuctionRunning() public view whenNotPaused returns (bool) {
        return block.timestamp < auctionStartTime + minOwnershipTime;
    }

    /**
     * @notice Finalizes the auction and transfers ownership of the NFT
     */
    function finalizeAuction() public whenNotPaused {
        require(block.timestamp - auctionStartTime >= minOwnershipTime, "Auction has not ended yet");

        // Update current owner and encumbered account mapping
        address topBidderAddress = address(uint160(uint256(topBidder) & BIDDER_MASK));
        if (topBidderAddress != address(0)) {
            owners[keccak256("currentOwner")].updateAddress(topBidderAddress);
            // Winner pays second-highest bid
            uint256 secondHighestBid = (secondBid & BID_MASK);
            bidBalances[topBidderAddress] -= secondHighestBid;
            lastPaid = secondHighestBid;

            // This expression should never be false, but we'll fail open just in case.
            if (address(this).balance >= secondHighestBid) {
                payable(faucetAddress).transfer(secondHighestBid);
            }

            topBid = BID_FLAG;
            topBidder = bytes32(BID_FLAG);
            secondBid = BID_FLAG;
        }
        auctionStartTime = block.timestamp;
    }

    /**
     * @notice Sets the auction start time
     * @param _auctionStartTime The new auction start time
     */
    function setAuctionStartTime(uint256 _auctionStartTime) public onlyOwner {
        auctionStartTime = _auctionStartTime;
    }

    /**
     * @notice Creates a transaction to transfer the NFT to the new owner's encumbered account
     * @return transaction The unsigned transaction message
     */
    function getNFTTransferTransaction(
        uint256 maxFeePerGas,
        address newOwner,
        uint256 nonce
    ) public view returns (Type2TxMessage memory transaction) {
        bytes memory txData = abi.encodeWithSignature(
            "transferFrom(address,address,uint256)",
            owners[keccak256("previousProvenOwner")].getFinalizedAddress(),
            newOwner,
            nftTokenId
        );

        transaction = Type2TxMessage({
            chainId: nftChainId,
            // TODO: Get current nonce (!)
            nonce: nonce,
            // 0.1 gwei
            maxPriorityFeePerGas: 100_000_000,
            // Must be determined outside...
            maxFeePerGas: maxFeePerGas,
            gasLimit: 200_000,
            destination: bytes.concat(bytes20(nftContract)),
            amount: 0,
            payload: txData
        });
    }

    function getSigner(Type2TxMessageSigned calldata signedTx) public pure returns (address signerAccount) {
        bytes memory unsignedTxData = TransactionSerializer.serializeTransaction(signedTx.transaction);
        bytes32 unsignedTxHash = keccak256(unsignedTxData);
        bytes memory signature = bytes.concat(bytes32(signedTx.r), bytes32(signedTx.s), bytes1(uint8(signedTx.v)));
        ECDSA.RecoverError error;
        (signerAccount, error, ) = ECDSA.tryRecover(unsignedTxHash, signature);
        require(error == ECDSA.RecoverError.NoError, "Invalid signature");
    }

    /**
     * @notice Proves the previous transfer of the NFT into the old encumbered wallet account
     * @param signedTransaction The signed transaction of the previous transfer
     * @param signedTxIndex The index of the signed transaction in the list
     */
    function provePreviousTransfer(
        Type2TxMessageSigned calldata signedTransaction,
        uint256 signedTxIndex,
        address newOwner,
        uint256 nonce,
        uint256 maxFeePerGas
    ) external {
        Type2TxMessage memory txMessage = getNFTTransferTransaction(maxFeePerGas, newOwner, nonce);
        require(
            keccak256(signedTransaction.transaction.destination) == keccak256(txMessage.destination),
            "Incorrect destination address"
        );
        require(keccak256(signedTransaction.transaction.payload) == keccak256(txMessage.payload), "Incorrect payload");
        require(signedTransaction.transaction.chainId == txMessage.chainId, "Incorrect chain id");

        address signer = getSigner(signedTransaction);
        require(signer == owners[keccak256("previousProvenOwner")].getFinalizedAddress(), "Incorrect sender");

        SignedIncludedTx memory includedTx = txPolicy.getSignedIncludedTransaction(signer, signedTxIndex);
        require(
            includedTx.blockNumber > previousTransferBlockNumber,
            "Transfer must come after previously proven transfer"
        );

        previousTransferBlockNumber = includedTx.blockNumber;
        require(
            includedTx.unsignedTxHash ==
                keccak256(TransactionSerializer.serializeTransaction(signedTransaction.transaction)),
            "Signed transaction hash does not match recorded hash. Did you prove inclusion?"
        );

        // TODO: Implement
        owners[keccak256("previousProvenOwner")].updateAddress(newOwner);
    }

    /**
     * @notice Signs a transaction to transfer the NFT to the new owner's encumbered account
     * @return The signed transaction
     */
    function signNFTTransferTransaction(uint256 maxFeePerGas) public view returns (bytes memory) {
        address prevOwner = owners[keccak256("previousProvenOwner")].getFinalizedAddress();
        address newOwner = owners[keccak256("currentOwner")].getFinalizedAddress();
        Type2TxMessage memory transaction = getNFTTransferTransaction(
            maxFeePerGas,
            newOwner,
            txPolicy.getNextNonce(prevOwner, nftChainId)
        );
        require(prevOwner != newOwner, "Previous owner is the same as the current owner");

        require(
            msg.sender == authorizedManagers[newOwner] || msg.sender == owner(),
            "Only recipient can sign this transaction"
        );

        return txPolicy.signTransaction(prevOwner, transaction);
    }

    /**
     * @notice Sends a message to another contract that was checked to have
     * been sent by the authorized manager of the encumbered account that last
     * won the auction (and can have the NFT transferred to it at any time).
     */
    function sendCurrentOwnerMessage(
        ICurrentOwnerMessageReceiver recipient,
        bytes calldata message
    ) external returns (bytes memory) {
        require(
            msg.sender == authorizedManagers[owners[keccak256("currentOwner")].getFinalizedAddress()],
            "Not the current owner of the NFT"
        );
        return recipient.onCurrentOwnerMessage(message);
    }

    // Note that the contract owner cannot sign any transaction from the encumbered account;
    // it can only sign transactions as constrained by the enrolled asset (i.e., it can only
    // sign a transaction that manipulates the current NFT, spend only the balance
    // assigned to this policy, and sign for the current nonce).
    function recoverNFT(
        address account,
        Type2TxMessage calldata transaction
    ) public view onlyOwner returns (bytes memory) {
        return txPolicy.signTransaction(account, transaction);
    }

    function setWhitelistEnabled(bool _whitelistEnabled) public onlyOwner {
        whitelistEnabled = _whitelistEnabled;
    }

    function updateWhitelist(address[] calldata addresses, bool isWhitelisted) public onlyOwner {
        for (uint256 i = 0; i < addresses.length; i++) {
            whitelisted[addresses[i]] = isWhitelisted;
        }
    }

    function setTrustedWalletFactory(IWalletFactory factory) public onlyOwner {
        trustedWalletFactory = factory;
    }

    /**
     * @notice Necessary for proving the first (unencumbered) transfer, for
     * which provePreviousTransfer won't work
     * @param _previousOwner Current encumbered address which owns the NFT.
     */
    function setPreviousProvenOwner(address _previousOwner) public onlyOwner {
        owners[keccak256("previousProvenOwner")].updateAddress(_previousOwner);
    }

    /**
     * @notice Update the minimum allowed balances controlled by this policy
     * held by an encumbered account in order for the account to be allowed to
     * participate in the NFT auction.
     * @param _minEthBalance New minimum balance on the Ethereum network.
     * @param _minRoseBalance Minimum (local) balance on this network.
     */
    function updateMinimumBalances(uint256 _minEthBalance, uint256 _minRoseBalance) public onlyOwner {
        minEthBalance = _minEthBalance;
        minRoseBalance = _minRoseBalance;
    }

    /**
     * @notice Update minimum guaranteed ownership time
     */
    function setMinOwnershipTime(uint256 _newOwnershipTime) public onlyOwner {
        minOwnershipTime = _newOwnershipTime;
    }

    /**
     * @notice Update faucet address
     */
    function setFaucetAddress(address _faucetAddress) public onlyOwner {
        faucetAddress = _faucetAddress;
    }
}
