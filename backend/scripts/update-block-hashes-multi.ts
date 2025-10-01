import { ethers } from "hardhat";
import { JsonRpcProvider, Signer, type AbstractProvider, TransactionResponse } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
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

// Get network configuration based on environment
const networkEnv = (process.env.NEXT_PUBLIC_NETWORK_ENV || "dev") as NetworkEnv;
const networkConfig = networkConfigs[networkEnv];

// Configuration
const POLL_INTERVAL_MS = 1000; // Poll every second
const MAX_BLOCKS_PER_UPDATE = 20; // Maximum number of blocks to update in one go

async function main() {
  const oasisRpcProvider = new JsonRpcProvider(networkConfig.oasis.rpcUrl, undefined, {
    polling: true,
    pollingInterval: 1500,
  });
  console.log("Polling interval:", oasisRpcProvider.pollingInterval);
  let [owner]: Signer[] = await ethers.getSigners();

  console.log("Network environment:", networkEnv);

  const bhUpdaterKey = process.env.BLOCK_HASH_ORACLE_UPDATER_KEY;
  if (bhUpdaterKey) {
    console.log("Using block hash oracle updater key");
    owner = new ethers.Wallet(bhUpdaterKey).connect(oasisRpcProvider);
  } else {
    console.log(
      "No oracle updater key specified via BLOCK_HASH_ORACLE_UPDATER_KEY. Ensure you are using `--network`!",
    );
  }
  console.log("Block hash oracle updater address:", await owner.getAddress());

  // Create providers
  let publicProvider: AbstractProvider = new JsonRpcProvider(networkConfig.ethereum.rpcUrl);

  if (networkEnv === "prod") {
    const allProviders = [
      publicProvider,
      new JsonRpcProvider("https://eth.llamarpc.com"),
      new JsonRpcProvider("https://1rpc.io/eth"),
      new JsonRpcProvider("https://ethereum-rpc.publicnode.com"),
      new JsonRpcProvider("https://go.getblock.io/aefd01aa907c4805ba3c00a9e5b48c6b"),
      new JsonRpcProvider("https://api.securerpc.com/v1"),
      new JsonRpcProvider("https://eth.drpc.org"),
    ];
    console.log("Using quorum of Ethereum providers.");
    publicProvider = new ethers.FallbackProvider(allProviders, 1n, { quorum: 3 });
  }

  const blockHashOracleAddress = process.env.NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS;
  const proxyContractAddress = process.env.NEXT_PUBLIC_MULTI_BLOCK_HASH_SETTER_PROXY_ADDRESS;

  if (!blockHashOracleAddress || !proxyContractAddress) {
    console.error(
      "NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS or NEXT_PUBLIC_MULTI_BLOCK_HASH_SETTER_PROXY_ADDRESS not found in environment variables",
    );
    process.exit(1);
  }

  // Get the block hash oracle contract with the correct ABI
  console.log("Block hash oracle:", blockHashOracleAddress);
  const blockHashOracle = await ethers.getContractAt(
    "TrivialBlockHashOracle",
    blockHashOracleAddress,
    owner,
  );
  const proxyContract = await ethers.getContractAt(
    "MultiBlockHashSetterProxy",
    proxyContractAddress,
    owner,
  );

  console.log("Starting block hash update service...");
  console.log("Block hash oracle address:", blockHashOracleAddress);
  console.log("MultiBlockHashSetterProxy address:", proxyContractAddress);
  console.log("Using Ethereum RPC URL:", networkConfig.ethereum.rpcUrl);

  let lastProcessedBlock = Number(
    process.env.LAST_DONE || (await publicProvider.getBlockNumber()) - 2,
  );
  console.log("Starting from block:", lastProcessedBlock);

  // Main update loop
  while (true) {
    try {
      console.log("Getting current block...");
      const currentBlockNumber = (await publicProvider.getBlockNumber()) - 2;
      console.log("Current block number:", currentBlockNumber);

      if (currentBlockNumber > lastProcessedBlock) {
        const blocksToProcess = Math.min(
          currentBlockNumber - lastProcessedBlock,
          MAX_BLOCKS_PER_UPDATE,
        );

        console.log(`Processing ${blocksToProcess} new blocks...`);

        // Process blocks in batches
        const blockNumbersToProcess = Array.from(
          { length: blocksToProcess },
          (_, i) => lastProcessedBlock + i + 1,
        );
        const newBlocks = await Promise.all(
          blockNumbersToProcess.map((blockNumber) => publicProvider.getBlock(blockNumber)),
        );

        const blockHashes: string[] = newBlocks.map((block) => {
          if (block && block.hash) {
            return block.hash;
          } else {
            throw new Error("Block or block hash is null");
          }
        });
        const blockNumbers = blockNumbersToProcess;

        // Check if the block hashes are already set using the blockHashes mapping
        console.log(`Getting existing hashes for blocks ${blockNumbersToProcess}...`);
        const existingHashes = await Promise.all(
          blockNumbersToProcess.map((blockNumber) => blockHashOracle.blockHashes(blockNumber)),
        );
        const hashesToSet = blockNumbers.filter((_, i) => existingHashes[i] === ethers.ZeroHash);
        const hashesToSetBlockNumbers = blockNumbers.filter(
          (_, i) => existingHashes[i] === ethers.ZeroHash,
        );
        const hashesToSetHashes = blockHashes.filter(
          (_, i) => existingHashes[i] === ethers.ZeroHash,
        );

        if (hashesToSet.length > 0) {
          // Set the block hashes
          console.log("Setting block hashes...");
          const tx = await proxyContract.setMultipleBlockHashes(
            hashesToSetBlockNumbers,
            hashesToSetHashes,
          );
          console.log("Waiting for receipt...");
          await tx.wait();
          console.log("Block hashes set successfully.");
        } else {
          console.log("All block hashes are already set.");
        }

        lastProcessedBlock += blocksToProcess;
      } else {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (error) {
      console.error("Error in main loop:", error);
      // Wait a bit longer on error before retrying
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS * 5));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
