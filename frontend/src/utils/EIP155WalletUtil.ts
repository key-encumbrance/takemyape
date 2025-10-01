import EIP155Lib from "@/lib/EIP155Lib";
import { getWalletAddressFromParams } from "./HelperUtil";
import { Contract, ethers } from "ethers";
import BasicEncumberedWallet from "../contracts/BasicEncumberedWallet.json";
import ApeLiquefactionWalletFactory from "../contracts/ApeLiquefactionWalletFactory.json";
import WalletConnectMessagePolicy from "../contracts/WalletConnectMessagePolicy.json";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import SettingsStore from "@/store/SettingsStore";
import {
  getContractAddress,
  getFactoryAddress,
  getMessagePolicyAddress,
} from "./ContractConfig";
import NFTAuctionPolicy from "../contracts/NFTAuctionPolicy.json";
import { getAuctionPolicyAddress } from "./ContractConfig";
import ClientStore from "@/store/ClientStore";
import { JsonRpcSigner } from "ethers";
import toast from "react-hot-toast";
import { clientToSigner } from "@/hooks/useInitialization";

export let eip155Wallets: Record<
  string,
  { index: string | number; wallet: EIP155Lib }
> = {};
export let eip155Addresses: string[] = [];

/**
 * Creates an encumbered wallet using the ApeLiquefactionWalletFactory
 */
export async function createOrRestoreEIP155Wallet(
  signer_unwrapped: JsonRpcSigner,
) {
  const signer = sapphire.wrap(signer_unwrapped);
  console.log("Signer", signer);

  // Clear any existing wallets to ensure we only have one at a time
  eip155Addresses = [];
  eip155Wallets = {};

  try {
    // Load the ApeLiquefactionWalletFactory contract
    const factory = new Contract(
      getFactoryAddress(),
      ApeLiquefactionWalletFactory.abi,
      signer,
    );

    console.log("Creating wallet via factory...");
    // Use a random index value as originally designed
    const walletIndex = Math.floor(Math.random() * 1000000);
    console.log("Using random wallet index:", walletIndex);

    // Call the factory to create a wallet
    console.log("Calling factory.createWallet with index:", walletIndex);
    try {
      let tx;
      try {
        tx = await factory.createWallet(walletIndex, { gasLimit: 1000000 });
        console.log("Transaction sent, waiting for confirmation...");
        const receipt = await tx.wait();
        console.log("Factory createWallet transaction receipt:", receipt);
      } catch {
        // Display revert message
        await factory.createWallet.staticCall(walletIndex, {
          gasLimit: 1000000,
        });
        throw new Error("Wallet creation succeeded in static call");
      }
    } catch (error: any) {
      console.error("Error creating wallet:", error);
      return;
    }

    console.log("Getting wallet info from factory...");
    try {
      // Load the parent wallet contract to get the wallet address
      const parentWallet = new Contract(
        getContractAddress(),
        BasicEncumberedWallet.abi,
        signer,
      );

      // Get the last created wallet in a single call
      const [walletAddress, index] = await parentWallet.getLastAttendedWallet();
      console.log("Found wallet address:", walletAddress);
      console.log("Found wallet index:", index);

      if (walletAddress === ethers.ZeroAddress) {
        throw new Error("No wallet found after creation");
      }

      // Load the WalletConnectMessagePolicy contract
      const messagePolicy = new Contract(
        getMessagePolicyAddress(),
        WalletConnectMessagePolicy.abi,
        signer,
      );

      // Create the wallet library instance
      const walletLib = EIP155Lib.init(
        messagePolicy,
        parentWallet,
        walletAddress,
        index.toString(),
      );

      // Add to existing wallets
      eip155Wallets[walletAddress] = {
        index: index.toString(),
        wallet: walletLib,
      };
      if (!eip155Addresses.includes(walletAddress)) {
        eip155Addresses.push(walletAddress);
      }
      SettingsStore.setEIP155Address(walletAddress);

      return {
        contract: parentWallet,
        index: index.toString(),
        address: walletAddress,
      };
    } catch (error: any) {
      console.error("Error getting wallet info:", error);
      return;
    }
  } catch (error) {
    console.error("Error creating wallet via factory:", error);
    throw error;
  }
}

/**
 * Get wallet for the address in params
 */
export const getWallet = async (params: any) => {
  try {
    console.log("Getting wallet for params:", params);

    // Get the client from ClientStore
    const client = ClientStore.getClient();
    if (!client) {
      throw new Error("Wallet client is not initialized");
    }
    const signer = clientToSigner(client);

    //let address = getWalletAddressFromParams(eip155Addresses, params);

    const basicEncumberedWallet = new Contract(
      getContractAddress(),
      BasicEncumberedWallet.abi,
      sapphire.wrap(signer),
    );
    console.log("Getting last attended wallet with", signer.address);
    const [lastWalletAddress, lastWalletIndex] =
      await basicEncumberedWallet.getLastAttendedWallet();
    console.log(
      "Queried last created wallet:",
      lastWalletAddress,
      lastWalletIndex,
    );
    let address = lastWalletAddress;

    console.log("Found address:", address);
    const messagePolicy = new Contract(
      getMessagePolicyAddress(),
      WalletConnectMessagePolicy.abi,
      sapphire.wrap(signer),
    );
    const walletLib = EIP155Lib.init(
      messagePolicy,
      basicEncumberedWallet,
      address,
      lastWalletIndex.toString(),
    );
    eip155Wallets[address] = { index: lastWalletIndex, wallet: walletLib };
    let walletEntry = eip155Wallets[address];

    if (walletEntry) {
      console.log("Found wallet entry:", walletEntry);
      return walletEntry.wallet; // return only the wallet instance
    }
  } catch (error) {
    console.error("Error getting wallet:", error);
    throw error;
  }
};

/**
 * Recreate the wallet contract instances to handle disconnects
 */
export async function refreshWalletContractInstances() {
  try {
    // Only proceed if there are wallets to refresh
    if (Object.keys(eip155Wallets).length === 0) return;

    console.log("Refreshing wallet contract instances...");

    // Get a new provider and signer
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const wrappedSigner = sapphire.wrap(signer);

    // Load the WalletConnectMessagePolicy contract with fresh signer
    const messagePolicy = new Contract(
      getMessagePolicyAddress(),
      WalletConnectMessagePolicy.abi,
      wrappedSigner,
    );

    const basicEncumberedWallet = new Contract(
      getContractAddress(),
      BasicEncumberedWallet.abi,
      sapphire.wrap(signer),
    );

    // Refresh all existing wallet instances
    for (const address in eip155Wallets) {
      const walletEntry = eip155Wallets[address];

      // Create a new instance of the wallet with the fresh contract
      const walletLib = EIP155Lib.init(
        messagePolicy,
        basicEncumberedWallet,
        address,
        walletEntry.index,
      );

      // Replace the old instance
      eip155Wallets[address].wallet = walletLib;
      console.log("Refreshed wallet instance for address:", address);
    }

    console.log("All wallet instances refreshed successfully");
  } catch (error) {
    console.error("Error refreshing wallet instances:", error);
  }
}
