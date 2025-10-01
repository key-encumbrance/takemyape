import { expect } from "chai";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { type JsonRpcApiProvider, type BytesLike, Transaction, Signer } from "ethers";
import { ethers } from "hardhat";
import { derToEthSignature } from "../liquefaction/scripts/ethereum-signatures";
import { getRlpUint, getTxInclusionProof } from "../liquefaction/scripts/inclusion-proofs";
import { TrivialBlockHashOracle } from "../liquefaction/typechain-types/contracts/wallet/encumbrance-policies/examples/TrivialBlockHashOracle";
import { BasicEncumberedWallet } from "../liquefaction/typechain-types/contracts/wallet/BasicEncumberedWallet";
import { ConstrainedTransactionPolicy } from "../typechain-types/contracts/ConstrainedTransactionPolicy";
import { ApeLiquefactionWalletFactory } from "../typechain-types/contracts/ApeLiquefactionWalletFactory";
import { NFTAuctionPolicy } from "../typechain-types/contracts/NFTAuctionPolicy.sol/NFTAuctionPolicy";
import { type Type2Transaction, convertTransaction } from "../scripts/tx-utils";

const publicNetwork = {
  chainId: 30121,
  name: "publicNetwork",
};
const publicProvider = new ethers.JsonRpcProvider("http://127.0.0.1:32002", publicNetwork);

function getCurrentTime() {
  return Math.floor(Date.now() / 1000);
}

function throwIfEmpty<T>(val: T | undefined | null, valStr: string): T {
  if (val === undefined || val === null) {
    throw new Error("Expected value to be non-empty: " + valStr);
  }
  return val;
}

function bigIntMax(val1: bigint, val2: bigint): bigint {
  if (val1 > val2) {
    return val1;
  }
  return val2;
}

// Get a transaction inclusion proof. Only returns the correct type for type-2 transactions.
async function getTxInclusion(gethProvider: JsonRpcApiProvider, txHash: string) {
  const signedWithdrawalTx = await publicProvider.getTransaction(txHash);
  if (signedWithdrawalTx === null) {
    throw new Error("Withdrawal transaction is null");
  }
  if (signedWithdrawalTx.type !== 2) {
    throw new Error("Unsupported transaction type (must be 2 for getTxInclusion)");
  }
  const txReceipt = await gethProvider.getTransactionReceipt(txHash);
  if (txReceipt === null) {
    throw new Error("Withdrawal transaction receipt is null");
  }
  const { proof, rlpBlockHeader } = await getTxInclusionProof(
    gethProvider as any,
    txReceipt.blockNumber,
    txReceipt.index,
  );

  // Get proof
  // This can be gathered from the transaction data of the included transaction
  const signedTxFormatted = {
    transaction: {
      chainId: signedWithdrawalTx.chainId,
      nonce: signedWithdrawalTx.nonce,
      maxPriorityFeePerGas: throwIfEmpty(
        signedWithdrawalTx.maxPriorityFeePerGas,
        "maxPriorityFeePerGas",
      ),
      maxFeePerGas: throwIfEmpty(signedWithdrawalTx.maxFeePerGas, "maxFeePerGas"),
      gasLimit: signedWithdrawalTx.gasLimit,
      destination: throwIfEmpty(signedWithdrawalTx.to, "to"),
      amount: signedWithdrawalTx.value,
      payload: signedWithdrawalTx.data,
    },
    r: signedWithdrawalTx.signature.r,
    s: signedWithdrawalTx.signature.s,
    v: signedWithdrawalTx.signature.v,
  };

  return {
    signedTxFormatted,
    inclusionProof: {
      rlpBlockHeader,
      transactionIndexRlp: getRlpUint(txReceipt.index),
      transactionProofStack: ethers.encodeRlp(proof.map((rlpList) => ethers.decodeRlp(rlpList))),
    },
    proofBlockNumber: txReceipt.blockNumber,
  };
}

function getRandomBigInt(min: number, max: number): bigint {
  const random = Math.random();
  const scaled = min + random * (max - min);
  return BigInt(Math.floor(scaled));
}

async function signSubmitAndProve(
  owner: Signer,
  blockHashOracle: any,
  txPolicy: ConstrainedTransactionPolicy,
  auctionPolicy: NFTAuctionPolicy,
  publicProvider: JsonRpcApiProvider,
  previousProvenOwnerAddress: string,
  newOwnerAddress: string,
): Promise<void> {
  // Sign the transfer
  const maxFeePerGas = 10_000_000_000n;
  const nftTransferTx2 = await auctionPolicy
    .connect(sapphire.wrap(owner))
    .getNFTTransferTransaction(
      maxFeePerGas,
      newOwnerAddress,
      await publicProvider.getTransactionCount(previousProvenOwnerAddress),
    );
  console.log(nftTransferTx2);

  console.log(
    "Inclusion proof cost:",
    await txPolicy.estimateInclusionProofCost(ethers.dataLength(nftTransferTx2.payload)),
  );

  const tx3 = convertTransaction(nftTransferTx2);
  const txSig3 = await auctionPolicy
    .connect(sapphire.wrap(owner))
    .signNFTTransferTransaction(maxFeePerGas);
  console.log("Signed transaction:", txSig3);

  const ethSig3 = derToEthSignature(
    txSig3,
    tx3.unsignedSerialized,
    previousProvenOwnerAddress,
    "bytes",
  );
  if (ethSig3 === undefined) {
    throw new Error("Could not find valid signature for tx3");
  }
  tx3.signature = ethSig3;

  const tx3Receipt = await publicProvider
    .broadcastTransaction(tx3.serialized)
    .then((r) => r.wait());

  if (tx3Receipt === null) {
    throw new Error("Transaction 3 receipt is null");
  }
  console.log("Broadcasted and included! NFT transfer gas used:", tx3Receipt.gasUsed);

  // 4. Create transaction inclusion proof
  const tx3Hash = tx3.hash;
  if (tx3Hash === null) {
    throw new Error("Could not get hash from transaction 1");
  }
  let {
    signedTxFormatted: signedTxFormatted3,
    inclusionProof: inclusionProof3,
    proofBlockNumber: proofBlockNumber3,
  } = await getTxInclusion(publicProvider, tx3Hash);

  // Update block hash oracle
  await blockHashOracle
    .setBlockHash(tx3Receipt.blockNumber, tx3Receipt.blockHash)
    .then((r: any) => r.wait());

  // 5. Prove transaction inclusion to the encumbrance policy
  await txPolicy
    .proveTransactionInclusion(signedTxFormatted3, inclusionProof3, proofBlockNumber3)
    .then((tx) => tx.wait());

  // Register the proof in the auction policy
  await auctionPolicy
    .provePreviousTransfer(
      signedTxFormatted3,
      signedTxFormatted3.transaction.nonce,
      newOwnerAddress,
      signedTxFormatted3.transaction.nonce,
      maxFeePerGas,
    )
    .then((r) => r.wait());
}

async function placeBid(
  owner: Signer,
  auctionPolicy: NFTAuctionPolicy,
  walletAddr: string,
  finalize: boolean,
  bid: bigint = 5n,
): Promise<void> {
  // Bid on the NFT
  console.log("Bidding on the NFT...");
  await auctionPolicy
    .connect(sapphire.wrap(owner))
    .placeBid(walletAddr, bid, { value: bid })
    .then((r) => r.wait());

  if (finalize) {
    const auctionEnds =
      (await auctionPolicy.auctionStartTime()) + (await auctionPolicy.minOwnershipTime());
    console.log("Auction ends:", auctionEnds);
    console.log("Current time:", getCurrentTime());

    const timeToWait = bigIntMax(0n, auctionEnds - BigInt(getCurrentTime()) + 10n);
    if (timeToWait > 0n) {
      console.log("Waiting", Number(timeToWait), "seconds...");
      await new Promise<void>((resolve) => setTimeout(resolve, Number(timeToWait) * 1000));
    } else {
      console.log("No need to wait; finalizing now...");
    }

    await auctionPolicy.connect(sapphire.wrap(owner)).finalizeAuction.staticCall();

    // Finalize the auction
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .finalizeAuction()
      .then((r) => r.wait());
  }
}

interface CreateAndBidOptions {
  bid?: boolean;
  finalize?: boolean;
}

async function createAndBid(
  owner: Signer,
  ownerPublic: Signer,
  wallet: any,
  blockHashOracle: any,
  txPolicy: ConstrainedTransactionPolicy,
  nftWalletFactory: ApeLiquefactionWalletFactory,
  auctionPolicy: NFTAuctionPolicy,
  publicProvider: JsonRpcApiProvider,
  options?: Partial<CreateAndBidOptions>,
): Promise<string> {
  const { bid = true, finalize = true } = options || {};

  // Create wallet from factory
  const factoryWalletId = getRandomBigInt(0, 1_000_000_000);
  const factory = nftWalletFactory.connect(sapphire.wrap(owner));
  await factory.createWallet(factoryWalletId).then((w) => w.wait());
  console.log("Getting the wallet count...");
  const attendedWalletCount = await wallet.connect(sapphire.wrap(owner)).getAttendedWalletCount();
  console.log("Attended wallet count:", attendedWalletCount);
  const myAttendedWallet = await wallet
    .connect(sapphire.wrap(owner))
    .getAttendedWallet(attendedWalletCount - 1n);
  const walletAddr = await wallet
    .connect(sapphire.wrap(owner))
    .getWalletAddress(myAttendedWallet.index);
  console.log("New encumbered wallet address:", walletAddr);

  // Deposit ETH to the wallet
  const tx0 = await ownerPublic.populateTransaction({
    to: walletAddr,
    value: ethers.parseEther("0.1"),
  });
  const tx0Transaction = ethers.Transaction.from(await ownerPublic.signTransaction(tx0));
  const tx0Receipt = await publicProvider
    .broadcastTransaction(tx0Transaction.serialized)
    .then((r) => r.wait());

  // Add balance to the wallet
  const tx0ReceiptHash = tx0Receipt?.hash;
  if (tx0Receipt === null || tx0ReceiptHash === undefined) {
    throw new Error("Could not get tx receipt hash from transaction");
  }
  await blockHashOracle
    .setBlockHash(tx0Receipt.blockNumber, tx0Receipt.blockHash)
    .then((r: any) => r.wait());
  console.log("Proving deposit inclusion...");
  const { signedTxFormatted, inclusionProof, proofBlockNumber } = await getTxInclusion(
    publicProvider,
    tx0ReceiptHash,
  );
  await txPolicy
    .connect(sapphire.wrap(owner))
    .depositFunds(signedTxFormatted, inclusionProof, proofBlockNumber)
    .then((r) => r.wait());

  // Deposit to the local balance
  const targetChainId = (await publicProvider.getNetwork()).chainId;
  await txPolicy
    .depositLocalFunds(walletAddr, targetChainId, { value: ethers.parseEther("1.2") })
    .then((r) => r.wait());

  if (bid) {
    await placeBid(owner, auctionPolicy, walletAddr, finalize);
  }

  return walletAddr;
}

describe("NFTAuctionPolicy", function () {
  async function getAccounts() {
    // Contracts are deployed using the first signer/account by default
    // 0x72A6CF1837105827077250171974056B40377488
    const ownerPublic = new ethers.Wallet(
      "0x519028d411cec86054c9c35903928eed740063336594f1b3b076fce119238f6a",
    ).connect(publicProvider);

    return { ownerPublic };
  }

  async function deployContracts(
    initialEncumbranceTime: bigint = 60n * 60n * 24n * 28n,
    minEncumbranceTimeLeft: bigint = 60n * 60n * 24n * 14n,
  ) {
    const [owner] = await ethers.getSigners();

    const Eip712UtilsFactory = await ethers.getContractFactory("EIP712Utils");
    const eip712Utils = await Eip712UtilsFactory.deploy();

    // Deploy BasicEncumberedWallet
    const BasicEncumberedWalletFactory = await ethers.getContractFactory("BasicEncumberedWallet", {
      libraries: {
        EIP712Utils: eip712Utils.target,
      },
    });
    const wallet = await BasicEncumberedWalletFactory.deploy();

    const MessagePolicyFactory = await ethers.getContractFactory("WalletConnectMessagePolicy");
    const messagePolicy = await MessagePolicyFactory.deploy(wallet.target);

    // Deploy TrivialBlockHashOracle
    const TrivialBlockHashOracleFactory = await ethers.getContractFactory("TrivialBlockHashOracle");
    const blockHashOracle = await TrivialBlockHashOracleFactory.deploy();

    // Deploy ProvethVerifier
    const ProvethVerifierFactory = await ethers.getContractFactory("ProvethVerifier");
    const stateVerifier = await ProvethVerifierFactory.deploy();

    // Deploy TransactionSerializer
    const TransactionSerializerFactory = await ethers.getContractFactory("TransactionSerializer");
    const transactionSerializer = await TransactionSerializerFactory.deploy();

    await blockHashOracle.waitForDeployment();
    console.log("Block hash oracle deployed at", blockHashOracle.target);

    // Deploy ConstrainedTransactionPolicy
    const ConstrainedTransactionPolicyFactory = await ethers.getContractFactory(
      "ConstrainedTransactionPolicy",
      {
        libraries: {
          TransactionSerializer: transactionSerializer.target,
        },
      },
    );
    const txPolicy = await ConstrainedTransactionPolicyFactory.deploy(
      wallet.target,
      blockHashOracle.target,
      stateVerifier.target,
    );

    // Deploy NFT contract on the public provider
    const { ownerPublic } = await getAccounts();
    const TestNFTFactory = await ethers
      .getContractFactory("TestERC721")
      .then((factory) => factory.connect(ownerPublic));

    const nftContract = await TestNFTFactory.deploy();
    const nftDeploymentTx = await nftContract.deploymentTransaction();
    if (nftDeploymentTx === null) {
      throw new Error("NFT deployment transaction is null");
    }
    await nftDeploymentTx.wait();

    const nftTokenId = await nftContract
      .connect(ownerPublic)
      .safeMint.staticCall(ownerPublic.address);
    await nftContract
      .connect(ownerPublic)
      .safeMint(ownerPublic.address)
      .then((t) => t.wait());
    console.log("Minted NFT token ID:", nftTokenId);

    const NFTAuctionPolicyFactory = await ethers.getContractFactory("NFTAuctionPolicy", {
      libraries: {
        TransactionSerializer: transactionSerializer.target,
      },
    });
    const auctionPolicy = await NFTAuctionPolicyFactory.deploy(
      wallet.target,
      nftContract.target,
      (await publicProvider.getNetwork()).chainId,
      nftTokenId,
      // Min ownership time
      60 * 1,
      // Min encumbrance time left
      minEncumbranceTimeLeft,
      txPolicy.target,
      // Previous owner
      ownerPublic.address,
      {
        // Gas estimation was incorrect; we'll just make it high.
        // You need 1.5 ROSE in your account to send this (won't use all)
        gasLimit: 15_000_000n,
      },
    );

    // Deploy NFTOwnerControls
    const NFTOwnerControlsFactory = await ethers.getContractFactory("NFTOwnerControls");
    const nftOwnerControls = await NFTOwnerControlsFactory.deploy(auctionPolicy.target);

    const ApeLiquefactionWalletFactory = await ethers.getContractFactory(
      "ApeLiquefactionWalletFactory",
    );
    const nftWalletFactory = await ApeLiquefactionWalletFactory.deploy(
      await wallet.getAddress(),
      await txPolicy.getAddress(),
      await auctionPolicy.getAddress(),
      await messagePolicy.getAddress(),
      initialEncumbranceTime,
    );

    return {
      owner,
      wallet,
      blockHashOracle,
      stateVerifier,
      txPolicy: txPolicy.connect(owner),
      nftWalletFactory,
      auctionPolicy,
      nftOwnerControls,
    };
  }

  it("Should hand off an NFT", async () => {
    const {
      owner,
      wallet,
      txPolicy,
      blockHashOracle,
      nftWalletFactory,
      auctionPolicy,
      nftOwnerControls,
    } = await deployContracts();
    const { ownerPublic } = await getAccounts();

    // Wait for deployment

    const walletFactoryDeployment = nftWalletFactory.deploymentTransaction();
    if (walletFactoryDeployment === null) {
      throw new Error("Wallet factory deployment transaction is null");
    }
    await walletFactoryDeployment.wait();

    // Owner: Set trusted wallet factory
    await auctionPolicy.setTrustedWalletFactory(nftWalletFactory.target).then((r) => r.wait());
    // Create wallet from factory
    const factory = nftWalletFactory.connect(sapphire.wrap(owner));
    const targetChainId = (await publicProvider.getNetwork()).chainId;

    const walletAddr = await createAndBid(
      owner,
      ownerPublic,
      wallet,
      blockHashOracle,
      txPolicy,
      nftWalletFactory,
      auctionPolicy,
      publicProvider,
    );

    // 6. Sign the first transaction to an encumbered account (one-time action, not part of regular flow)

    const expTx = await auctionPolicy
      .connect(sapphire.wrap(owner))
      .getNFTTransferTransaction(
        10_000_000_000n,
        walletAddr,
        await publicProvider.getTransactionCount(ownerPublic.address),
      );
    console.log(expTx);

    const tx1Transaction = convertTransaction(expTx);
    const tx1TransactionSigned = ethers.Transaction.from(
      await ownerPublic.signTransaction(tx1Transaction),
    );

    // 7. Broadcast transaction on target blockchain
    console.log("Broadcasting", tx1TransactionSigned.toString());
    const tx1Receipt = await publicProvider
      .broadcastTransaction(tx1TransactionSigned.serialized)
      .then((r) => r.wait());

    console.log(tx1TransactionSigned.serialized);

    if (tx1Receipt === null) {
      throw new Error("Transaction 1 receipt is null");
    }

    expect(tx1Receipt.status).to.equal(1);

    console.log("Broadcasted and included! NFT transfer gas used:", tx1Receipt.gasUsed);

    // Create a second wallet and buy the NFT
    const walletAddr2 = await createAndBid(
      owner,
      ownerPublic,
      wallet,
      blockHashOracle,
      txPolicy,
      nftWalletFactory,
      auctionPolicy,
      publicProvider,
    );

    console.log("Current NFT owner:", await auctionPolicy.currentOwner());
    await expect(auctionPolicy.currentOwner()).to.eventually.equal(walletAddr2);

    // Blur the NFT
    const setImageBlurredInterface = new ethers.Interface([
      "function setImageBlurred(bool _isBlurred)",
    ]);
    const encodedBlurData = setImageBlurredInterface.encodeFunctionData("setImageBlurred", [true]);
    console.log(encodedBlurData);
    console.log("Sending blur request...");
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .sendCurrentOwnerMessage(nftOwnerControls.target, encodedBlurData)
      .then((r) => r.wait());

    // Check if the isImageBlurred state is updated
    const isImageBlurred = await nftOwnerControls.getImageBlurred();
    expect(isImageBlurred).to.be.true;

    // Owner sets
    console.log("Setting previous proven owner to " + walletAddr + "...");
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .setPreviousProvenOwner(walletAddr)
      .then((r) => r.wait());

    await signSubmitAndProve(
      owner,
      blockHashOracle,
      txPolicy,
      auctionPolicy,
      publicProvider,
      walletAddr,
      walletAddr2,
    );

    // First account bids again
    await placeBid(owner, auctionPolicy, walletAddr, true);

    await signSubmitAndProve(
      owner,
      blockHashOracle,
      txPolicy,
      auctionPolicy,
      publicProvider,
      walletAddr2,
      walletAddr,
    );

    // Second account bids again (first account will have nonce = 1 for this transaction)
    await placeBid(owner, auctionPolicy, walletAddr2, true);

    await signSubmitAndProve(
      owner,
      blockHashOracle,
      txPolicy,
      auctionPolicy,
      publicProvider,
      walletAddr,
      walletAddr2,
    );
  });

  it("Should fail to bid again due to minEncumbranceTimeLeft", async () => {
    const {
      owner,
      wallet,
      txPolicy,
      blockHashOracle,
      nftWalletFactory,
      auctionPolicy,
      nftOwnerControls,
    } = await deployContracts(60n * 3n, 60n * 2n);
    const { ownerPublic } = await getAccounts();

    // Ensure the trusted wallet factory is set
    await auctionPolicy.setTrustedWalletFactory(nftWalletFactory.target).then((r) => r.wait());

    // First call to createAndBid
    console.log("Doing the createAndBid");
    const walletAddr = await createAndBid(
      owner,
      ownerPublic,
      wallet,
      blockHashOracle,
      txPolicy,
      nftWalletFactory,
      auctionPolicy,
      publicProvider,
    );

    // Wait for the minEncumbranceTimeLeft to pass
    const initialEncumbranceExpiration = await nftWalletFactory.initialEncumbranceExpiration();
    const minEncumbranceTimeLeft = await auctionPolicy.minEncumbranceTimeLeft();
    console.log(
      "Waiting for minEncumbranceTimeLeft to pass:",
      initialEncumbranceExpiration - minEncumbranceTimeLeft,
    );
    await new Promise<void>((resolve) =>
      setTimeout(
        resolve,
        Number(initialEncumbranceExpiration - minEncumbranceTimeLeft) * 1000 + 1000,
      ),
    );

    // Second bid should fail
    console.log("Finalizing previous auction...");
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .finalizeAuction()
      .then((r) => r.wait());
    console.log("Trying to place another bid:");
    await expect(
      auctionPolicy.connect(sapphire.wrap(owner)).placeBid.staticCall(walletAddr, 5, { value: 5n }),
    ).to.be.rejectedWith("Not enough encumbrance time left");
  });

  it("Should only pay the second price", async () => {
    const {
      owner,
      wallet,
      txPolicy,
      blockHashOracle,
      nftWalletFactory,
      auctionPolicy,
      nftOwnerControls,
    } = await deployContracts(60n * 3n, 60n * 2n);
    const { ownerPublic } = await getAccounts();

    // Ensure the trusted wallet factory is set
    await auctionPolicy.setTrustedWalletFactory(nftWalletFactory.target).then((r) => r.wait());

    // Create wallets
    const walletAddr = await createAndBid(
      owner,
      ownerPublic,
      wallet,
      blockHashOracle,
      txPolicy,
      nftWalletFactory,
      auctionPolicy,
      publicProvider,
      { bid: false },
    );

    const walletAddr2 = await createAndBid(
      owner,
      ownerPublic,
      wallet,
      blockHashOracle,
      txPolicy,
      nftWalletFactory,
      auctionPolicy,
      publicProvider,
      { bid: false },
    );

    const walletAddr3 = await createAndBid(
      owner,
      ownerPublic,
      wallet,
      blockHashOracle,
      txPolicy,
      nftWalletFactory,
      auctionPolicy,
      publicProvider,
      { bid: false },
    );

    // Should fail if you don't send enough value
    await expect(
      auctionPolicy.connect(sapphire.wrap(owner)).placeBid.staticCall(walletAddr, 5n),
    ).to.be.revertedWith("Bid greater than account's bid balance");

    // Tested order of bids where 3 = highest, (gas least sig digit):
    // 3, 1, 2 * (6,5,5)
    // 3, 2, 1 * (4,3,6)
    // 2, 1, 3 * (6,5,6)
    // 2, 3, 1 * (6,6,6)
    // 1, 2, 3 * (6,6,6)
    // 1, 3, 2 * (6,6,5)

    const bids = [10n, 7n, 8n];

    // Estimate gas
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .placeBid(walletAddr, bids[0], { value: bids[0] })
      .then((r) => r.wait())
      .then((r) => console.log("Bid wallet1:", r));
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .placeBid(walletAddr2, bids[1], { value: bids[1] })
      .then((r) => r.wait())
      .then((r) => console.log("Bid wallet2:", r));
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .placeBid(walletAddr3, bids[2], { value: bids[2] })
      .then((r) => r.wait())
      .then((r) => console.log("Bid wallet3:", r));

    const winner = walletAddr;

    const auctionEnds =
      (await auctionPolicy.auctionStartTime()) + (await auctionPolicy.minOwnershipTime());
    console.log("Auction ends:", auctionEnds);
    console.log("Current time:", getCurrentTime());

    const timeToWait = bigIntMax(0n, auctionEnds - BigInt(getCurrentTime()) + 10n);
    if (timeToWait > 0n) {
      console.log("Waiting", Number(timeToWait), "seconds...");
      await new Promise<void>((resolve) => setTimeout(resolve, Number(timeToWait) * 1000));
    } else {
      console.log("No need to wait; finalizing now...");
    }

    console.log("Finalizing auction...");
    await auctionPolicy.connect(sapphire.wrap(owner)).finalizeAuction.staticCall();
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .finalizeAuction()
      .then((r) => r.wait());

    console.log("Running tests...");
    await expect(auctionPolicy.currentOwner()).to.eventually.equal(winner);
    await expect(
      auctionPolicy.connect(sapphire.wrap(owner)).getBidBalance(winner),
    ).to.eventually.equal(2n);
    await expect(auctionPolicy.connect(sapphire.wrap(owner)).lastPaid()).to.eventually.equal(8n);

    // Should zero your bid balance after withdrawing funds
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .withdrawBidBalance(winner)
      .then((r) => r.wait());
    await expect(
      auctionPolicy.connect(sapphire.wrap(owner)).getBidBalance(winner),
    ).to.eventually.equal(0n);
  });
});
