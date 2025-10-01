import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import {
  type NetworkConfig,
  type AddressLikeNonPromise,
  type NetworkEnv,
  networkConfigs,
} from "../../../frontend/src/utils/networkConfig";

// Load environment variables and get network config
export function loadNetworkConfig() {
  // Load environment variables from frontend/.env.local
  const envPath = path.join(__dirname, "..", "..", "..", "frontend", ".env.local");
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  // Get network configuration based on environment
  const networkEnv = (process.env.NEXT_PUBLIC_NETWORK_ENV || "dev") as NetworkEnv;
  const networkConfig = networkConfigs[networkEnv];

  return { networkEnv, networkConfig };
}
