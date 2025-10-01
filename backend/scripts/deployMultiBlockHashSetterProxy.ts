import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import {
  type NetworkConfig,
  type NetworkEnv,
  networkConfigs,
} from "../../frontend/src/utils/networkConfig";

const envPath = path.join(__dirname, "..", "..", "frontend", ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const privateKey = process.env.PRIVATE_KEY || "";
if (privateKey === "") {
  throw new Error("Specify PRIVATE_KEY environment variable");
}

async function main() {
  const networkEnv = (process.env.NEXT_PUBLIC_NETWORK_ENV || "dev") as NetworkEnv;
  const networkConfig = networkConfigs[networkEnv];
  const provider = new ethers.JsonRpcProvider(networkConfig.oasis.rpcUrl);
  const owner = new ethers.Wallet(privateKey, provider);

  // Deploy the MultiBlockHashSetterProxy
  const MultiBlockHashSetterProxyFactory = await ethers.getContractFactory(
    "MultiBlockHashSetterProxy",
    owner,
  );

  const blockHashOracleAddr = process.env.NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS;
  if (!blockHashOracleAddr) {
    throw new Error(
      "Block hash oracle contract address not provided via NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS env var",
    );
  }

  console.log("Deploying MultiBlockHashSetterProxy...");
  const multiBlockHashSetterProxy =
    await MultiBlockHashSetterProxyFactory.deploy(blockHashOracleAddr);
  await multiBlockHashSetterProxy.waitForDeployment();
  console.log("MultiBlockHashSetterProxy deployed at:", multiBlockHashSetterProxy.target);

  // Get the TrivialBlockHashOracle contract
  const trivialBlockHashOracle = await ethers.getContractAt(
    "TrivialBlockHashOracle",
    blockHashOracleAddr,
    owner,
  );

  // Transfer ownership to the MultiBlockHashSetterProxy
  console.log("Transferring ownership of TrivialBlockHashOracle to MultiBlockHashSetterProxy...");
  const transferTx = await trivialBlockHashOracle.transferOwnership(
    multiBlockHashSetterProxy.target,
  );
  await transferTx.wait();

  console.log("Deployment and ownership transfer completed successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
