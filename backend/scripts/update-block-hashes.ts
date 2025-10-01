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

const contractABI = BlockHashOracle.abi;

// Get network configuration based on environment
const networkEnv = (process.env.NEXT_PUBLIC_NETWORK_ENV || "dev") as NetworkEnv;
const networkConfig = networkConfigs[networkEnv];

// Configuration
const POLL_INTERVAL_MS = 1000; // Poll every second
const MAX_BLOCKS_PER_UPDATE = 10; // Maximum number of blocks to update in one go

async function main() {
  console.log("Using this Oasis RPC URL:", networkConfig.oasis.rpcUrl);
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
    console.log("Using built-in owner key");
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

  if (!blockHashOracleAddress) {
    console.error("NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS not found in environment variables");
    process.exit(1);
  }

  // Get the block hash oracle contract with the correct ABI
  const blockHashOracle = new ethers.Contract(blockHashOracleAddress, contractABI, owner);

  console.log("Starting block hash update service...");
  console.log("Block hash oracle address:", blockHashOracleAddress);
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
        let txs: TransactionResponse[] = [];
        for (let i = 0; i < blocksToProcess; i++) {
          const blockNumber = lastProcessedBlock + i + 1;
          const block = newBlocks[i];

          if (!block) {
            console.error(`Failed to get block ${blockNumber}`);
            continue;
          }

          if (block.number !== blockNumber) {
            throw new Error(
              "Block number mismatch! Expected " +
                blockNumber +
                " but got block with number " +
                block.number,
            );
          }

          if (!block.hash) {
            console.error(`Block ${blockNumber} has no hash`);
            continue;
          }

          try {
            // Check if the block hash is already set using the blockHashes mapping
            console.log("Getting existing hash...");
            const existingHash = await blockHashOracle.blockHashes(blockNumber);
            if (existingHash === ethers.ZeroHash) {
              // Set the block hash
              console.log("Setting block hash...");
              const tx = await blockHashOracle.setBlockHash(blockNumber, block.hash);
              console.log("Waiting for receipt...");
              await tx.wait();
              const blockHash = await blockHashOracle.blockHashes(blockNumber);
              console.log(`Set hash for block ${blockNumber}: ${blockHash}`);
            }
          } catch (error: any) {
            console.error("Fail.", error);
            // If blockHashes fails, try to set the hash anyway
            try {
              console.log(`Setting hash for block ${blockNumber}: ${block.hash}`);
              const tx = await blockHashOracle.setBlockHash(blockNumber, block.hash);
              const receipt = await tx.wait();
              console.log(receipt.status);
              const stored = await blockHashOracle.blockHashes(blockNumber);
              console.log(`Stored hash for block ${blockNumber}: ${stored}`);
              const blockHash = await blockHashOracle.getBlockHash(blockNumber);
              console.log(`Set hash for block ${blockNumber}: ${blockHash}`);
            } catch (setError: any) {
              console.error(`Failed to set hash for block ${blockNumber}:`, setError);
            }
          }
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
