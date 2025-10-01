import { useEffect, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { useAccount, useConnectorClient, useSwitchChain } from "wagmi";
import { BrowserProvider, JsonRpcSigner, Contract } from "ethers";
import SettingsStore from "@/store/SettingsStore";
import { createOrRestoreEIP155Wallet } from "@/utils/EIP155WalletUtil";
import { createWalletKit, walletkit } from "@/utils/WalletConnectUtil";
import type { Account, Chain, Client, Transport } from "viem";
import { type Config } from "wagmi";
import BasicEncumberedWallet from "@/contracts/BasicEncumberedWallet.json";
import { getContractAddress } from "@/utils/ContractConfig";
import * as sapphire from "@oasisprotocol/sapphire-paratime";

export function clientToSigner(
  client: Client<Transport, Chain, Account>,
  expectedNetwork?: { chainId: number; name: string },
) {
  const { account, chain, transport } = client;
  const network = {
    chainId: chain.id,
    name: chain.name,
    ensAddress: chain.contracts?.ensRegistry?.address,
  };
  const provider = new BrowserProvider(transport, expectedNetwork ?? network);
  return new JsonRpcSigner(provider, account.address);
}

export default function useInitialization() {
  const [initialized, setInitialized] = useState(false);
  const prevRelayerURLValue = useRef<string>("");

  const { relayerRegionURL } = useSnapshot(SettingsStore.state);
  const { isConnected } = useAccount();
  const { data: client } = useConnectorClient<Config>();
  const { switchChainAsync } = useSwitchChain();

  // Initialization effect: only sets up WalletConnect
  useEffect(() => {
    if (!isConnected || !client || initialized) return;

    async function initialize() {
      try {
        console.log("Initializing WalletConnect...");
        await createWalletKit(relayerRegionURL);
        console.log("WalletConnect initialization complete");
        setInitialized(true);
      } catch (error) {
        console.error("WalletConnect initialization failed", error);
      }
    }

    initialize();
  }, [isConnected, client, initialized, relayerRegionURL]);

  // Effect for handling relayer region changes
  useEffect(() => {
    if (!isConnected || !client) return;

    if (prevRelayerURLValue.current !== relayerRegionURL) {
      try {
        walletkit?.core?.relayer.restartTransport(relayerRegionURL);
        prevRelayerURLValue.current = relayerRegionURL;
        console.log(
          "Relayer transport restarted for region:",
          relayerRegionURL,
        );
      } catch (err) {
        console.error("Failed to restart relayer transport", err);
      }
    }
  }, [relayerRegionURL, client, isConnected]);

  // Function to retrieve a user's wallets from the contract
  const getWalletsFromContract = async (expectedNetwork?: {
    chainId: number;
    name: string;
  }) => {
    if (!client) throw new Error("Client not connected");

    const signer = clientToSigner(client, expectedNetwork);
    const wrappedSigner = sapphire.wrap(signer);

    try {
      // Load the parent wallet contract
      const parentWallet = new Contract(
        getContractAddress(),
        BasicEncumberedWallet.abi,
        wrappedSigner,
      );

      // Get the last wallet
      const wallets = [];

      const wallet = await parentWallet.getLastAttendedWallet();
      if (wallet[0] !== null) {
        wallets.push({
          address: wallet[0].toString(),
          index: wallet[1].toString(),
          contractAddress: parentWallet.target.toString(),
        });
      }

      return wallets;
    } catch (err) {
      console.error("Error getting wallets from contract:", err);
      throw err;
    }
  };

  const createEncumberedWallet = async (expectedNetwork?: {
    chainId: number;
    name: string;
  }) => {
    if (!client) {
      throw new Error("Client not connected");
    }
    console.log("Creating client", client.chain, expectedNetwork);
    const signer = clientToSigner(client, expectedNetwork);
    try {
      return createOrRestoreEIP155Wallet(signer);
    } catch (err) {
      console.error("Error creating wallet:", err);
      throw err;
    }
  };

  return {
    initialized,
    createEncumberedWallet,
    getWalletsFromContract,
    switchChainAsync,
  };
}
