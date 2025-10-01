import { ethers } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { JsonRpcProvider, JsonRpcApiProvider, Transaction, Wallet } from "ethers";
import {
  type NetworkConfig,
  type AddressLikeNonPromise,
  type NetworkEnv,
  networkConfigs,
} from "../../frontend/src/utils/networkConfig";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import { derToEthSignature } from "../liquefaction/scripts/ethereum-signatures";
import { convertTransaction } from "./tx-utils";
import { getRlpUint, getTxInclusionProof } from "../liquefaction/scripts/inclusion-proofs";

function throwIfEmpty<T>(val: T | undefined | null, valStr: string): T {
  if (val === undefined || val === null) {
    throw new Error("Expected value to be non-empty: " + valStr);
  }
  return val;
}

const envPath = path.join(__dirname, "..", "..", "frontend", ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const privateKey = process.env.PRIVATE_KEY || "";
if (privateKey === "") {
  throw new Error("Specify PRIVATE_KEY environment variable");
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function getUserInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  const networkEnv = (process.env.NEXT_PUBLIC_NETWORK_ENV || "dev") as NetworkEnv;
  const networkConfig = networkConfigs[networkEnv];
  const publicProvider = new ethers.JsonRpcProvider(networkConfig.ethereum.rpcUrl);
  const provider = new ethers.JsonRpcProvider(networkConfig.oasis.rpcUrl);
  const firstSigner = new ethers.Wallet(privateKey, provider);

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

  const owner = sapphire.wrap(firstSigner);
  const txPolicy = await ethers.getContractAt(
    "ConstrainedTransactionPolicy",
    process.env.NEXT_PUBLIC_TX_POLICY_ADDRESS || "",
    owner,
  );
  const auctionPolicy = await ethers.getContractAt(
    "NFTAuctionPolicy",
    process.env.NEXT_PUBLIC_NFT_AUCTION_POLICY_ADDRESS || "",
    owner,
  );
  const blockHashOracle = await ethers.getContractAt(
    "TrivialBlockHashOracle",
    process.env.NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS || "",
    owner,
  );

  const tx3Hash = await getUserInput("Enter tx hash: ");
  const tx3Receipt = await publicProvider.getTransactionReceipt(tx3Hash);

  if (tx3Receipt === null) {
    throw new Error("Transaction receipt is null");
  }
  const newOwnerAddress = await getUserInput("Enter new owner address: ");

  let {
    signedTxFormatted: signedTxFormatted3,
    inclusionProof: inclusionProof3,
    proofBlockNumber: proofBlockNumber3,
  } = await getTxInclusion(publicProvider, tx3Hash);

  // Update block hash oracle
  const bHash = await blockHashOracle.getBlockHash(tx3Receipt.blockNumber);
  console.log(bHash, tx3Receipt.blockHash);

  // 5. Prove transaction inclusion to the encumbrance policy
  await txPolicy.proveTransactionInclusion.staticCall(
    signedTxFormatted3,
    inclusionProof3,
    proofBlockNumber3,
  );
  console.log("Prove transaction inclusion simulation OK");
  await getUserInput("Press Enter to submit...");

  await txPolicy
    .proveTransactionInclusion(signedTxFormatted3, inclusionProof3, proofBlockNumber3)
    .then((tx) => tx.wait());
  console.log("Transaction inclusion done.");

  // Register the proof in the auction policy
  await auctionPolicy.provePreviousTransfer.staticCall(
    signedTxFormatted3,
    signedTxFormatted3.transaction.nonce,
    newOwnerAddress,
    signedTxFormatted3.transaction.nonce,
    signedTxFormatted3.transaction.maxFeePerGas,
  );
  console.log("Prove previous transfer simulation OK");
  await getUserInput("Press Enter to submit...");

  await auctionPolicy
    .provePreviousTransfer(
      signedTxFormatted3,
      signedTxFormatted3.transaction.nonce,
      newOwnerAddress,
      signedTxFormatted3.transaction.nonce,
      signedTxFormatted3.transaction.maxFeePerGas,
    )
    .then((tx) => tx.wait());
  console.log("Prove previous transfer complete.");
}

main().then(() => {
  rl.close();
  process.exit(0);
});
