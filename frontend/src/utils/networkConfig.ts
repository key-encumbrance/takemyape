import { type AddressLike, type Addressable, parseEther } from "ethers";

export type NetworkEnv = "dev" | "test" | "prod";
export type AddressLikeNonPromise = string | Addressable;
export type ChainName = "oasis" | "ethereum";

const classWhitelist = [
  "0x61183Dc2B3985fA88f98a14051cF73324076B337",
  "0x837ff668ba541bA6BBd1D86041EF25242d2229bB",
  "0x3f62ee5a59F0bC867c42191833D3677d1bAF3Cd9",
  "0x993433F92Ade5c5828e0E47D2A1319E86B369535",
  "0xE695f03bc90b185527f15b4776B6583f2776eBa5",
  "0xcDf05a86871c5eaBE68cDfA84864E00a7afe678C",
  "0x0CF9774B30F4E751e5f23Bc9A512a3227Dd5e2Ca",
  "0xe7cE3FaA0c3eBecB10828dABcaaBc22f6c694887",
  "0x392853cB0B42742AE1d5D7Fcb43d25D269131822",
  "0x572Bd4a4b314cf4B9C09E039220ABeCcF57d6945",
  "0x40A0117B0C368fA0B8871c3d06bB7E6e40588578",
  "0x8628fA73c675336C4567a74d7Aa4DE4c7da92502",
  "0x414415E4579F1134f86c4C3272303E5e287Ad4D7",
  "0xDEe31045dB850B829a983e17cC7dA73BC3e5C577",
  "0xa0d7BD510EC53edF8c6eb67Fd3DAC9D77B9B451f",
  "0xA87C23Bb7CeBd6E7FEe9Bd397E8014abdf6Bfbc9",
  "0xd8463E2a21D4e6ab1b2E9BA7f152127888f4AFf8",
  "0xDEdf0b95747Bf740B8E80346d4325F542a70b4DC",
  "0x2c32E11B3AE693CCF11cB9C480456Bf716A8CE02",
  "0xdB1266f54F351371f43C42b92D9CDa5c144E27D7",
  "0x7e1A4C05b70f2BF781C9CcC49F8c69a84CC316A7",
  "0xE56fc2b8E45D04c57295c8b4b3B7C55E71Ea751E",
  "0xE5F67084401A116653133330251A888Dddc79c14",
  "0xab856Cd474819Ba453e772811F2bfb9D38915C75",
  "0x144F8B27C2684E37F38ff7434b397C316b8dC610",
  "0x8B4421d3dcEaaC94B4e3F7E6EA93Ce3afDab92fF",
  "0x8cc9fD5cB4519F3A5FE61342E3f534B88E1365F9",
  "0xD3EaD943A80EF168226Aa2703501d94F56A56076",
  "0xa5FEB69fE1ca8F53eb2382c19734338E8B0c90Dc",
  "0x17aC346b52455aa674795bf0BF25843CD08C7953",
  "0xb4285A3B1844f57ff350ED1c782F8712FB2Aae59",
  "0x810DF951F4fBfd96C7FdeA44d9625f8Cb604c3e5",
  "0xfAcDF22413C7F0A700a616EdE66d5207CEA26c7f",
  "0x427c40758E8133Ab61cB20cDc149C547A76c7D67",
  "0x5BccD45E039890E5aeb4Ce1324889E47D8Ace847",
  "0x6995c2F2ed74fe73780b769723182319dA7772E9",
  "0xED60eE60b1cf489E1a03E4D8B3193616aE26bE48",
  "0x9163856becAD0EaE1756338d71aBaD5F1548769c",
  "0x22bD0A96C264EE4DD71D365f5BF12Fa8fe9E6D37",
  "0xA82e798Ff0284C18b29E34be19AF0B6a15468B46",
  "0x4b42B957334cFe2d79d3F8867F0076f354B604b3",
  "0x6Bd5Ba86FaE11BC413a2Ffe276ba9832F5986D14",
  "0xD18c8700DE17daCE179A08f00D0A733f3d58B59F",
  "0x16c6ef9BE177fDAF3c8DB1EE3a3B047dF3e1512a",
  "0xa7B6e763A7c95256d6f831529A2feCb5A62CE08d",
  "0xdad0b0b9309F4Ca29fB5e0405aAc9c6acdADC170",
];

export type NetworkConfig = {
  ethereum: {
    chainId: number;
    rpcUrl: string;
    name: string;
    currency: {
      name: string;
      symbol: string;
      decimals: number;
    };
  };
  oasis: {
    chainId: number;
    rpcUrl: string;
    name: string;
    currency: {
      name: string;
      symbol: string;
      decimals: number;
    };
  };
  whitelist?: AddressLikeNonPromise[];
  whitelistEnabled?: boolean;
  nftContractAddress?: AddressLikeNonPromise;
  nftTokenId?: bigint;
  minEthBalance: bigint;
  minOasisBalance: bigint;

  totalEncumbranceTime: bigint;
  minOwnershipTime: bigint;
  minEncumbranceTimeRemainingToBid: bigint;
  amtToBlockHashUpdater?: bigint;
};

export const networkConfigs: Record<NetworkEnv, NetworkConfig> = {
  dev: {
    ethereum: {
      chainId: 30121,
      rpcUrl: "http://127.0.0.1:32002",
      name: "Local Ethereum",
      currency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18,
      },
    },
    oasis: {
      chainId: 0x5afd,
      rpcUrl: "http://127.0.0.1:8545",
      name: "Sapphire Dev",
      currency: {
        name: "Sapphire Ether",
        symbol: "SAPPH",
        decimals: 18,
      },
    },
    whitelist: ["0x70997970C51812dc3A010C7d01b50e0d17dc79C8"],
    minEthBalance: parseEther("0.01"),
    minOasisBalance: parseEther("0.5"),
    minOwnershipTime: 60n,
    minEncumbranceTimeRemainingToBid: 60n * 60n * 24n * 14n,
    totalEncumbranceTime: 60n * 60n * 24n * 28n,
  },
  test: {
    ethereum: {
      chainId: 17000, // Holesky
      rpcUrl: "https://rpc-holesky.rockx.com",
      name: "Holesky Testnet",
      currency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18,
      },
    },
    oasis: {
      chainId: 0x5aff,
      rpcUrl: "https://testnet.sapphire.oasis.dev",
      name: "Sapphire Testnet",
      currency: {
        name: "Sapphire Ether",
        symbol: "SAPPH",
        decimals: 18,
      },
    },
    nftContractAddress: "0xd4eDAEFDb5915B05D5C1340221EcF3301F000479",
    nftTokenId: 11n,
    minEthBalance: parseEther("0.0004"),
    minOasisBalance: parseEther("0.1"),
    minOwnershipTime: 60n * 3n,
    minEncumbranceTimeRemainingToBid: 60n * 10n,
    totalEncumbranceTime: 60n * 20n,
    amtToBlockHashUpdater: parseEther("10"),
  },
  prod: {
    ethereum: {
      chainId: 1,
      rpcUrl: "https://eth-pokt.nodies.app",
      name: "Ethereum Mainnet",
      currency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18,
      },
    },
    oasis: {
      chainId: 0x5afe,
      rpcUrl: "https://sapphire.oasis.io",
      name: "Oasis Sapphire",
      currency: {
        name: "Sapphire Ether",
        symbol: "ROSE",
        decimals: 18,
      },
    },
    whitelist: classWhitelist,
    whitelistEnabled: false,

    // BAYC
    nftContractAddress: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
    nftTokenId: 8180n,

    minEthBalance: parseEther("0.0004"),
    minOasisBalance: parseEther("0.1"),
    minOwnershipTime: 60n * 15n,
    minEncumbranceTimeRemainingToBid: 60n * 60n * 24n * 14n,
    totalEncumbranceTime: 60n * 60n * 24n * 28n,
    amtToBlockHashUpdater: parseEther("30"),
  },
};

export function getNetworkConfig(): NetworkConfig {
  const env = (process.env.NEXT_PUBLIC_NETWORK_ENV || "dev") as NetworkEnv;
  return networkConfigs[env];
}

// Helper function to get chain configuration for MetaMask
export function getChainConfig(chain: ChainName) {
  const config = getNetworkConfig();
  const network = config[chain];

  return {
    chainId: network.chainId,
    chainName: network.name,
    nativeCurrency: network.currency,
    rpcUrls: [network.rpcUrl],
  };
}
