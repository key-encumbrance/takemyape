import { ethers } from "hardhat";
import { JsonRpcProvider, Signer, type AbstractProvider } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import * as readline from "readline";
import BlockHashOracle from "../../frontend/src/contracts/TrivialBlockHashOracle.json";
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

const contractABI = BlockHashOracle.abi;

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

// Get network configuration based on environment
const networkEnv = (process.env.NEXT_PUBLIC_NETWORK_ENV || "dev") as NetworkEnv;
const networkConfig = networkConfigs[networkEnv];

async function main() {
  let oasisProvider = new JsonRpcProvider(networkConfig.oasis.rpcUrl);

  const blockHashOracleAddress = process.env.NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS;

  if (!blockHashOracleAddress) {
    console.error("NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS not found in environment variables");
    process.exit(1);
  }

  // Get the block hash oracle contract with the correct ABI
  const blockHashOracle = new ethers.Contract(blockHashOracleAddress, contractABI, oasisProvider);

  const blockNumber = Number(
    process.env.BLOCK_NUMBER ?? (await getUserInput("Enter block number: ")),
  );
  console.log(blockNumber);

  const blockHash = await blockHashOracle.getBlockHash(Number(blockNumber));
  console.log(blockHash);
}

main().then(() => process.exit(0));
