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

const envPath = path.join(__dirname, "..", "..", "frontend", ".env.local");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const privateKey = process.env.PRIVATE_KEY || "";
const targetAddr = process.env.TARGET_ADDR || "";
const auctionPolicyAddress = process.env.NEXT_PUBLIC_NFT_AUCTION_POLICY_ADDRESS || "";
const networkEnv = (process.env.NEXT_PUBLIC_NETWORK_ENV || "dev") as NetworkEnv;
const networkConfig = networkConfigs[networkEnv];
if (privateKey === "" || targetAddr === "" || auctionPolicyAddress === "") {
  throw new Error(
    "Specify PRIVATE_KEY, TARGET_ADDR, and NEXT_PUBLIC_NFT_AUCTION_POLICY_ADDRESS environment variables",
  );
}

async function main() {
  const provider = new ethers.JsonRpcProvider(networkConfig.oasis.rpcUrl);
  const firstSigner = new ethers.Wallet(privateKey, provider);

  const owner = sapphire.wrap(firstSigner);
  const nftAuctionPolicy = await ethers.getContractAt(
    "NFTAuctionPolicy",
    auctionPolicyAddress,
    owner,
  );

  const receipt = await nftAuctionPolicy.updateWhitelist([targetAddr], true).then((r) => r.wait());
  console.log("Receipt:", receipt);
}

main().then(() => process.exit(0));
