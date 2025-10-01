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

const auctionPolicyAddress = process.env.NEXT_PUBLIC_NFT_AUCTION_POLICY_ADDRESS || "";
const networkEnv = (process.env.NEXT_PUBLIC_NETWORK_ENV || "dev") as NetworkEnv;
const networkConfig = networkConfigs[networkEnv];
if (auctionPolicyAddress === "") {
  throw new Error("Specify NEXT_PUBLIC_NFT_AUCTION_POLICY_ADDRESS environment variable");
}

async function main() {
  const provider = new ethers.JsonRpcProvider(networkConfig.oasis.rpcUrl);
  const nftAuctionPolicy = await ethers.getContractAt(
    "NFTAuctionPolicy",
    auctionPolicyAddress,
    new ethers.VoidSigner(ethers.ZeroAddress).connect(provider),
  );

  const currentOwner = await nftAuctionPolicy.currentOwner();
  console.log("Current owner:", currentOwner);

  const previousProvenOwner = await nftAuctionPolicy.previousOwner();
  console.log("Previous proven owner:", previousProvenOwner);
}

main().then(() => process.exit(0));
