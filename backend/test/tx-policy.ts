import { expect } from "chai";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { type JsonRpcApiProvider, type BytesLike } from "ethers";
import { ethers } from "hardhat";
import { derToEthSignature } from "../liquefaction/scripts/ethereum-signatures";
import { getRlpUint, getTxInclusionProof } from "../liquefaction/scripts/inclusion-proofs";

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

describe("ConstrainedTransactionPolicy", function () {
  async function deployContracts() {
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

    // Deploy TrivialBlockHashOracle
    const TrivialBlockHashOracleFactory = await ethers.getContractFactory("TrivialBlockHashOracle");
    const blockHashOracle = await TrivialBlockHashOracleFactory.deploy();

    // Deploy ProvethVerifier
    const ProvethVerifierFactory = await ethers.getContractFactory("ProvethVerifier");
    const stateVerifier = await ProvethVerifierFactory.deploy();

    // Deploy TransactionSerializer
    const TransactionSerializerFactory = await ethers.getContractFactory("TransactionSerializer");
    const transactionSerializer = await TransactionSerializerFactory.deploy();

    // Deploy ConstrainedTransactionPolicy
    const ConstrainedTransactionPolicyFactory = await ethers.getContractFactory(
      "ConstrainedTransactionPolicy",
      {
        libraries: {
          TransactionSerializer: transactionSerializer.target,
        },
      },
    );
    const policy = await ConstrainedTransactionPolicyFactory.deploy(
      wallet.target,
      blockHashOracle.target,
      stateVerifier.target,
    );

    return {
      owner,
      wallet,
      blockHashOracle,
      stateVerifier,
      policy: policy.connect(owner),
    };
  }

  async function getAccounts() {
    // Contracts are deployed using the first signer/account by default
    // 0x72A6CF1837105827077250171974056B40377488
    const ownerPublic = new ethers.Wallet(
      "0x519028d411cec86054c9c35903928eed740063336594f1b3b076fce119238f6a",
    ).connect(publicProvider);

    return { ownerPublic };
  }

  it("Should sign encumbered Ethereum transactions and increment the nonce using a transaction inclusion proof", async () => {
    const { owner, wallet, policy, blockHashOracle } = await deployContracts();
    const { ownerPublic } = await getAccounts();

    // Create wallet
    await wallet.createWallet(0).then(async (c) => c.wait());
    const walletAddr = await wallet.connect(sapphire.wrap(owner)).getWalletAddress(0);
    const tx0 = await ownerPublic.populateTransaction({
      to: walletAddr,
      value: ethers.parseEther("0.1"),
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
      .setBlockHash(tx0Receipt.blockNumber, tx0Receipt.blockHash)
      .then((r) => r.wait());

    let { signedTxFormatted, inclusionProof, proofBlockNumber } = await getTxInclusion(
      publicProvider,
      tx0ReceiptHash,
    );

    await wallet.enterEncumbranceContract(
      0,
      [ethers.zeroPadValue("0x02", 32)],
      policy.target,
      getCurrentTime() + 3600,
      ethers.AbiCoder.defaultAbiCoder().encode(["address"], [owner.address]),
    );
    await policy.enterEncumbranceContract(
      walletAddr,
      [
        {
          chainId: (await publicProvider.getNetwork()).chainId,
          to: "0x0000000000000000000000000000000000000000",
        },
      ],
      owner.address,
      getCurrentTime() + 1800,
      "0x",
    );

    await policy
      .connect(sapphire.wrap(owner))
      .depositFunds.staticCallResult(signedTxFormatted, inclusionProof, proofBlockNumber);
    await policy
      .connect(sapphire.wrap(owner))
      .depositFunds(signedTxFormatted, inclusionProof, proofBlockNumber)
      .then((r) => r.wait());
    console.log("Done");

    const targetChainId = (await publicProvider.getNetwork()).chainId;

    await expect(
      policy.connect(sapphire.wrap(owner)).getEthBalance(walletAddr, targetChainId),
    ).to.eventually.equal(ethers.parseEther("0.1"));

    await policy
      .depositLocalFunds(walletAddr, (await publicProvider.getNetwork()).chainId, {
        value: ethers.parseEther("0.2"),
      })
      .then((r) => r.wait());

    await expect(
      policy.connect(sapphire.wrap(owner)).getSubpolicyLocalBalance(walletAddr, targetChainId),
    ).to.eventually.equal(ethers.parseEther("0.2"));

    // TODO: NEEDS TO ENROLL POLICY THAT HAS ACCESS TO AN ASSET TYPE AND SIGN A MESSAGE CORRESPONDING TO THAT ASSET

    // 4. Sign a transaction on behalf of the encumbered wallet
    const tx1 = {
      chainId: (await publicProvider.getNetwork()).chainId,
      nonce: 0,
      maxPriorityFeePerGas: 10_000_000_000n,
      maxFeePerGas: 10_000_000_000n,
      gasLimit: 21_000n,
      to: "0x0000000000000000000000000000000000000000",
      amount: 0n,
      data: "0x",
    };
    const tx1Transaction = ethers.Transaction.from({ ...tx1, type: 2 });
    const tx1UnsignedSerialized: BytesLike = tx1Transaction.unsignedSerialized;

    const txSig1 = await policy.connect(sapphire.wrap(owner)).signTransaction(walletAddr, {
      ...tx1,
      destination: tx1.to,
      payload: tx1.data,
    });
    const ethSig1 = derToEthSignature(txSig1, tx1UnsignedSerialized, walletAddr, "bytes");
    if (ethSig1 === undefined) {
      throw new Error("Could not verify transaction signature");
    }
    tx1Transaction.signature = ethSig1;

    // 3. Broadcast transaction on target blockchain
    console.log("Broadcasting", tx1Transaction);
    const tx1Receipt = await publicProvider
      .broadcastTransaction(tx1Transaction.serialized)
      .then((r) => r.wait());

    if (tx1Receipt === null) {
      throw new Error("Transaction 1 receipt is null");
    }
    console.log("Broadcasted and included!");

    // 4. Create transaction inclusion proof
    const tx1Hash = tx1Transaction.hash;
    if (tx1Hash === null) {
      throw new Error("Could not get hash from transaction 1");
    }
    let {
      signedTxFormatted: signedTxFormatted1,
      inclusionProof: inclusionProof1,
      proofBlockNumber: proofBlockNumber1,
    } = await getTxInclusion(publicProvider, tx1Hash);

    // Update block hash oracle
    await blockHashOracle
      .setBlockHash(tx1Receipt.blockNumber, tx1Receipt.blockHash)
      .then((r) => r.wait());

    // 5. Prove transaction inclusion to the encumbrance policy
    await policy
      .proveTransactionInclusion(signedTxFormatted1, inclusionProof1, proofBlockNumber1)
      .then((tx) => tx.wait());
  });
});
