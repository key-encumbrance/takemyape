import { ethers } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { JsonRpcProvider, Transaction, Wallet } from "ethers";
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
import { convertTransaction, convertTransaction2 } from "./tx-utils";

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

const networkEnv = (process.env.NEXT_PUBLIC_NETWORK_ENV || "dev") as NetworkEnv;
const networkConfig = networkConfigs[networkEnv];

async function main() {
  const provider = new ethers.JsonRpcProvider(networkConfig.oasis.rpcUrl);
  const firstSigner = new ethers.Wallet(privateKey, provider);

  const owner = sapphire.wrap(firstSigner);
  const nftAuctionPolicy = await ethers.getContractAt(
    "NFTAuctionPolicy",
    process.env.NEXT_PUBLIC_NFT_AUCTION_POLICY_ADDRESS || "",
    owner,
  );

  const maxFeePerGas = ethers.parseUnits(await getUserInput("Enter maxFeePerGas (gwei): "), "gwei");
  const newOwner = await getUserInput("Enter newOwner address: ");
  const nonce = Number(await getUserInput("Enter nonce: "));

  const transaction = await nftAuctionPolicy.getNFTTransferTransaction(
    maxFeePerGas,
    newOwner,
    nonce,
  );
  console.log(Array.from(transaction));

  const apeInt = new ethers.Interface([
    "function transferFrom(address from, address to, uint256 tokenId)",
  ]);

  const account = await getUserInput("Enter sender address: ");
  let txData = apeInt.encodeFunctionData("transferFrom", [
    account,
    newOwner,
    networkConfig.nftTokenId,
  ]);
  let txArray = Array.from(transaction) as any;
  if (transaction.payload != txData) {
    console.log(transaction.payload, txData);
    console.log(
      "WARNING: Default payload is",
      apeInt.decodeFunctionData("transferFrom", transaction.payload),
      "got:",
      apeInt.decodeFunctionData("transferFrom", txData),
    );
    txArray[7] = txData;
  }
  const convertedTx = convertTransaction2(txArray);

  const recoveredTransactionSig = await nftAuctionPolicy.recoverNFT(account, txArray);
  console.log("Recovered Transaction sig:", recoveredTransactionSig);
  const ethSig = derToEthSignature(
    recoveredTransactionSig,
    convertedTx.unsignedSerialized,
    account,
    "bytes",
  );
  if (ethSig === undefined) {
    throw new Error("Could not find valid signature for tx3");
  }
  convertedTx.signature = ethSig;
  console.log("Signed tx:", convertedTx.serialized);
}

main().then(() => {
  rl.close();
  process.exit(0);
});
