import { ethers } from "hardhat";
import { JsonRpcProvider } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import {
  type NetworkConfig,
  type AddressLikeNonPromise,
  type NetworkEnv,
  networkConfigs,
} from "../../frontend/src/utils/networkConfig";
import { MinimalUpgradableWalletReceiver } from "../liquefaction/typechain-types/contracts/wallet/MinimalUpgradableWalletReceiver";

// Load environment variables from .env.local file
const envPath = path.join(__dirname, "..", "..", "frontend", ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const privateKey = process.env.PRIVATE_KEY || "";
const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
const networkEnv = (process.env.NEXT_PUBLIC_NETWORK_ENV || "dev") as NetworkEnv;
const networkConfig = networkConfigs[networkEnv];

if (privateKey === "" || contractAddress === "") {
  throw new Error("Specify PRIVATE_KEY and NEXT_PUBLIC_CONTRACT_ADDRESS environment variables");
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

async function deployMinimalUpgradableWalletReceiver() {
  const receiverFactory = await ethers.getContractFactory("MinimalUpgradableWalletReceiver");
  const receiver = await receiverFactory.deploy();
  await receiver.waitForDeployment();
  return receiver;
}

async function main() {
  // Create providers
  const publicProvider = new JsonRpcProvider(networkConfig.oasis.rpcUrl);
  const walletSigner = sapphire.wrap(new ethers.Wallet(privateKey, publicProvider));

  const wallet = await ethers.getContractAt("BasicEncumberedWallet", contractAddress, walletSigner);

  const minimalUpgradableWalletReceiver = await deployMinimalUpgradableWalletReceiver();

  const receiverPk = await getUserInput("Enter receiver public key (receiverPk): ");
  const receiverSk = await getUserInput("Enter receiver secret key (receiverSk): ");
  const accountIndexInput = await getUserInput("Enter account index: ");
  const accountIndex = BigInt(accountIndexInput);

  const walletAddress = await wallet.getWalletAddress(accountIndex);

  console.log("Getting export public key...");
  const keyExportPubKey = await wallet.keyExportPublicKey();

  console.log("Encrypting key export message...");
  const keyExportMessage = ethers.AbiCoder.defaultAbiCoder().encode(
    ["string", "address"],
    ["Key export", walletAddress],
  );
  const { ciphertext: keyExportMessageCiphertext, nonce: keyExportMessageNonce } =
    await minimalUpgradableWalletReceiver.encrypt(keyExportMessage, receiverSk, keyExportPubKey);

  console.log("Requesting key export...");
  try {
    await wallet
      .requestKeyExport(accountIndex, receiverPk, keyExportMessageCiphertext, keyExportMessageNonce)
      .then((r) => r.wait());
  } catch (e) {
    console.error(e);
  }
  const { ciphertext: keyCiphertext, nonce: keyNonce } = await wallet.exportKey(accountIndex);

  const exportedKeyCounterparty = await wallet.getExportedKeyCounterparty(accountIndex);
  console.log("Exported Key Counterparty:", exportedKeyCounterparty);

  // Decrypt the key
  console.log("Decrypting the key...");
  const key = await minimalUpgradableWalletReceiver.decrypt(
    keyCiphertext,
    keyNonce,
    keyExportPubKey,
    receiverSk,
  );

  console.log("Decrypted Key:", key);
}

main().then(() => {
  rl.close();
  process.exit(0);
});
