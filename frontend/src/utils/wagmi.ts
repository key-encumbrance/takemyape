import { http, createConfig } from "wagmi";
import { mainnet } from "wagmi/chains";
import { getNetworkConfig } from "./networkConfig";

// Get network configuration
const networkConfig = getNetworkConfig();

// Define your custom chain configuration for the Oasis network
const oasisChain = {
  id: networkConfig.oasis.chainId,
  name: networkConfig.oasis.name,
  network: "sapphire",
  nativeCurrency: networkConfig.oasis.currency,
  rpcUrls: {
    default: { http: [networkConfig.oasis.rpcUrl] },
    public: { http: [networkConfig.oasis.rpcUrl] },
  },
  blockExplorers: {
    default: {
      name: "Sapphire Explorer",
      url: networkConfig.oasis.rpcUrl,
    },
  },
  testnet: networkConfig.oasis.chainId !== 0x5afe, // true if not mainnet
};

// Define your custom chain configuration for the Ethereum network
const ethereumChain = {
  id: networkConfig.ethereum.chainId,
  name: networkConfig.ethereum.name,
  network: "ethereum",
  nativeCurrency: networkConfig.ethereum.currency,
  rpcUrls: {
    default: { http: [networkConfig.ethereum.rpcUrl] },
    public: { http: [networkConfig.ethereum.rpcUrl] },
  },
  blockExplorers: {
    default: {
      name: "Ethereum Explorer",
      url: networkConfig.ethereum.rpcUrl,
    },
  },
  testnet: networkConfig.ethereum.chainId !== 1, // true if not mainnet
};

// Update your wagmi configuration to use all chains
export const config = createConfig({
  chains: [mainnet, oasisChain, ethereumChain],
  transports: {
    [mainnet.id]: http("https://eth-pokt.nodies.app"),
    [oasisChain.id]: http(networkConfig.oasis.rpcUrl),
    [ethereumChain.id]: http(networkConfig.ethereum.rpcUrl),
  },
});
