import { ethers } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { getRlpUint, getTxInclusionProof } from "../liquefaction/scripts/inclusion-proofs";
import { derToEthSignature } from "../liquefaction/scripts/ethereum-signatures";
import { JsonRpcProvider, Transaction, Wallet, type AddressLike, type Addressable } from "ethers";
import { IERC721 } from "../typechain-types/@openzeppelin/contracts/token/ERC721/IERC721";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import {
  type NetworkConfig,
  type AddressLikeNonPromise,
  type NetworkEnv,
  networkConfigs,
} from "../../frontend/src/utils/networkConfig";

// Load environment variables from frontend/.env.local
const envPath = path.join(__dirname, "..", "..", "frontend", ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Get network configuration based on environment
const networkEnv = (process.env.NETWORK_ENV || "dev") as NetworkEnv;
const networkConfig = networkConfigs[networkEnv];

const publicProvider = new ethers.JsonRpcProvider(networkConfig.ethereum.rpcUrl, {
  chainId: networkConfig.ethereum.chainId,
  name: networkConfig.ethereum.name,
});

// Helper functions
function convertTransaction(ttx: any): Transaction {
  const transaction = {
    chainId: ttx.chainId,
    nonce: Number(ttx.nonce),
    maxPriorityFeePerGas: ttx.maxPriorityFeePerGas,
    maxFeePerGas: ttx.maxFeePerGas,
    gasLimit: ttx.gasLimit,
    to: ethers.getAddress(ethers.dataSlice(ttx.destination, 0, 20)),
    value: ttx.amount,
    data: ttx.payload,
    type: 2,
  };

  return ethers.Transaction.from(transaction);
}

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

// Get a transaction inclusion proof
async function getTxInclusion(gethProvider: JsonRpcProvider, txHash: string) {
  const signedWithdrawalTx = await gethProvider.getTransaction(txHash);
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

async function main() {
  console.log("Network environment:", networkEnv);

  // Get the owner account
  let owner;
  let blockHashOracleUpdater;
  if (process.env.PRIVATE_KEY) {
    // For test environment, use the provided private key
    const provider = new JsonRpcProvider(networkConfig.oasis.rpcUrl);
    owner = new Wallet(process.env.PRIVATE_KEY, provider);
    console.log("Using provided private key for test environment");
  } else {
    // For other environments, use the default signer
    [owner] = await ethers.getSigners();
  }

  if (process.env.BLOCK_HASH_ORACLE_UPDATER_KEY) {
    const provider = new JsonRpcProvider(networkConfig.oasis.rpcUrl);
    blockHashOracleUpdater = new Wallet(process.env.BLOCK_HASH_ORACLE_UPDATER_KEY, provider);
    console.log("Using block hash oracle updater:", blockHashOracleUpdater.address);
    console.log("Sending some ROSE to the updater...");
    await owner
      .sendTransaction({
        to: blockHashOracleUpdater.address,
        value: networkConfig.amtToBlockHashUpdater || ethers.parseEther("10"),
      })
      .then((r) => r.wait());
  } else {
    blockHashOracleUpdater = owner;
  }

  console.log("Owner address:", await owner.getAddress());

  // Deploy EIP712Utils library
  const Eip712UtilsFactory = await ethers.getContractFactory("EIP712Utils");
  const eip712Utils = await Eip712UtilsFactory.deploy();
  await eip712Utils.waitForDeployment();
  console.log("EIP712Utils deployed to:", eip712Utils.target);

  // Deploy BasicEncumberedWallet
  const BasicEncumberedWalletFactory = await ethers.getContractFactory("BasicEncumberedWallet", {
    libraries: {
      EIP712Utils: eip712Utils.target,
    },
  });
  const wallet = await BasicEncumberedWalletFactory.deploy();
  await wallet.waitForDeployment();
  console.log("BasicEncumberedWallet deployed to:", wallet.target);

  // Deploy TrivialBlockHashOracle
  const TrivialBlockHashOracleFactory = await ethers.getContractFactory("TrivialBlockHashOracle");
  const blockHashOracle =
    await TrivialBlockHashOracleFactory.connect(blockHashOracleUpdater).deploy();
  await blockHashOracle.waitForDeployment();
  console.log("TrivialBlockHashOracle deployed to:", blockHashOracle.target);

  // Deploy ProvethVerifier
  const ProvethVerifierFactory = await ethers.getContractFactory("ProvethVerifier");
  const stateVerifier = await ProvethVerifierFactory.deploy();
  await stateVerifier.waitForDeployment();
  console.log("ProvethVerifier deployed to:", stateVerifier.target);

  // Deploy TransactionSerializer
  const TransactionSerializerFactory = await ethers.getContractFactory("TransactionSerializer");
  const transactionSerializer = await TransactionSerializerFactory.deploy();
  await transactionSerializer.waitForDeployment();
  console.log("TransactionSerializer deployed to:", transactionSerializer.target);

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
  await txPolicy.waitForDeployment();
  console.log("ConstrainedTransactionPolicy deployed to:", txPolicy.target);

  // Deploy NFT contract
  let ownerPublic: Wallet;
  if (networkEnv === "dev") {
    // For development, use the hardcoded key
    ownerPublic = new ethers.Wallet(
      "0x519028d411cec86054c9c35903928eed740063336594f1b3b076fce119238f6a",
    ).connect(publicProvider);
  } else if (process.env.PRIVATE_KEY) {
    // For test/prod, use the provided key
    const provider = new JsonRpcProvider(networkConfig.ethereum.rpcUrl, {
      chainId: networkConfig.ethereum.chainId,
      name: networkConfig.ethereum.name,
    });
    ownerPublic = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  } else {
    throw new Error("Invalid network environment; ensure you have PRIVATE_KEY set");
  }
  console.log("Owner public address:", ownerPublic.address);

  const TestNFTFactory = await ethers
    .getContractFactory("TestERC721")
    .then((factory) => factory.connect(ownerPublic));

  let nftContract: IERC721;
  let nftTokenId: bigint;

  if (networkConfig.nftContractAddress === undefined) {
    const testNftContract = await TestNFTFactory.deploy();
    await testNftContract.waitForDeployment();
    console.log("TestERC721 deployed to:", testNftContract.target);

    nftTokenId = await testNftContract
      .connect(ownerPublic)
      .safeMint.staticCall(ownerPublic.address);
    await testNftContract
      .connect(ownerPublic)
      .safeMint(ownerPublic.address)
      .then((t) => t.wait());
    console.log("Minted NFT token ID:", nftTokenId);
    nftContract = testNftContract;
  } else {
    nftContract = await ethers.getContractAt(
      "IERC721",
      networkConfig.nftContractAddress,
      ownerPublic,
    );
    if (networkConfig.nftTokenId === undefined) {
      throw new Error("NFT token ID must be defined if contract address is defined");
    }
    nftTokenId = networkConfig.nftTokenId;
  }

  // Deploy NFTAuctionPolicy
  const NFTAuctionPolicyFactory = await ethers.getContractFactory("NFTAuctionPolicy", {
    libraries: {
      TransactionSerializer: transactionSerializer.target,
    },
  });

  console.log("current NFT owner:", await nftContract.ownerOf(nftTokenId));

  const auctionPolicy = await NFTAuctionPolicyFactory.deploy(
    wallet.target,
    nftContract.target,
    (await publicProvider.getNetwork()).chainId,
    nftTokenId,
    networkConfig.minOwnershipTime, // Min ownership time
    networkConfig.minEncumbranceTimeRemainingToBid, // Min encumbrance time remaining to bid
    txPolicy.target,
    ownerPublic.address,
    {
      // Gas estimation was incorrect; we'll just make it high.
      // You need 1.5 ROSE in your account to send this (won't use all)
      gasLimit: 15_000_000n,
    },
  );
  await auctionPolicy.waitForDeployment();
  console.log("NFTAuctionPolicy deployed to:", auctionPolicy.target);

  // Deploy NFTOwnerControls
  const NFTOwnerControlsFactory = await ethers.getContractFactory("NFTOwnerControls");
  const ownerControls = await NFTOwnerControlsFactory.deploy(auctionPolicy.target);
  await ownerControls.waitForDeployment();
  console.log("NFTOwnerControls deployed to:", ownerControls.target);

  // Deploy WalletConnectMessagePolicy
  const WalletConnectMessagePolicyFactory = await ethers.getContractFactory(
    "WalletConnectMessagePolicy",
  );
  const messagePolicy = await WalletConnectMessagePolicyFactory.deploy(wallet.target);
  await messagePolicy.waitForDeployment();
  console.log("WalletConnectMessagePolicy deployed to:", messagePolicy.target);

  // Deploy ApeLiquefactionWalletFactory
  const ApeLiquefactionWalletFactory = await ethers.getContractFactory(
    "ApeLiquefactionWalletFactory",
  );
  const nftWalletFactory = await ApeLiquefactionWalletFactory.deploy(
    await wallet.getAddress(),
    await txPolicy.getAddress(),
    await auctionPolicy.getAddress(),
    await messagePolicy.getAddress(),
    networkConfig.totalEncumbranceTime,
  );
  await nftWalletFactory.waitForDeployment();
  console.log("ApeLiquefactionWalletFactory deployed to:", nftWalletFactory.target);

  console.log("\nSetting trusted wallet factory...");
  // Owner: Set trusted wallet factory
  await auctionPolicy.setTrustedWalletFactory(nftWalletFactory.target).then((r) => r.wait());

  const walletFactoryDeployment = nftWalletFactory.deploymentTransaction();
  if (walletFactoryDeployment === null) {
    throw new Error("Wallet factory deployment transaction is null");
  }
  await walletFactoryDeployment.wait();

  // Owner: Set trusted wallet factory
  await auctionPolicy.setTrustedWalletFactory(nftWalletFactory.target).then((r) => r.wait());

  // Create wallet from factory
  const factory = nftWalletFactory.connect(sapphire.wrap(owner));
  console.log("Creating wallet...");
  console.log(await factory.createWallet.staticCall(0));
  await factory.createWallet(0).then((w) => w.wait());
  const attendedWalletCount = await wallet.connect(sapphire.wrap(owner)).getAttendedWalletCount();
  console.log("Attended wallet count:", attendedWalletCount);
  const myAttendedWallet = await wallet.connect(sapphire.wrap(owner)).getAttendedWallet(0);
  console.log("Wallet index:", myAttendedWallet.index);
  const walletAddr = await wallet
    .connect(sapphire.wrap(owner))
    .getWalletAddress(myAttendedWallet.index);
  console.log("Wallet address:", walletAddr);

  const finalAttendedWalletCount = await wallet
    .connect(sapphire.wrap(owner))
    .getAttendedWalletCount();
  if (finalAttendedWalletCount !== 1n) {
    throw new Error("Attended wallet count is not 1: " + finalAttendedWalletCount.toString());
  }

  const tx0 = await ownerPublic.populateTransaction({
    to: walletAddr,
    value: networkConfig.minEthBalance,
  });
  const tx0Transaction = ethers.Transaction.from(await ownerPublic.signTransaction(tx0));
  const tx0Hash = tx0Transaction.hash;
  if (tx0Hash === null) {
    throw new Error("Could not get hash from transaction 0");
  }

  // 2. Broadcast the deposit transaction and ensure it is included
  const tx0Receipt = await publicProvider
    .broadcastTransaction(tx0Transaction.serialized)
    .then((r) => r.wait());

  // 3. Add balance to the wallet
  console.log("Step 3");
  const tx0ReceiptHash = tx0Receipt?.hash;
  if (tx0Receipt === null || tx0ReceiptHash === undefined) {
    throw new Error("Could not get tx receipt hash from transaction 0");
  }
  await blockHashOracle
    .connect(blockHashOracleUpdater)
    .setBlockHash(tx0Receipt.blockNumber, tx0Receipt.blockHash)
    .then((r) => r.wait());
  const blockHash = await blockHashOracle.getBlockHash(tx0Receipt.blockNumber);
  console.log("Block hash:", blockHash);

  let { signedTxFormatted, inclusionProof, proofBlockNumber } = await getTxInclusion(
    publicProvider,
    tx0ReceiptHash,
  );

  console.log(signedTxFormatted);

  console.log("Depositing funds...");
  await txPolicy
    .connect(sapphire.wrap(owner))
    .depositFunds(signedTxFormatted, inclusionProof, proofBlockNumber)
    .then((r) => r.wait());
  const targetChainId = (await publicProvider.getNetwork()).chainId;

  console.log("Depositing local funds...");
  await txPolicy
    .depositLocalFunds(walletAddr, targetChainId, {
      value: networkConfig.minOasisBalance,
    })
    .then((r) => r.wait());

  // 4. Bid
  // TODO: placeBid function must ensure there's enough ETH and local funds deposited!
  console.log("Bidding (1)...");
  await auctionPolicy
    .connect(sapphire.wrap(owner))
    .placeBid(walletAddr, 5, { value: 5n })
    .then((r) => r.wait());

  // 5. Finalize
  console.log("Finalizing auction...");
  await auctionPolicy
    .connect(sapphire.wrap(owner))
    .finalizeAuction()
    .then((r) => r.wait());

  console.log("Current NFT owner:", await auctionPolicy.currentOwner());

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

  // Owner sets
  console.log("Setting previous proven owner to " + walletAddr + "...");
  await auctionPolicy
    .connect(sapphire.wrap(owner))
    .setPreviousProvenOwner(walletAddr)
    .then((r) => r.wait());

  console.log("Broadcasted and included!");

  /*
  // Create a second wallet and buy the NFT
  await factory.createWallet(1).then((w) => w.wait());
  const attendedWalletCount2 = await wallet.connect(sapphire.wrap(owner)).getAttendedWalletCount();
  console.log("Attended wallet count:", attendedWalletCount2);
  const myAttendedWallet2 = await wallet.connect(sapphire.wrap(owner)).getAttendedWallet(1);
  console.log("Wallet index:", myAttendedWallet2.index);
  const walletAddr2 = await wallet
    .connect(sapphire.wrap(owner))
    .getWalletAddress(myAttendedWallet2.index);

  // ================
  const tx2 = await ownerPublic.populateTransaction({
    to: walletAddr2,
    value: networkConfig.minEthBalance,
  });
  const tx2Transaction = ethers.Transaction.from(await ownerPublic.signTransaction(tx2));
  const tx2Hash = tx2Transaction.hash;
  if (tx2Hash === null) {
    throw new Error("Could not get hash from transaction 2");
  }

  // 2. Broadcast the deposit transaction and ensure it is included
  const tx2Receipt = await publicProvider
    .broadcastTransaction(tx2Transaction.serialized)
    .then((r) => r.wait());

  // 3. Add balance to the wallet
  console.log("Step 3");
  const tx2ReceiptHash = tx2Receipt?.hash;
  if (tx2Receipt === null || tx2ReceiptHash === undefined) {
    throw new Error("Could not get tx receipt hash from transaction 2");
  }
  await blockHashOracle
    .connect(blockHashOracleUpdater)
    .setBlockHash(tx2Receipt.blockNumber, tx2Receipt.blockHash)
    .then((r) => r.wait());

  ({ signedTxFormatted, inclusionProof, proofBlockNumber } = await getTxInclusion(
    publicProvider,
    tx2ReceiptHash,
  ));

  console.log(signedTxFormatted);

  console.log("Depositing funds...");
  await txPolicy
    .connect(sapphire.wrap(owner))
    .depositFunds.staticCallResult(signedTxFormatted, inclusionProof, proofBlockNumber);
  await txPolicy
    .connect(sapphire.wrap(owner))
    .depositFunds(signedTxFormatted, inclusionProof, proofBlockNumber)
    .then((r) => r.wait());

  console.log("Depositing local funds...");
  await txPolicy
    .depositLocalFunds(walletAddr2, targetChainId, {
      value: networkConfig.minOasisBalance,
    })
    .then((r) => r.wait());

  try {
    console.log("Trying to finalize the auction...");
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .finalizeAuction()
      .then((r) => r.wait());
  } catch (e) {
    console.log("Auction didn't need finalizing.");
  }

  // Bid again (2)
  console.log("Bidding (2)...");
  await auctionPolicy
    .connect(sapphire.wrap(owner))
    .placeBid.staticCall(walletAddr2, 5n, { value: 5n });
  await auctionPolicy
    .connect(sapphire.wrap(owner))
    .placeBid(walletAddr2, 5n, { value: 5n })
    .then((r) => r.wait());

  const auctionEnds =
    (await auctionPolicy.auctionStartTime()) + (await auctionPolicy.minOwnershipTime());
  console.log("Auction ends:", auctionEnds);
  console.log("Current time:", getCurrentTime());

  const timeToWait = bigIntMax(0n, auctionEnds - BigInt(getCurrentTime()) + 10n);
  if (timeToWait > 0n) {
    console.log("Waiting", Number(timeToWait), "seconds...");
    await new Promise<void>((resolve) => setTimeout(resolve, Number(timeToWait) * 1000));
  }

  // 5. Finalize
  console.log("Finalizing auction...");
  await auctionPolicy
    .connect(sapphire.wrap(owner))
    .finalizeAuction()
    .then((r) => r.wait());

  console.log("Current NFT owner:", await auctionPolicy.currentOwner());

  // Sign the transfer
  const maxFeePerGas = ethers.parseUnits("2", "gwei");
  const nftTransferTx2 = await auctionPolicy
    .connect(sapphire.wrap(owner))
    .getNFTTransferTransaction(
      maxFeePerGas,
      walletAddr2,
      await publicProvider.getTransactionCount(walletAddr),
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

  const ethSig3 = derToEthSignature(txSig3, tx3.unsignedSerialized, walletAddr, "bytes");
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
  console.log("Broadcasted and included!");

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
    .connect(blockHashOracleUpdater)
    .setBlockHash(tx3Receipt.blockNumber, tx3Receipt.blockHash)
    .then((r) => r.wait());

  // 5. Prove transaction inclusion to the encumbrance policy
  await txPolicy
    .proveTransactionInclusion(signedTxFormatted3, inclusionProof3, proofBlockNumber3)
    .then((tx) => tx.wait());

  await auctionPolicy
    .connect(sapphire.wrap(owner))
    .provePreviousTransfer(
      signedTxFormatted3,
      // We assume the signed transaction index is equal to the nonce of
      // the transaction since this account has been encumbered in the transaction
      // policy from its birth.
      signedTxFormatted3.transaction.nonce,
      walletAddr2,
      signedTxFormatted3.transaction.nonce,
      signedTxFormatted3.transaction.maxFeePerGas,
    )
    .then((tx) => tx.wait());
  */

  // Add to whitelist
  if (networkConfig.whitelist) {
    console.log("Updating whitelist...");
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .updateWhitelist(networkConfig.whitelist ?? [], true)
      .then((r) => r.wait());
  }

  if (networkConfig.whitelistEnabled !== true) {
    console.log("Disabling whitelist...");
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .setWhitelistEnabled(false)
      .then((r) => r.wait());
  }

  if (networkEnv !== "prod") {
    console.log("Updating minimums...");
    await auctionPolicy
      .connect(sapphire.wrap(owner))
      .updateMinimumBalances(networkConfig.minEthBalance, networkConfig.minOasisBalance)
      .then((r) => r.wait());
  }

  // Update the environment file to include network information
  const envContent = `NEXT_PUBLIC_NETWORK_ENV="${networkEnv}"
NEXT_PUBLIC_CONTRACT_ADDRESS="${wallet.target}"
NEXT_PUBLIC_FACTORY_ADDRESS="${nftWalletFactory.target}"
NEXT_PUBLIC_TX_POLICY_ADDRESS="${txPolicy.target}"
NEXT_PUBLIC_NFT_AUCTION_POLICY_ADDRESS="${auctionPolicy.target}"
NEXT_PUBLIC_MESSAGE_POLICY_ADDRESS="${messagePolicy.target}"
NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS="${blockHashOracle.target}"
NEXT_PUBLIC_NFT_CONTRACT_ADDRESS="${nftContract.target}"
NEXT_PUBLIC_NFT_TOKEN_ID="${nftTokenId}"
NEXT_PUBLIC_OWNER_CONTROLS_ADDRESS="${ownerControls.target}"
`;

  fs.writeFileSync(".env.local", envContent);
  console.log("Environment variables saved to .env.local");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
