import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { JsonRpcProvider, Transaction, Wallet, ethers } from "ethers";
import { loadNetworkConfig } from "./utils/networkEnv";

const { networkConfig } = loadNetworkConfig();
const privateKey = process.env.PRIVATE_KEY || "";
if (privateKey === "") {
  throw new Error("Specify PRIVATE_KEY environment variable");
}

async function main() {
  const provider = new ethers.JsonRpcProvider(networkConfig.oasis.rpcUrl, {
    chainId: networkConfig.oasis.chainId,
    name: networkConfig.oasis.name,
  });
  let wallet = new ethers.Wallet(privateKey, provider);
  // wallet = sapphire.wrap(wallet);
  console.log("Wallet address:", wallet.address);
  const value = ethers.parseEther("20");
  console.log("Value:", value);

  const txResponse = await wallet.sendTransaction({
    data: "0x",
    value,
    to: "0x289B7243138F376D8898F53Aedb63d943c382D02",
  });
  console.log(`${ethers.formatEther(value)} ROSE sent to ${txResponse.to}`);
}

main().then(() => process.exit(0));
