import Head from "next/head";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import useInitialization from "@/hooks/useInitialization";
import useWalletConnectEventsManager from "@/hooks/useWalletConnectEventsManager";
import { walletkit } from "@/utils/WalletConnectUtil";
import { RELAYER_EVENTS } from "@walletconnect/core";
import { styledToast } from "@/utils/HelperUtil";
import WalletConnectButton from "./walletconnect";
import { useAccount, useConnectorClient } from "wagmi";
import { switchNetwork } from "wagmi/actions";
import Link from "next/link";
import Image from "next/image";
import ClientOnly from "../components/ClientOnly";
import { Contract, ethers } from "ethers";
import NFTAuctionPolicy from "../contracts/NFTAuctionPolicy.json";
import ConstrainedTransactionPolicy from "../contracts/ConstrainedTransactionPolicy.json";
import BlockHashOracle from "../contracts/TrivialBlockHashOracle.json";
import { clientToSigner } from "@/hooks/useInitialization";
import { type Config } from "wagmi";
import {
  getAuctionPolicyAddress,
  getTxPolicyAddress,
  getBlockHashOracleAddress,
  getOwnerControlsAddress,
} from "@/utils/ContractConfig";
import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { derToEthSignature } from "@/utils/ethereum-signatures";
import { JsonRpcProvider, JsonRpcApiProvider, Transaction } from "ethers";
import { getRlpUint, getTxInclusionProof } from "@/utils/inclusion-proofs";
import { Interface } from "ethers";
import NFTOwnerControls from "../contracts/NFTOwnerControls.json";
import ClientStore from "@/store/ClientStore";
import { toast } from "react-hot-toast";
import {
  getNetworkConfig,
  getChainConfig,
  type ChainName,
} from "@/utils/networkConfig";

// Number of blocks back to search for transfer logs
const MAX_LOGS_SEARCH_BLOCK_COUNT = 99_900;

function throwIfEmpty<T>(val: T | undefined | null, valStr: string): T {
  if (val === undefined || val === null) {
    throw new Error("Expected value to be non-empty: " + valStr);
  }
  return val;
}

function extractGasPriceFromCurrentUrl(): bigint | null {
  // Get the search parameters from the current URL
  const searchParams = new URLSearchParams(window.location.search);

  // Check if the 'gasPrice' parameter exists
  if (searchParams.has("gasPrice")) {
    // Get the value of the 'gasPrice' parameter
    const gasPrice = searchParams.get("gasPrice");

    if (gasPrice === null) {
      return null;
    }

    // Return the value as a string
    try {
      return ethers.parseUnits(gasPrice, "gwei");
    } catch (e) {
      console.log("Failed to parse gas price:", gasPrice);
    }
    return null;
  }

  // Return null if the parameter does not exist
  return null;
}

async function getTxInclusion(gethProvider: any, txHash: string) {
  const signedWithdrawalTx = await gethProvider.getTransaction(txHash);
  if (signedWithdrawalTx === null) {
    throw new Error("Withdrawal transaction is null");
  }
  // if (signedWithdrawalTx.type !== 2) {
  //   throw new Error("Unsupported transaction type (must be 2 for getTxInclusion)");
  // }
  const txReceipt = await gethProvider.getTransactionReceipt(txHash);
  if (txReceipt === null) {
    throw new Error("Withdrawal transaction receipt is null");
  }
  const { proof, rlpBlockHeader } = await getTxInclusionProof(
    gethProvider as any,
    txReceipt.blockNumber,
    txReceipt.index,
  );

  // Get proof
  // This can be gathered from the transaction data of the included transaction
  const signedTxFormatted = {
    transaction: {
      chainId: signedWithdrawalTx.chainId,
      nonce: signedWithdrawalTx.nonce,
      maxPriorityFeePerGas: throwIfEmpty(
        signedWithdrawalTx.maxPriorityFeePerGas,
        "maxPriorityFeePerGas",
      ),
      maxFeePerGas: throwIfEmpty(
        signedWithdrawalTx.maxFeePerGas,
        "maxFeePerGas",
      ),
      gasLimit: signedWithdrawalTx.gasLimit,
      destination: throwIfEmpty(signedWithdrawalTx.to, "to"),
      amount: signedWithdrawalTx.value,
      payload: signedWithdrawalTx.data,
    },
    r: signedWithdrawalTx.signature.r,
    s: signedWithdrawalTx.signature.s,
    v: signedWithdrawalTx.signature.v,
  };

  return {
    signedTxFormatted,
    inclusionProof: {
      rlpBlockHeader,
      transactionIndexRlp: getRlpUint(txReceipt.index),
      transactionProofStack: ethers.encodeRlp(
        proof.map((rlpList) => ethers.decodeRlp(rlpList)),
      ),
    },
    proofBlockNumber: txReceipt.blockNumber,
  };
}

// Helper function to convert Type2TxMessage to ethers Transaction
function convertTxMessageToTransaction(txMessage: any): ethers.Transaction {
  const transaction = {
    chainId: txMessage.chainId,
    nonce: Number(txMessage.nonce),
    maxPriorityFeePerGas: txMessage.maxPriorityFeePerGas,
    maxFeePerGas: txMessage.maxFeePerGas,
    gasLimit: txMessage.gasLimit,
    to: ethers.getAddress(ethers.dataSlice(txMessage.destination, 0, 20)), // Convert bytes to address
    value: txMessage.amount,
    data: txMessage.payload,
    type: 2,
  };

  return ethers.Transaction.from(transaction);
}

interface WalletInfo {
  address: string;
  index: string | number;
  contractAddress: string;
}

const copyToClipboard = (text: string, label: string) => {
  navigator.clipboard
    .writeText(text)
    .then(() => {
      toast.success(`${label} copied to clipboard!`);
    })
    .catch(() => {
      toast.error("Failed to copy to clipboard");
    });
};

export default function Home() {
  const { isConnected } = useAccount();
  const {
    initialized,
    createEncumberedWallet,
    getWalletsFromContract,
    switchChainAsync,
  } = useInitialization();
  const [isCreating, setIsCreating] = useState(false);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [loadedFromStorage, setLoadedFromStorage] = useState(false);
  const [currentYear] = useState(() => new Date().getFullYear());
  const [isBlurred, setIsBlurred] = useState(false);
  const [showWalletConfirmation, setShowWalletConfirmation] = useState(false);

  // Auction state
  const [bidAmount, setBidAmount] = useState("");
  const [isSubmittingBid, setIsSubmittingBid] = useState(false);
  const [isFinalizingAuction, setIsFinalizingAuction] = useState(false);
  const [auctionEndTime, setAuctionEndTime] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState("");
  const [isAuctionEnded, setIsAuctionEnded] = useState(false);
  const [isWinner, setIsWinner] = useState(false);
  const [highestBid, setHighestBid] = useState("");
  const [highestBidder, setHighestBidder] = useState("");
  const [nftContractAddress, setNftContractAddress] = useState("");
  const [currentNftOwner, setCurrentNftOwner] = useState("");
  const [isUpdatingBlur, setIsUpdatingBlur] = useState(false);

  // Wallet funding state
  const [fundAmount, setFundAmount] = useState("");
  const [isFundingWallet, setIsFundingWallet] = useState(false);
  const [fundingStep, setFundingStep] = useState("");
  const [walletBalance, setWalletBalance] = useState<{
    eth: string;
    local: string;
  } | null>(null);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);

  const { data: client } = useConnectorClient<Config>();
  const { address: connectedAddress } = useAccount();

  const [isProcessingTransfer, setIsProcessingTransfer] = useState(false);
  const [transferStep, setTransferStep] = useState("");
  const [targetChainId, setTargetChainId] = useState<number | null>(null);
  const [publicProvider, setPublicProvider] =
    useState<ethers.JsonRpcProvider | null>(null);
  const [previousOwner, setPreviousOwner] = useState("");
  const [nftId, setNftId] = useState<number | null>(null);
  const [isProving, setIsProving] = useState(false);
  const [transferLogs, setTransferLogs] = useState<any[]>([]);
  const [hasCompletedTransfer, setHasCompletedTransfer] = useState(false);
  const [hasVerifiedNftOwnership, setHasVerifiedNftOwnership] = useState(false);

  // Add cache state
  const [auctionDataCache, setAuctionDataCache] = useState<{
    nextAuctionEnd: number | null;
    nftContract: string | null;
    currentOwner: string | null;
    isBlurred: boolean | null;
    lastUpdated: number | null;
  }>({
    nextAuctionEnd: null,
    nftContract: null,
    currentOwner: null,
    isBlurred: null,
    lastUpdated: null,
  });

  // 1. Add a state to track if the user has already bid in the current auction
  const [hasBidThisAuction, setHasBidThisAuction] = useState(false);

  // Add state for the fetch wallet warning
  const [showNoWalletWarning, setShowNoWalletWarning] = useState(false);

  // Load wallets from API only on initial component mount - no unnecessary polling
  useEffect(() => {
    console.log("loading wallets");
    async function loadWallets() {
      if (!connectedAddress) {
        setWallets([]);
        setLoadedFromStorage(true);
        return;
      }

      try {
        // Try to get wallets from local storage via API
        const response = await fetch(
          `/api/wallets?address=${connectedAddress}`,
        );
        let storedWallets: WalletInfo[] = [];

        if (response.ok) {
          storedWallets = await response.json();
          setWallets(storedWallets);
        }
      } catch (error) {
        console.error("Failed to load wallets:", error);
      }

      setLoadedFromStorage(true);
    }

    loadWallets();
  }, [connectedAddress]); // Only run when connected address changes

  // Save wallets to API whenever they change
  useEffect(() => {
    console.log("saving wallets");
    if (!loadedFromStorage || !connectedAddress || wallets.length === 0) return;

    const newWallet = wallets[wallets.length - 1]; // Get the single wallet

    // First delete any existing wallets
    fetch(`/api/wallets?address=${connectedAddress}`, {
      method: "DELETE",
    })
      .then(() => {
        // Then save the new wallet
        return fetch(`/api/wallets?address=${connectedAddress}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(newWallet),
        });
      })
      .catch((error) => {
        console.error("Failed to update wallet:", error);
      });
  }, [wallets, loadedFromStorage, connectedAddress]);

  // Set up wallet connect event manager
  useWalletConnectEventsManager(initialized);

  useEffect(() => {
    console.log("setting up wallet connect events");
    if (!initialized) return;
    walletkit?.core.relayer.on(RELAYER_EVENTS.connect, () => {
      styledToast("Network connection is restored!", "success");
    });

    walletkit?.core.relayer.on(RELAYER_EVENTS.disconnect, () => {
      styledToast("Network connection lost.", "error");
    });
  }, [initialized]);

  // Fetch auction data on page load
  useEffect(() => {
    if (initialized && client) {
      fetchAuctionData();
    }
  }, [initialized, client]);

  useEffect(() => {
    fetchPublicData();
  }, []);

  // Fetch NFT transfers when provider is ready
  useEffect(() => {
    // If we have both the NFT contract address and a valid provider, fetch the transfer logs
    if (nftContractAddress && publicProvider && !transferLogs.length) {
      findLastNFTTransfer();
    }
  }, [nftContractAddress, publicProvider, wallets]);

  const fetchPublicData = async (): Promise<{
    currentOwner: string;
    nextAuctionEndTime: number;
  }> => {
    try {
      // Check if we have cached data that's less than 5 seconds old
      if (
        auctionDataCache &&
        auctionDataCache.lastUpdated &&
        Date.now() - auctionDataCache.lastUpdated < 5000
      ) {
        setAuctionDataCache(auctionDataCache);
        return {
          currentOwner: auctionDataCache.currentOwner ?? "",
          nextAuctionEndTime: auctionDataCache.nextAuctionEnd ?? 0,
        };
      }

      const nonConnectedOasisProvider = new ethers.JsonRpcProvider(
        getNetworkConfig().oasis.rpcUrl,
        getNetworkConfig().oasis.chainId,
      );

      // Get the auction contract
      const auctionContract = new ethers.Contract(
        getAuctionPolicyAddress(),
        NFTAuctionPolicy.abi,
        nonConnectedOasisProvider,
      );

      // Get the owner controls contract
      const ownerControlsContract = new ethers.Contract(
        getOwnerControlsAddress(),
        NFTOwnerControls.abi,
        nonConnectedOasisProvider,
      );

      // Batch all view calls together
      const [nextAuctionEndTime, nftContract, currentOwner, blurState] =
        await Promise.all([
          auctionContract.nextAuctionEnd(),
          auctionContract.nftContract(),
          auctionContract.currentOwner(),
          ownerControlsContract.getImageBlurred(),
        ]);

      // Update state with fetched data
      const newAuctionData = {
        nextAuctionEnd: nextAuctionEndTime,
        nftContract,
        currentOwner,
        isBlurred: blurState,
        lastUpdated: Date.now(),
      };

      setAuctionDataCache(newAuctionData);
      setAuctionEndTime(Number(nextAuctionEndTime) * 1000);
      setNftContractAddress(nftContract);
      setCurrentNftOwner(currentOwner);
      setIsBlurred(blurState);

      return { currentOwner, nextAuctionEndTime };
    } catch (error) {
      console.error("Failed to fetch public data:", error);
      return { currentOwner: "", nextAuctionEndTime: 0 };
    }
  };

  // Function to fetch auction data from the contract
  const fetchAuctionData = async () => {
    try {
      const { currentOwner, nextAuctionEndTime } = await fetchPublicData();

      // Need a connected client for the rest
      if (!initialized || !client) return;

      // Provider that has access to accounts
      const provider = new ethers.BrowserProvider(
        client.transport,
        getNetworkConfig().oasis.chainId,
      );

      // Check if the current user is the owner by comparing both the connected address and encumbered wallet
      const accounts = await provider.listAccounts();
      const userAddress = accounts[0].address;
      const isDirectOwner =
        userAddress.toLowerCase() === currentOwner.toLowerCase();
      const isEncumberedOwner =
        wallets.length > 0 &&
        currentOwner.toLowerCase() ===
          wallets[wallets.length - 1].address.toLowerCase();

      // Only set isWinner, but don't automatically set hasCompletedTransfer
      // Ownership verification will be done separately with the NFT transfer logs
      setIsWinner(isDirectOwner || isEncumberedOwner);

      // Set isAuctionEnded based on current time
      const now = Date.now();
      const auctionEndTimeMs = Number(nextAuctionEndTime) * 1000;
      console.log("auctionEndTimeMs", auctionEndTimeMs);
      console.log("now", now);
      setIsAuctionEnded(now >= auctionEndTimeMs);
    } catch (error) {
      console.error("Error fetching auction data:", error);
    }
  };

  // Function to update the blur state in the contract
  const updateBlurState = async (blurState: boolean) => {
    if (!client || !isWinner) return;
    try {
      setIsUpdatingBlur(true);
      // Blur the NFT
      const setImageBlurredInterface = new ethers.Interface([
        "function setImageBlurred(bool _isBlurred)",
      ]);
      const encodedBlurData = setImageBlurredInterface.encodeFunctionData(
        "setImageBlurred",
        [blurState],
      );
      console.log(encodedBlurData);
      console.log("Sending blur request...");

      const auctionPolicy = new ethers.Contract(
        getAuctionPolicyAddress(),
        NFTAuctionPolicy.abi,
        sapphire.wrap(clientToSigner(client)),
      );

      const nftOwnerControls = new ethers.Contract(
        getOwnerControlsAddress(),
        NFTOwnerControls.abi,
        sapphire.wrap(clientToSigner(client)),
      );

      await auctionPolicy
        .sendCurrentOwnerMessage(nftOwnerControls.target, encodedBlurData)
        .then((r) => r.wait());

      setIsBlurred(blurState);
      styledToast(
        `Image visibility ${blurState ? "hidden" : "shown"} to all users`,
        "success",
      );
    } catch (error) {
      console.error("Failed to update blur state:", error);
      styledToast("Failed to update image visibility", "error");
    } finally {
      setIsUpdatingBlur(false);
    }
  };

  // Update auction time remaining
  useEffect(() => {
    console.log("updating auction time remaining");
    if (!auctionEndTime) return;

    const updateTimeRemaining = () => {
      const now = Date.now();
      const diff = auctionEndTime - now;

      if (diff <= 0) {
        setTimeRemaining("Auction ended");
        setIsAuctionEnded(true);
        return;
      }

      // Calculate time remaining
      const minutes = Math.floor(diff / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeRemaining(`${minutes}m ${seconds}s`);
      setIsAuctionEnded(false);
    };

    // Update immediately and then set interval
    updateTimeRemaining();
    const interval = setInterval(updateTimeRemaining, 1000);

    return () => clearInterval(interval);
  }, [auctionEndTime]);

  // Function to manually fetch wallet data from contract
  const handleFetchWallet = async () => {
    console.log("fetching wallet");
    if (!initialized || !client || !connectedAddress) return;
    try {
      await switchProvider("oasis");
      const onChainWallets = await getWalletsFromContract({
        ...getNetworkConfig().oasis,
      });
      console.log("onChainWallets", onChainWallets);
      if (
        onChainWallets.length > 0 &&
        onChainWallets[0].address !==
          "0x0000000000000000000000000000000000000000"
      ) {
        setWallets(onChainWallets);
        styledToast("Retrieved wallet from blockchain", "success");
      } else {
        setShowNoWalletWarning(true);
        setTimeout(() => setShowNoWalletWarning(false), 3000);
      }
    } catch (error) {
      console.error("Error fetching wallet from chain:", error);
      styledToast("Failed to fetch wallet", "error");
    }
  };

  const handleCreateWallet = async () => {
    // If there's already a wallet, show confirmation dialog
    if (wallets.length > 0) {
      setShowWalletConfirmation(true);
      return;
    }

    // Otherwise proceed with wallet creation
    await createWallet();
  };

  const createWallet = async () => {
    setIsCreating(true);
    setShowWalletConfirmation(false);

    try {
      // Switch to Oasis
      console.log("Switching to Oasis...");
      await switchProvider("oasis");
      console.log("Creating wallet...");
      const result = await createEncumberedWallet({
        ...getNetworkConfig().oasis,
      });
      if (result) {
        const newWallet = {
          address: result.address,
          index: result.index,
          contractAddress: result.contract.target.toString(),
        };
        setWallets([newWallet]);
        styledToast("Wallet created successfully!", "success");
      }
    } catch (error) {
      console.error("Failed to create wallet:", error);
      styledToast("Failed to create wallet", "error");
    } finally {
      setIsCreating(false);
    }
  };

  // 2. Update handleSubmitBid to set hasBidThisAuction to true after a successful bid
  const handleSubmitBid = async () => {
    if (
      !client ||
      !bidAmount ||
      wallets.length === 0 ||
      !walletBalance ||
      Number(walletBalance.eth) === 0 ||
      hasBidThisAuction
    )
      return;
    setIsSubmittingBid(true);
    try {
      const auctionContractAddress = getAuctionPolicyAddress();
      const signer = sapphire.wrap(clientToSigner(client));
      const auctionContract = new Contract(
        auctionContractAddress,
        NFTAuctionPolicy.abi,
        signer,
      );
      const existingBidBalance = await auctionContract.getBidBalance(
        wallets[wallets.length - 1].address,
      );
      const bidAmountWei = ethers.parseEther(bidAmount);
      const valueToSend =
        bidAmountWei < existingBidBalance
          ? 0n
          : bidAmountWei - existingBidBalance;
      let tx;
      try {
        tx = await auctionContract.placeBid(
          wallets[wallets.length - 1].address,
          bidAmountWei,
          { value: valueToSend },
        );
      } catch (e) {
        await auctionContract.placeBid.staticCall(
          wallets[wallets.length - 1].address,
          bidAmountWei,
          { value: valueToSend },
        );
        throw e;
      }
      styledToast("Bid submitted, waiting for confirmation...", "info");
      await tx.wait();
      styledToast("Bid submitted successfully!", "success");
      setHasBidThisAuction(true); // Mark as bid for this auction
      await fetchAuctionData();
      setBidAmount("");
    } catch (err: any) {
      console.error("Failed to submit bid:", err);
      if (err.code === 4001 || err.code === "ACTION_REJECTED") {
        styledToast("Bid cancelled", "info");
      } else {
        styledToast("Failed to submit bid", "error");
      }
    } finally {
      setIsSubmittingBid(false);
    }
  };

  // 3. Reset hasBidThisAuction when a new auction starts (auctionEndTime changes)
  useEffect(() => {
    setHasBidThisAuction(false);
  }, [auctionEndTime]);

  // Handle blur toggle with contract integration
  const handleBlurToggle = async () => {
    await updateBlurState(!isBlurred);
  };

  // Check if current connected address is the current NFT owner
  // This checks both the directly connected address or if the user's encumbered wallet is the owner
  const isCurrentOwner =
    currentNftOwner &&
    ((connectedAddress &&
      currentNftOwner.toLowerCase() === connectedAddress.toLowerCase()) ||
      (wallets.length > 0 &&
        currentNftOwner.toLowerCase() ===
          wallets[wallets.length - 1].address.toLowerCase()));

  // Set up Ethereum public provider for NFT chain
  useEffect(() => {
    console.log("setting up provider");

    async function setUpProvider() {
      try {
        const auctionContractAddress = getAuctionPolicyAddress();
        const networkConfig = getNetworkConfig();
        const provider = new ethers.JsonRpcProvider(
          networkConfig.oasis.rpcUrl,
          {
            chainId: networkConfig.oasis.chainId,
            name: networkConfig.oasis.name,
          },
        );

        const auctionContract = new Contract(
          auctionContractAddress,
          NFTAuctionPolicy.abi,
          provider,
        );

        // Get the NFT chain ID
        const nftChainId = await auctionContract.nftChainId();
        console.log("NFT Chain ID:", nftChainId);
        setTargetChainId(Number(nftChainId));

        // Create a provider for the NFT chain using the network config
        const publicProvider = new ethers.JsonRpcProvider(
          networkConfig.ethereum.rpcUrl,
          {
            chainId: networkConfig.ethereum.chainId,
            name: networkConfig.ethereum.name,
          },
        );
        setPublicProvider(publicProvider);
        console.log("Public provider set up");
      } catch (error) {
        console.error("Failed to set up providers:", error);
      }
    }

    setUpProvider();
  }, []);

  // Function to sign and broadcast NFT transfer transaction
  const handleTransferNFT = async () => {
    if (!client) {
      throw new Error("Client is not defined");
    } else if (!publicProvider) {
      throw new Error("Public provider not accessible");
    } else if (wallets.length === 0) {
      throw new Error("Wallets length is 0");
    }
    try {
      setIsProcessingTransfer(true);
      setTransferStep("Proving previous transfer...");
      const networkConfig = getNetworkConfig();

      // 1. Get the last transfer log (highest block number)
      let lastTransferLog = null;
      if (nftContractAddress) {
        const latestBlock = await publicProvider.getBlockNumber();
        const filter = {
          address: nftContractAddress,
          topics: [
            "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // Transfer(address,address,uint256)
            null,
            null,
            networkConfig.nftTokenId
              ? ethers.zeroPadValue(
                  ethers.toBeHex(networkConfig.nftTokenId),
                  32,
                )
              : nftId
                ? ethers.zeroPadValue(ethers.toBeHex(nftId), 32)
                : null,
          ],
        };
        if (!filter.topics[3]) filter.topics.pop();
        const logs = await publicProvider.getLogs({
          ...filter,
          fromBlock: Math.max(latestBlock - MAX_LOGS_SEARCH_BLOCK_COUNT, 0),
          toBlock: "latest",
        });
        const transferLogs = logs.map((log) => ({
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          from: log.topics[1]
            ? ethers.getAddress("0x" + log.topics[1].substring(26))
            : "unknown",
          to: log.topics[2]
            ? ethers.getAddress("0x" + log.topics[2].substring(26))
            : "unknown",
          tokenId: log.topics[3] ? parseInt(log.topics[3], 16) : "unknown",
        }));
        transferLogs.sort((a, b) => b.blockNumber - a.blockNumber);
        if (transferLogs.length > 0) {
          lastTransferLog = transferLogs[0];
        }
      }
      console.log("lastTransferLog", lastTransferLog);

      // 2. Prove previous transfer if possible (logic from proveSelectedTransfer)
      const unwrappedSigner = clientToSigner(client);
      const auctionContractUnwrapped = new Contract(
        getAuctionPolicyAddress(),
        NFTAuctionPolicy.abi,
        unwrappedSigner,
      );
      const lastProvenOwner = await auctionContractUnwrapped.previousOwner();
      if (lastTransferLog && lastProvenOwner === lastTransferLog.to) {
        console.log(
          "Current owner's transaction was already proven:",
          lastTransferLog.to,
          lastTransferLog.transactionHash,
        );
      }

      if (lastTransferLog && lastProvenOwner !== lastTransferLog.to) {
        try {
          setTransferStep("Proving previous transfer...");
          const auctionContractAddress = getAuctionPolicyAddress();
          const signer = sapphire.wrap(clientToSigner(client));
          const auctionContract = new Contract(
            auctionContractAddress,
            NFTAuctionPolicy.abi,
            signer,
          );

          // Get transaction details
          const tx = await publicProvider.getTransaction(
            lastTransferLog.transactionHash,
          );
          if (!tx) {
            throw new Error("Could not retrieve transaction");
          }
          // Get transaction inclusion proof
          const { signedTxFormatted, inclusionProof, proofBlockNumber } =
            await getTxInclusion(
              publicProvider,
              lastTransferLog.transactionHash,
            );
          // Prove transaction inclusion
          const txPolicy = new Contract(
            getTxPolicyAddress(),
            ConstrainedTransactionPolicy.abi,
            signer,
          );
          try {
            const txPolicyReceipt = await txPolicy.proveTransactionInclusion(
              signedTxFormatted,
              inclusionProof,
              proofBlockNumber,
            );
            await txPolicyReceipt.wait();
          } catch (error) {
            console.error("Error proving transaction inclusion:", error);
            /*
            await txPolicy.proveTransactionInclusion.staticCall(
              signedTxFormatted,
              inclusionProof,
              proofBlockNumber
            );
            */
          }
          // Prove previous transfer
          setTransferStep("Submitting proof to contract...");
          try {
            await auctionContract
              .provePreviousTransfer(
                signedTxFormatted,
                tx.nonce, //0, // This might need adjustment based on contract requirements
                lastTransferLog.to,
                tx.nonce,
                tx.maxFeePerGas || 0,
              )
              .then((r) => r.wait());
          } catch (err) {
            await (
              auctionContract.connect(clientToSigner(client)) as any
            ).provePreviousTransfer
              .staticCall(
                signedTxFormatted,
                tx.nonce, //0, // This might need adjustment based on contract requirements
                lastTransferLog.to,
                tx.nonce,
                tx.maxFeePerGas || 0,
              )
              .then((r: any) => r.wait());
          }
        } catch (err) {
          // If already proven or fails, continue
          console.warn(
            "Prove transfer step failed or already proven, continuing",
            err,
          );
        }
      }

      // Continue with the rest of the transfer logic
      setTransferStep("Preparing NFT transfer...");
      const signer = clientToSigner(client);
      const auctionContractAddress = getAuctionPolicyAddress();
      const auctionContract = new Contract(
        auctionContractAddress,
        NFTAuctionPolicy.abi,
        signer,
      );
      // 1. Get the previous and current owners
      const prevOwner = await auctionContract.previousOwner();
      console.log("prevOwner", prevOwner);
      const currentOwner = wallets[wallets.length - 1].address;
      console.log("Current owner:", currentOwner);
      // 3. Get the nonce for the transaction
      const nonce = await publicProvider.getTransactionCount(prevOwner);
      console.log("Nonce of previous owner:", nonce);
      // 4. Get the gas price estimate
      //const feeData = await publicProvider.getFeeData();
      // 5. Get NFT transfer transaction message
      setTransferStep("Getting NFT transfer transaction...");
      console.log("Getting NFT transfer transaction...");
      const txMessage = await auctionContract.getNFTTransferTransaction(
        extractGasPriceFromCurrentUrl() ?? ethers.parseUnits("2", "gwei"),
        currentOwner,
        nonce,
      );
      // 6. Sign the NFT transfer transaction
      setTransferStep("Signing NFT transfer transaction...");
      console.log("Signing NFT transfer transaction...");
      const auctionContractSapphire = new Contract(
        auctionContractAddress,
        NFTAuctionPolicy.abi,
        sapphire.wrap(signer),
      );
      const signature =
        await auctionContractSapphire.signNFTTransferTransaction(
          extractGasPriceFromCurrentUrl() ?? ethers.parseUnits("2", "gwei"),
        );
      // 7. Convert transaction message to ethers Transaction
      const tx = convertTxMessageToTransaction(txMessage);
      const ethSig = derToEthSignature(
        signature,
        tx.unsignedSerialized,
        prevOwner,
        "bytes",
      );
      if (!ethSig) {
        throw new Error("Could not create valid signature for NFT transfer");
      }
      tx.signature = ethSig;
      // 8. Broadcast the transaction to the Ethereum chain
      setTransferStep("Broadcasting transaction to Ethereum...");
      const txResponse = await publicProvider.broadcastTransaction(
        tx.serialized,
      );
      styledToast(
        "Transaction broadcasted, waiting for confirmation...",
        "info",
      );
      // 9. Wait for the transaction to be confirmed
      const txReceipt = await txResponse.wait();
      const txHash = txReceipt?.hash;
      if (!txHash || !txReceipt) {
        throw new Error("Could not get hash from transaction");
      }
      styledToast("NFT transfer transaction confirmed!", "success");
      // Verify ownership in the transfer logs
      setTimeout(async () => {
        // Wait a moment for the transaction to be indexed
        await findLastNFTTransfer();
      }, 3000);
      // Refresh auction data to show updated state
      await fetchAuctionData();
    } catch (error) {
      console.error("Failed to transfer NFT:", error);
      styledToast("Failed to transfer NFT", "error");
    } finally {
      setIsProcessingTransfer(false);
      setTransferStep("");
    }
  };

  // Function to find the last transfer of the NFT
  const findLastNFTTransfer = async () => {
    if (!publicProvider || !nftContractAddress) return;

    try {
      setIsProving(true);

      // Get latest block number
      const latestBlock = await publicProvider.getBlockNumber();
      const networkConfig = getNetworkConfig();

      // Create a filter for the Transfer event
      const filter = {
        address: nftContractAddress,
        topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", // Transfer(address,address,uint256)
          null, // from address (null means any address)
          null, // to address (null means any address)
          networkConfig.nftTokenId
            ? ethers.zeroPadValue(ethers.toBeHex(networkConfig.nftTokenId), 32)
            : nftId
              ? ethers.zeroPadValue(ethers.toBeHex(nftId), 32)
              : null, // NFT ID if available
        ],
      };

      // Remove null topics
      if (!filter.topics[3]) {
        filter.topics.pop();
      }

      const logs = await publicProvider.getLogs({
        ...filter,
        fromBlock: Math.max(latestBlock - MAX_LOGS_SEARCH_BLOCK_COUNT, 0),
        toBlock: "latest",
      });

      // Parse the logs
      const transferLogs = logs.map((log) => {
        // For Transfer events, topics are typically:
        // topics[0]: event signature
        // topics[1]: from address (indexed)
        // topics[2]: to address (indexed)
        // topics[3]: token ID (indexed)
        return {
          blockNumber: log.blockNumber,
          transactionHash: log.transactionHash,
          from: log.topics[1]
            ? ethers.getAddress("0x" + log.topics[1].substring(26))
            : "unknown",
          to: log.topics[2]
            ? ethers.getAddress("0x" + log.topics[2].substring(26))
            : "unknown",
          tokenId: log.topics[3] ? parseInt(log.topics[3], 16) : "unknown",
        };
      });

      // Sort logs by block number in descending order
      transferLogs.sort((a, b) => b.blockNumber - a.blockNumber);

      setTransferLogs(transferLogs);

      // If we found any transfers, save the NFT ID for future lookups
      if (
        transferLogs.length > 0 &&
        typeof transferLogs[0].tokenId === "number"
      ) {
        setNftId(transferLogs[0].tokenId);

        // Check if the latest transfer's 'to' address matches the encumbered wallet address
        if (
          wallets.length > 0 &&
          transferLogs[0].to.toLowerCase() ===
            wallets[wallets.length - 1].address.toLowerCase()
        ) {
          setHasVerifiedNftOwnership(true);
          setHasCompletedTransfer(true);
          styledToast(
            "Verified NFT ownership by your encumbered wallet!",
            "success",
          );
        } else {
          setHasVerifiedNftOwnership(false);
          setHasCompletedTransfer(false);
        }
      }

      if (transferLogs.length === 0) {
        styledToast("No transfer events found for this NFT", "info");
      } else {
        styledToast(`Found ${transferLogs.length} transfer events`, "success");
      }
    } catch (error) {
      console.error("Failed to find NFT transfers:", error);
      styledToast("Failed to find NFT transfers", "error");
    } finally {
      setIsProving(false);
    }
  };

  // Function to fetch the wallet's balance
  const fetchWalletBalance = async () => {
    if (!client || wallets.length === 0) {
      if (!client) {
        throw new Error("Client not loaded");
      }
      if (wallets.length === 0) {
        throw new Error("Wallets length is 0");
      }
    }

    try {
      setIsLoadingBalance(true);
      const signer = sapphire.wrap(
        clientToSigner(client, { ...getNetworkConfig().oasis }),
      );
      const auctionContract = new Contract(
        getAuctionPolicyAddress(),
        NFTAuctionPolicy.abi,
        signer,
      );
      const walletAddress = wallets[wallets.length - 1].address;
      // Get the chain IDs
      const networkConfig = getNetworkConfig();
      // Fetch balances from the contract
      const ethBalance = await auctionContract.getEthBalance(
        walletAddress,
        networkConfig.ethereum.chainId,
      );
      const localBalance = await auctionContract.getLocalBalance(
        walletAddress,
        networkConfig.ethereum.chainId,
      );

      setWalletBalance({
        eth: ethers.formatEther(ethBalance),
        local: ethers.formatEther(localBalance),
      });
    } catch (error) {
      console.log("No balance found");
    } finally {
      setIsLoadingBalance(false);
    }
  };

  const switchProvider = async (
    chainName: ChainName,
  ): Promise<ethers.BrowserProvider> => {
    if (!client) {
      throw new Error("Client not loaded");
    }
    const chainConfig = getChainConfig(chainName);
    try {
      await switchChainAsync({
        ...chainConfig,
      });
    } catch (e: any) {
      console.log(e.code, e);

      // If you just approved/added the network, it throws for some reason.
      // We'll try again...
      try {
        await switchChainAsync({
          ...chainConfig,
        });
      } catch (e: any) {
        console.log(e.code, e);
        throw e;
      }
    }
    const provider = new ethers.BrowserProvider(client.transport);
    console.log(await provider.getNetwork());
    return provider;
  };

  /*
  const switchProvider = async (chainName: ChainName): Promise<JsonRpcApiProvider> => {
    if (!client) {
      throw new Error("Client not loaded");
    }
    const ethereumProvider = new ethers.BrowserProvider(client.transport);

    // Get network config
    const networkConfig = getNetworkConfig();

    // Try to switch active chain
    const doSwitch = async () => {
      await client.transport.request({
        method: "wallet_switchEthereumChain",
        params: [
          { chainId: `0x${networkConfig[chainName].chainId.toString(16)}` },
        ],
      });
    };

    try {
      await doSwitch();
    } catch (switchError: any) {
      // This error code indicates that the chain has not been added to MetaMask
      if (switchError.code === 4902) {
        await client.transport.request({
          method: "wallet_addEthereumChain",
          params: [getChainConfig(chainName)],
        });
        // Try again
        await doSwitch();
      } else {
        throw switchError;
      }
    }

    console.log("Network:", await ethereumProvider.getNetwork());
    return ethereumProvider;
  };
  */

  const proveEthereumDepositAction = async (
    walletAddress: string,
    txHash: string,
  ) => {
    try {
      await proveEthereumDeposit(walletAddress, txHash);
    } catch (error) {
      console.error("Failed to prove deposit:", error);
      styledToast(
        `Failed to prove deposit: ${(error as Error).message}`,
        "error",
      );
    } finally {
      setIsFundingWallet(false);
      setFundingStep("");
    }
  };

  const proveEthereumDeposit = async (
    walletAddress: string,
    txHash: string,
  ) => {
    if (!client) {
      styledToast("Wallet not connected", "error");
      return;
    }
    const networkConfig = getNetworkConfig();
    setIsFundingWallet(true);

    // Get transaction details while still on Ethereum network
    setFundingStep("Getting transaction details...");
    const ethereumProvider = await switchProvider("ethereum");
    const txDetails = await ethereumProvider.getTransaction(txHash);
    if (!txDetails) {
      throw new Error("Could not retrieve transaction details");
    }

    let {
      signedTxFormatted: signedTxFormatted,
      inclusionProof: inclusionProof,
      proofBlockNumber: proofBlockNumber,
    } = await getTxInclusion(
      new ethers.JsonRpcProvider(networkConfig.ethereum.rpcUrl),
      txHash,
    );

    setFundingStep("Switching back to Oasis network...");
    // Create a new provider for the Oasis network
    const oasisProvider = await switchProvider("oasis");

    // Wait a moment for the network switch to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    setFundingStep("Waiting for block hash to be set (~30-60 secs)...");
    const oasisSigner = await oasisProvider.getSigner();

    const blockHashOracle = new Contract(
      getBlockHashOracleAddress(),
      BlockHashOracle.abi,
      sapphire.wrap(oasisSigner),
    );

    // Wait for the block hash to be set by the owner
    let blockHashSet = false;
    let attempts = 0;
    const maxAttempts = 100; // 30 seconds timeout

    console.log("proofBlockNumber", proofBlockNumber);
    while (!blockHashSet && attempts < maxAttempts) {
      try {
        const blockHash = await blockHashOracle.getBlockHash(proofBlockNumber);
        if (blockHash !== ethers.ZeroHash) {
          blockHashSet = true;
          break;
        }
      } catch (error) {
        // Ignore errors and continue waiting
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!blockHashSet) {
      throw new Error("Timeout waiting for block hash to be set by owner");
    }

    setFundingStep("Proving transaction inclusion...");
    const txPolicy = new Contract(
      getTxPolicyAddress(),
      ConstrainedTransactionPolicy.abi,
      sapphire.wrap(oasisSigner),
    );

    let ethDeposit;

    try {
      ethDeposit = await txPolicy.depositFunds(
        signedTxFormatted,
        inclusionProof,
        proofBlockNumber,
      );
    } catch (e) {
      console.error(e);
      await txPolicy.depositFunds.staticCall(
        signedTxFormatted,
        inclusionProof,
        proofBlockNumber,
      );
    }

    let ethDepositReceipt = await ethDeposit.wait();
    console.log("ethDepositReceipt ", ethDepositReceipt);

    fetchWalletBalance();
  };

  const depositLocalFunds = async (walletAddress: string) => {
    if (!client) {
      styledToast("Wallet not connected", "error");
      return;
    }

    try {
      const networkConfig = getNetworkConfig();
      const targetChainId = networkConfig.ethereum.chainId;

      console.log("Depositing local funds...");
      const oasisProvider = new ethers.BrowserProvider(
        client.transport,
        networkConfig.oasis.chainId,
      );
      const oasisSigner = await oasisProvider.getSigner();
      const txPolicy = new Contract(
        getTxPolicyAddress(),
        ConstrainedTransactionPolicy.abi,
        sapphire.wrap(oasisSigner),
      );
      await txPolicy
        .depositLocalFunds(wallets[wallets.length - 1].address, targetChainId, {
          value: networkConfig.minOasisBalance,
        })
        .then((r) => r.wait());

      fetchWalletBalance();
    } catch (error) {
      console.error("Failed to deposit local funds:", error);
      styledToast(
        `Failed to deposit local funds: ${(error as Error).message}`,
        "error",
      );
    } finally {
      setIsFundingWallet(false);
      setFundingStep("");
    }
  };

  const handleFundWallet = async (walletAddress: string) => {
    if (!client) {
      styledToast("Wallet not connected", "error");
      return;
    }

    try {
      const networkConfig = getNetworkConfig();
      setIsFundingWallet(true);
      setFundingStep("Switching to Ethereum network...");

      // Create a new provider for the Ethereum network
      const ethereumProvider = await switchProvider("ethereum");

      // Wait a moment for the network switch to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setFundingStep("Sending initial transaction...");
      // Re-create signer after network switch
      const ethereumSigner = await ethereumProvider.getSigner();

      // Send the transaction with fixed amount of ETH
      const tx = await ethereumSigner.sendTransaction({
        to: walletAddress,
        value: networkConfig.minEthBalance,
      });

      setFundingStep("Waiting for transaction confirmation...");
      const txReceipt = await tx.wait();

      if (!txReceipt || !txReceipt.hash) {
        throw new Error("Transaction receipt is null or missing hash");
      }

      await proveEthereumDeposit(walletAddress, txReceipt.hash);
      fetchWalletBalance();

      styledToast("ETH deposit proven successfully!", "success");
      setFundAmount("");
    } catch (error) {
      console.error("Failed to fund wallet:", error);
      styledToast(
        `Failed to fund wallet: ${(error as Error).message}`,
        "error",
      );
    } finally {
      setIsFundingWallet(false);
      setFundingStep("");
    }
  };

  // Store client in ClientStore when it changes
  useEffect(() => {
    if (client) {
      ClientStore.setClient(client);
    }
  }, [client]);

  const handleFinalizeAuction = async () => {
    if (!client) return;
    setIsFinalizingAuction(true);
    try {
      await switchProvider("oasis");
      const auctionContractAddress = getAuctionPolicyAddress();
      const signer = sapphire.wrap(
        clientToSigner(client, { ...getNetworkConfig().oasis }),
      );
      const auctionContract = new Contract(
        auctionContractAddress,
        NFTAuctionPolicy.abi,
        signer,
      );
      // Call finalizeAuction
      const tx = await auctionContract.finalizeAuction();
      styledToast("Finalizing auction, waiting for confirmation...", "info");
      await tx.wait();
      styledToast("Auction finalized successfully!", "success");
      await fetchAuctionData();
    } catch (err: any) {
      console.error("Failed to finalize auction:", err);
      if (err.code === 4001 || err.code === "ACTION_REJECTED") {
        styledToast("Auction finalization cancelled", "info");
      } else {
        await fetchAuctionData();
      }
    } finally {
      setIsFinalizingAuction(false);
    }
  };

  return (
    <div className="min-h-screen main-container">
      <Head>
        <title>Take My Ape | Temporary NFT Control Demo</title>
        <meta
          name="description"
          content="Experience NFT liquefaction with our Bored Ape demo"
        />
      </Head>

      <header>
        <div className="brand">
          <Link href="/">Take My Ape</Link>
        </div>
        <div className="header-right">
          <nav className="main-nav">
            <Link href="/about" className="nav-link">
              What is Liquefaction?
            </Link>
            <Link href="/howto" className="nav-link">
              How To Use
            </Link>
            <a
              href="https://arxiv.org/pdf/2412.02634"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link"
            >
              Research Paper
            </a>
          </nav>
          <ConnectButton />
        </div>
      </header>

      <section className="hero-section">
        <div className="hero-layout">
          <div className="ape-container">
            <div className={`ape-display ${isBlurred ? "blurred" : ""}`}>
              <Image
                src="/icons/bored_ape.webp"
                alt="Bored Ape NFT"
                width={700}
                height={700}
                priority
              />
              {isBlurred && <div className="question-mark">?</div>}
            </div>
            {isBlurred && (
              <div className="blur-explanation">
                The current owner has chosen to blur out the ape!
              </div>
            )}
            <ClientOnly>
              {isCurrentOwner && (
                <div className="ape-visibility-control">
                  <span className="ape-visibility-text">
                    Show this Ape to other visitors?
                  </span>
                  <button
                    className={`visibility-toggle ${!isBlurred ? "visible" : ""}`}
                    onClick={handleBlurToggle}
                    disabled={isUpdatingBlur}
                    aria-label="Toggle ape visibility"
                  />
                </div>
              )}
            </ClientOnly>
          </div>

          <div className="content-container">
            <h1 className="title">Take My Ape</h1>
            <p
              className="subtitle"
              style={{ fontStyle: "italic", fontSize: "1.9rem" }}
            >
              "In the future, everyone will be world-famous for 15 minutes."
              <span style={{ fontSize: "0.95em", color: "#888" }}>
                — Andy Warhol
              </span>
            </p>
            <div className="wallet-benefits-box">
              <h2 className="wallet-benefits-title">
                Take control of the Ape!
              </h2>
              <p className="wallet-benefits-desc">
                During the 15+ minutes as owner, you can:
              </p>
              <ul className="wallet-benefits-list">
                <li>🖼️ Control the ape's image (+copyright license!)</li>
                <li>
                  🎮 Play with the Ape in{" "}
                  <a
                    href="https://yuga.dashbo.xyz/"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#1e293b", textDecoration: "underline" }}
                  >
                    BAYC Studio
                  </a>
                </li>
                <li>
                  ✍🏻 Prove ownership via a{" "}
                  <a
                    href="https://etherscan.io/verifiedsignatures"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#1e293b", textDecoration: "underline" }}
                  >
                    signature
                  </a>
                </li>
                <li>
                  🔑 Access the{" "}
                  <a
                    href="https://boredapeyachtclub.com/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#1e293b", textDecoration: "underline" }}
                  >
                    BAYC member-only area
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="wallet-functionality">
        <div className="wallet-functionality-inner">
          <div className="steps-row">
            <div className="steps-container">
              <h2>How it works:</h2>
              <ol>
                <li>Connect your main wallet</li>
                <li>Create an encumbered wallet</li>
                <li>Fund your encumbered wallet</li>
                <li>
                  Bid in an auction to claim the Bored Ape<sup>*</sup>
                </li>
                <li>If you win, transfer the NFT to your encumbered wallet</li>
                <li>Enjoy ownership for 15+ minutes!</li>
              </ol>

              <div className="howto-tip">
                <span>Need a walkthrough? </span>
                <Link href="/howto" className="howto-link">
                  Watch our How To Videos
                </Link>
              </div>
              <div className="howto-tip">
                <span>Need help?</span>
                <a
                  href="https://discord.com/invite/BQCxwhT5wS"
                  className="howto-link"
                >
                  Join the Oasis Discord and ask in #general
                </a>
              </div>

              <br />
              <small>
                * This is a congestion control mechanism to ensure no one hoards
                the Ape for too long. It's a sealed-bid, second-price auction,
                so you'll only pay the second-price bid if you win. We do not
                profit from this demo; auction payments are burned to the zero
                address.
              </small>
            </div>
            <div className="steps-image-outside">
              <img
                src={
                  isBlurred
                    ? "/icons/ape_jumping_mask_clean.png"
                    : "/icons/ape_jumping_clean.png"
                }
                alt="Ape 15 minutes illustration"
              />
            </div>
          </div>
          <ClientOnly>
            <div className="imp-instr-container">
              <h3>Important instructions:</h3>
              <ul>
                <li>
                  <b>
                    Please only use a connected wallet with a small amount of
                    ether (&gt; 0.001 ETH) and ROSE (&gt; 4 ROSE) in it.
                  </b>{" "}
                  Our demo requires a lot of signatures.
                </li>
                <li>
                  If you don't have Oasis Sapphire ROSE, you can get some using{" "}
                  <a href="https://routernitro.com/swap?fromToken=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee&fromChainId=1&toToken=0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee&toChainId=23294">
                    nitro
                  </a>
                  .
                </li>
                <li>
                  Ensure you have Oasis Sapphire selected as the network after
                  you connect your wallet.
                </li>
                <li>
                  Make sure the Ethereum{" "}
                  <a href="https://etherscan.io/gastracker">gas price</a> is{" "}
                  <b>under 2 gwei</b> before bidding for the ape.
                </li>
                <li>
                  The policies controlling your encumbered account in this demo
                  expire after 4 weeks. If your encumbered account is more
                  than 4 weeks old, create a new encumbered account.
                </li>
              </ul>
            </div>

            {!isConnected ? (
              <div className="connect-section">
                <h2>Step 1: Connect Your Wallet</h2>
                <p>
                  Connect your main wallet to create an encumbered wallet and
                  start the demo.
                </p>
                <ConnectButton />
              </div>
            ) : initialized ? (
              <div className="wallet-section">
                <div className="section-header">
                  <h2>Step 2: Create an Encumbered Wallet</h2>
                  <div className="wallet-buttons">
                    {/* Only show top right buttons if a wallet exists */}
                    {wallets.length > 0 && (
                      <div className="wallet-buttons">
                        <button
                          onClick={handleFetchWallet}
                          className="fetch-button"
                          title="Fetch your wallet from the blockchain"
                        >
                          Fetch Wallet
                        </button>
                        <button
                          onClick={handleCreateWallet}
                          disabled={isCreating}
                          className="create-button"
                        >
                          {isCreating ? "Creating..." : "Create Wallet"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Confirmation Dialog */}
                {showWalletConfirmation && (
                  <div className="confirmation-dialog">
                    <div className="dialog-content">
                      <h3>Warning: Existing Wallet Will Be Destroyed</h3>
                      <p>
                        Creating a new wallet will permanently replace your
                        current wallet. This action cannot be undone.
                      </p>
                      <div className="dialog-buttons">
                        <button
                          onClick={() => setShowWalletConfirmation(false)}
                          className="cancel-button"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={createWallet}
                          className="confirm-button"
                        >
                          Continue
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {wallets.length > 0 ? (
                  <div className="wallets-container">
                    <div className="wallet-item">
                      <div className="wallet-header">
                        <h4>Your Encumbered Wallet</h4>
                      </div>

                      <div className="wallet-address">
                        <p className="address-label">Wallet Address</p>
                        <p className="address">
                          {wallets[wallets.length - 1].address}
                        </p>
                        <div className="wallet-balance">
                          <div className="balance-info">
                            <span className="balance-label">
                              Recognized balance:
                            </span>
                            <span className="balance-value">
                              {isLoadingBalance
                                ? "Loading..."
                                : walletBalance
                                  ? `${walletBalance.eth} ETH / ${walletBalance.local} ROSE`
                                  : "Unknown ETH / Unknown ROSE"}
                            </span>
                          </div>
                          <div className="balance-actions">
                            <button
                              onClick={fetchWalletBalance}
                              disabled={isLoadingBalance}
                              className="refresh-balance-button"
                              title="Refresh wallet balance"
                            >
                              ↻
                            </button>
                            <button
                              onClick={() =>
                                handleFundWallet(
                                  wallets[wallets.length - 1].address,
                                )
                              }
                              disabled={isFundingWallet}
                              className="fund-button"
                            >
                              {isFundingWallet
                                ? fundingStep
                                : `Fund ${ethers.formatEther(getNetworkConfig().minEthBalance)} ETH`}
                            </button>
                            <button
                              onClick={() =>
                                depositLocalFunds(
                                  wallets[wallets.length - 1].address,
                                )
                              }
                              disabled={isFundingWallet}
                              className="fund-button"
                            >
                              {isFundingWallet
                                ? fundingStep
                                : `Fund ${ethers.formatEther(getNetworkConfig().minOasisBalance)} ROSE`}
                            </button>
                          </div>
                          <div className="input-group">
                            {/* TODO: Only show this if the ETH balance of the encumbered account > 0 and the internal balance is 0 */}
                            <input
                              type="text"
                              id="manualTxProveInput"
                              placeholder="ETH deposit tx hash..."
                            />
                            <button
                              onClick={(e) => {
                                proveEthereumDepositAction(
                                  wallets[wallets.length - 1].address,
                                  (
                                    document.getElementById(
                                      "manualTxProveInput",
                                    ) as HTMLInputElement
                                  ).value,
                                );
                              }}
                              disabled={isFundingWallet}
                              className="fund-button"
                            >
                              {isFundingWallet
                                ? "Working..."
                                : "Prove ETH manually"}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Only render auction-section if not winner */}
                      {!isWinner && (
                        <div className="auction-section">
                          <div className="auction-header">
                            <h3>Step 3: Participate in Auction</h3>
                            <button
                              onClick={fetchAuctionData}
                              className="refresh-button"
                              title="Refresh auction data"
                            >
                              Refresh Data
                            </button>
                          </div>

                          {auctionEndTime && (
                            <div className="auction-status">
                              <p>Time remaining: {timeRemaining}</p>

                              <p>
                                Current NFT Owner:{" "}
                                <span className="address-display">
                                  {currentNftOwner
                                    ? `${currentNftOwner.substring(0, 6)}...${currentNftOwner.substring(currentNftOwner.length - 4)}`
                                    : "Loading..."}
                                </span>
                              </p>

                              {highestBid && (
                                <p>
                                  Current highest bid:{" "}
                                  {ethers.formatEther(highestBid)} ETH
                                </p>
                              )}
                            </div>
                          )}

                          {!isAuctionEnded ? (
                            <div className="bid-form">
                              <div className="bid-input-container">
                                <input
                                  type="text"
                                  value={bidAmount}
                                  onChange={(e) => setBidAmount(e.target.value)}
                                  placeholder={
                                    !walletBalance ||
                                    Number(walletBalance.eth) === 0
                                      ? "Fund your account before you can join the auction!"
                                      : "Enter bid amount in ROSE"
                                  }
                                  className="bid-input"
                                  disabled={
                                    isSubmittingBid ||
                                    !walletBalance ||
                                    Number(walletBalance.eth) === 0 ||
                                    hasBidThisAuction
                                  }
                                />
                                <button
                                  onClick={handleSubmitBid}
                                  disabled={
                                    isSubmittingBid ||
                                    !bidAmount ||
                                    !walletBalance ||
                                    Number(walletBalance.eth) === 0 ||
                                    hasBidThisAuction
                                  }
                                  className="bid-button"
                                >
                                  {isSubmittingBid
                                    ? "Submitting..."
                                    : hasBidThisAuction
                                      ? "Already Bid"
                                      : "Submit Bid"}
                                </button>
                              </div>
                              {walletBalance &&
                                Number(walletBalance.eth) === 0 && (
                                  <p
                                    className="bid-help"
                                    style={{ color: "#e53e3e" }}
                                  >
                                    Fund your account before you can join the
                                    auction!
                                  </p>
                                )}
                              {hasBidThisAuction && (
                                <p
                                  className="bid-help"
                                  style={{ color: "#eeeeee" }}
                                >
                                  You can only bid once per auction.
                                </p>
                              )}
                            </div>
                          ) : (
                            <div className="finalize-auction">
                              <p>The auction has ended!</p>
                              <button
                                onClick={handleFinalizeAuction}
                                disabled={isFinalizingAuction}
                                className="finalize-button"
                              >
                                {isFinalizingAuction
                                  ? "Finalizing..."
                                  : "Finalize Auction"}
                              </button>
                              <p className="finalize-help">
                                Finalizing the auction will start a new auction
                                and allow the winner to transfer the NFT to
                                their encumbered wallet
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {isWinner && nftContractAddress && (
                        <div className="winner-info">
                          {!hasVerifiedNftOwnership ? (
                            <>
                              <p>
                                Congratulations! You won the NFT at address:{" "}
                                {nftContractAddress}
                              </p>
                              {hasCompletedTransfer ? (
                                <>
                                  <p>
                                    Your transfer has been completed, but needs
                                    to be verified.
                                  </p>
                                  <button
                                    onClick={findLastNFTTransfer}
                                    disabled={isProving}
                                    className="verify-button"
                                  >
                                    {isProving
                                      ? "Verifying..."
                                      : "Verify NFT Transfer"}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <p>
                                    Please transfer the NFT to your encumbered
                                    wallet to fully claim it:
                                  </p>

                                  {/* NFT Transfer Controls */}
                                  <div className="nft-transfer-controls">
                                    <h4>
                                      Transfer NFT to Your Encumbered Wallet
                                    </h4>
                                    <button
                                      onClick={handleTransferNFT}
                                      disabled={isProcessingTransfer}
                                      className="transfer-button"
                                    >
                                      {isProcessingTransfer
                                        ? transferStep
                                        : "Transfer NFT to My Wallet"}
                                    </button>
                                    <p className="transfer-help">
                                      This will sign and broadcast a transaction
                                      to transfer the NFT to your encumbered
                                      wallet
                                    </p>
                                  </div>
                                </>
                              )}
                            </>
                          ) : (
                            <div className="success-message">
                              <h3 className="success-title">
                                You now own Ape #8180
                              </h3>
                              <p className="success-subtext">
                                You have a copyright license for the NFT image.
                                Here's what you can do now:
                              </p>
                              <ul className="success-action-list">
                                <li>
                                  Control the ape's image on top of this page by
                                  clicking the toggle button under it!
                                </li>
                                <li>
                                  Play with the Ape in{" "}
                                  <a
                                    href="https://yuga.dashbo.xyz/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    BAYC Studio
                                  </a>
                                </li>
                                <li>
                                  Prove ownership via a{" "}
                                  <a
                                    href="https://etherscan.io/verifiedsignatures"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    signature
                                  </a>
                                </li>
                                <li>
                                  Access the{" "}
                                  <a
                                    href="https://boredapeyachtclub.com/login"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    BAYC member-only area
                                  </a>
                                </li>
                              </ul>
                              <hr className="success-divider" />
                              <div className="tweet-section">
                                <a
                                  href={`https://twitter.com/intent/tweet?text=I%20own%20Ape%20%238180!%20%F0%9F%A6%8D%20Steal%20it%20from%20me%20for%20under%20%241%20at%20takemyape.com`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="tweet-button"
                                >
                                  <svg
                                    width="20"
                                    height="20"
                                    fill="currentColor"
                                    viewBox="0 0 24 24"
                                    style={{ marginRight: 4 }}
                                  >
                                    <path d="M22.46 5.924c-.793.352-1.646.59-2.54.698a4.48 4.48 0 0 0 1.965-2.475 8.94 8.94 0 0 1-2.828 1.082A4.48 4.48 0 0 0 16.11 4c-2.48 0-4.49 2.01-4.49 4.49 0 .352.04.696.116 1.025C7.728 9.37 4.1 7.6 1.67 4.98c-.387.664-.61 1.437-.61 2.26 0 1.56.795 2.94 2.005 3.75-.738-.024-1.43-.226-2.037-.563v.057c0 2.18 1.55 4 3.61 4.42-.377.104-.775.16-1.185.16-.29 0-.57-.027-.845-.08.57 1.78 2.23 3.08 4.2 3.12A8.98 8.98 0 0 1 2 19.54c-.65 0-1.29-.038-1.92-.112A12.7 12.7 0 0 0 7.29 21.5c8.39 0 12.98-6.95 12.98-12.98 0-.2-.004-.4-.014-.6.89-.64 1.66-1.44 2.19-2.36z" />
                                  </svg>
                                  Tweet About Your Ape
                                </a>
                                <a
                                  href={`https://bsky.app/intent/compose?text=I%20own%20Ape%20%238180!%20%F0%9F%A6%8D%20Steal%20it%20from%20me%20for%20under%20%241%20at%20takemyape.com`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="bluesky-button"
                                >
                                  <svg
                                    width="20"
                                    height="20"
                                    fill="currentColor"
                                    viewBox="0 0 24 24"
                                    style={{ marginRight: 4 }}
                                  >
                                    <circle
                                      cx="12"
                                      cy="12"
                                      r="10"
                                      fill="#fff"
                                    />
                                    <path
                                      d="M12 2C6.477 2 2 6.477 2 12c0 5.523 4.477 10 10 10s10-4.477 10-10c0-5.523-4.477-10-10-10zm0 18.5A8.5 8.5 0 1 1 12 3.5a8.5 8.5 0 0 1 0 17z"
                                      fill="#0066ff"
                                    />
                                    <path
                                      d="M12 7.5c-2.485 0-4.5 2.015-4.5 4.5s2.015 4.5 4.5 4.5 4.5-2.015 4.5-4.5-2.015-4.5-4.5-4.5zm0 7.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"
                                      fill="#0066ff"
                                    />
                                  </svg>
                                  Share on Bluesky
                                </a>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="walletconnect-section">
                        <p>Step 4: Connect with WalletConnect</p>
                        <WalletConnectButton
                          walletAddress={wallets[wallets.length - 1].address}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">
                    <p>
                      No encumbered wallets yet. Create your first one to start
                      experimenting, or fetch your existing wallet from the
                      blockchain.
                    </p>
                    {wallets.length === 0 ? (
                      <div className="empty-state-buttons">
                        <button
                          onClick={handleFetchWallet}
                          className="fetch-button"
                        >
                          Fetch Existing Wallet
                        </button>
                        <button
                          onClick={handleCreateWallet}
                          disabled={isCreating}
                          className="create-button"
                        >
                          {isCreating
                            ? "Creating..."
                            : "Create Your First Wallet"}
                        </button>
                      </div>
                    ) : (
                      <div
                        className="wallet-buttons"
                        style={{
                          justifyContent: "flex-end",
                          marginTop: "1.5rem",
                        }}
                      >
                        <button
                          onClick={handleCreateWallet}
                          disabled={isCreating}
                          className="create-button"
                        >
                          {isCreating ? "Creating..." : "Create New Wallet"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="loading-state">
                <p>Initializing wallet services...</p>
              </div>
            )}
          </ClientOnly>
        </div>
      </section>

      {/* New section for transfer logs at the bottom of page */}
      <section className="transfer-logs-section">
        <div className="container">
          <div className="section-header">
            <h2>NFT Transfer History</h2>
            <button
              onClick={findLastNFTTransfer}
              disabled={isProving || !nftContractAddress || !publicProvider}
              className="prove-button"
            >
              {isProving ? "Finding Transfers..." : "Find NFT Transfers"}
            </button>
          </div>

          {transferLogs.length > 0 ? (
            <div className="logs-display">
              <table className="logs-table">
                <thead>
                  <tr>
                    <th>Block #</th>
                    <th>Tx Hash</th>
                    <th>From</th>
                    <th>To</th>
                  </tr>
                </thead>
                <tbody>
                  {transferLogs.map((log, index) => (
                    <tr key={log.transactionHash} className="log-row">
                      <td>
                        <span className="block-number">{log.blockNumber}</span>
                      </td>
                      <td>
                        <span
                          className="hash-display"
                          title="Click to copy"
                          onClick={() =>
                            copyToClipboard(
                              log.transactionHash,
                              "Transaction hash",
                            )
                          }
                        >
                          {log.transactionHash.slice(0, 6)}...
                          {log.transactionHash.slice(-4)}
                        </span>
                      </td>
                      <td>
                        <span
                          className="address-display"
                          title="Click to copy"
                          onClick={() =>
                            copyToClipboard(log.from, "From address")
                          }
                        >
                          {log.from.slice(0, 6)}...{log.from.slice(-4)}
                        </span>
                      </td>
                      <td>
                        <span
                          className="address-display"
                          title="Click to copy"
                          onClick={() => copyToClipboard(log.to, "To address")}
                        >
                          {log.to.slice(0, 6)}...{log.to.slice(-4)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-logs">No transfer logs available</div>
          )}
        </div>
      </section>

      <footer>
        <div>
          <p>© {currentYear} Take My Ape. All rights reserved.</p>
          <div className="links">
            <Link href="/about">What is Liquefaction?</Link>
            <Link href="/howto">How To Use</Link>
            <a
              href="https://arxiv.org/pdf/2412.02634"
              target="_blank"
              rel="noopener noreferrer"
            >
              Research Paper
            </a>
            <a
              href="https://github.com/key-encumbrance"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>

      {showNoWalletWarning && (
        <div
          style={{
            color: "#e53e3e",
            textAlign: "center",
            marginTop: "1rem",
            fontWeight: 500,
            fontSize: "1.1rem",
            transition: "opacity 0.5s",
          }}
        >
          You still don't have any created account!
        </div>
      )}

      <style jsx>{`
        /* Existing styles... */

        /* Section Header Styles */
        .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }

        .wallet-buttons {
          display: flex;
          gap: 1rem;
        }

        .fetch-button {
          padding: 0.75rem 1.5rem;
          background-color: #6366f1;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
          transition: background-color 0.2s;
        }

        .fetch-button:hover {
          background-color: #4f46e5;
        }

        /* Auction Header Styles */
        .auction-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
        }

        .refresh-button {
          padding: 0.5rem 1rem;
          background-color: #60a5fa;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.875rem;
          font-weight: 500;
          transition: background-color 0.2s;
        }

        .refresh-button:hover {
          background-color: #3b82f6;
        }

        /* Empty State Button Layout */
        .empty-state-buttons {
          display: flex;
          gap: 1rem;
          justify-content: center;
          margin-top: 1.5rem;
        }

        /* Auction Section Styles */
        .auction-section {
          margin-top: 1.5rem;
          padding: 1.5rem;
          background-color: #f8f9fa;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }

        .auction-section h3 {
          margin-top: 0;
          margin-bottom: 1rem;
          font-size: 1.25rem;
          color: #333;
        }

        .auction-status {
          margin-bottom: 1.5rem;
          padding: 0.75rem;
          background-color: #f0f4f8;
          border-radius: 6px;
          font-size: 0.9rem;
        }

        .auction-status p {
          margin: 0.5rem 0;
        }

        .winner-status {
          color: #2c974b;
          font-weight: 600;
        }

        .bid-form {
          margin-bottom: 1rem;
        }

        .bid-input-container {
          display: flex;
          margin-bottom: 0.5rem;
        }

        .bid-input {
          flex: 1;
          padding: 0.75rem;
          border: 1px solid #ddd;
          border-radius: 4px 0 0 4px;
          font-size: 1rem;
        }

        .bid-button {
          padding: 0.75rem 1.25rem;
          background-color: #0070f3;
          color: white;
          border: none;
          border-radius: 0 4px 4px 0;
          cursor: pointer;
          font-weight: 500;
          transition: background-color 0.2s;
        }

        .bid-button:hover {
          background-color: #0060df;
        }

        .bid-button:disabled {
          background-color: #cccccc;
          cursor: not-allowed;
        }

        .bid-help {
          font-size: 0.8rem;
          color: #666;
          margin-top: 0.5rem;
        }

        .finalize-auction {
          margin-bottom: 1.5rem;
        }

        .finalize-button {
          padding: 0.75rem 1.5rem;
          background-color: #e53e3e;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
          transition: background-color 0.2s;
          margin: 1rem 0;
        }

        .finalize-button:hover {
          background-color: #c53030;
        }

        .finalize-button:disabled {
          background-color: #f56565;
          cursor: not-allowed;
        }

        .finalize-help {
          font-size: 0.8rem;
          color: #666;
        }

        .winner-info {
          margin-top: 1.5rem;
          padding: 1rem;
          background-color: #f0fff4;
          border: 1px solid #c6f6d5;
          border-radius: 6px;
          color: #2c974b;
        }

        /* NFT Transfer Styles */
        .nft-transfer-controls {
          margin-top: 1.5rem;
          padding: 1rem;
          background-color: #ebf8ff;
          border: 1px solid #bee3f8;
          border-radius: 6px;
          color: #2b6cb0;
        }

        .nft-transfer-controls h4 {
          margin-top: 0;
          margin-bottom: 1rem;
          color: #2c5282;
        }

        .transfer-button {
          padding: 0.75rem 1.5rem;
          background-color: #3182ce;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
          transition: background-color 0.2s;
          margin: 0.5rem 0;
          width: 100%;
        }

        .transfer-button:hover {
          background-color: #2c5282;
        }

        .transfer-button:disabled {
          background-color: #90cdf4;
          cursor: not-allowed;
        }

        .transfer-help {
          font-size: 0.8rem;
          color: #4a5568;
          margin-top: 0.5rem;
        }

        .verify-button {
          padding: 0.75rem 1.5rem;
          background-color: #2563eb;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
          transition: background-color 0.2s;
          margin: 1rem 0;
          width: 100%;
        }

        .verify-button:hover {
          background-color: #1d4ed8;
        }

        .verify-button:disabled {
          background-color: #93c5fd;
          cursor: not-allowed;
        }

        .walletconnect-section {
          margin-top: 1.5rem;
        }

        /* Confirmation Dialog Styles */
        .confirmation-dialog {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .dialog-content {
          background-color: white;
          padding: 2rem;
          border-radius: 8px;
          max-width: 500px;
          width: 90%;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        }

        .dialog-content h3 {
          color: #e53e3e;
          margin-top: 0;
          margin-bottom: 1rem;
        }

        .dialog-buttons {
          display: flex;
          justify-content: flex-end;
          margin-top: 1.5rem;
          gap: 1rem;
        }

        .cancel-button {
          padding: 0.5rem 1rem;
          background-color: #e2e8f0;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
        }

        .confirm-button {
          padding: 0.5rem 1rem;
          background-color: #e53e3e;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
        }

        .address-display {
          font-family: monospace;
          font-size: 0.875rem;
          background-color: #f3f4f6;
          padding: 2px 6px;
          border-radius: 4px;
          display: inline-block;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .address-display:hover {
          background-color: #e5e7eb;
        }

        .prove-transfer-button {
          padding: 0.5rem 0.75rem;
          background-color: #6366f1;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.875rem;
          transition: background-color 0.2s;
        }

        .prove-transfer-button:hover {
          background-color: #4f46e5;
        }

        .prove-transfer-button:disabled {
          background-color: #a5b4fc;
          cursor: not-allowed;
        }

        .empty-logs {
          padding: 2rem;
          text-align: center;
          color: #6b7280;
          font-style: italic;
        }

        /* Transfer Logs Section Styles */
        .transfer-logs-section {
          padding: 2rem 0;
          background-color: #f9fafb;
          border-top: 1px solid #e5e7eb;
        }

        .transfer-logs-section .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 1rem;
        }

        .transfer-logs-section .section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }

        .transfer-logs-section h2 {
          font-size: 1.5rem;
          color: #111827;
          margin: 0;
        }

        .prove-button {
          padding: 0.75rem 1.5rem;
          background-color: #8b5cf6;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 500;
          transition: background-color 0.2s;
        }

        .prove-button:hover {
          background-color: #7c3aed;
        }

        .prove-button:disabled {
          background-color: #c4b5fd;
          cursor: not-allowed;
        }

        .proving-status {
          padding: 0.75rem;
          background-color: #f3f4f6;
          border-radius: 4px;
          margin-bottom: 1rem;
          font-style: italic;
          color: #4b5563;
        }

        .logs-display {
          background-color: white;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }

        .logs-table {
          width: 100%;
          border-collapse: collapse;
        }

        .logs-table th,
        .logs-table td {
          padding: 0.75rem 1rem;
          text-align: left;
          border-bottom: 1px solid #e5e7eb;
        }

        .logs-table th {
          background-color: #f9fafb;
          font-weight: 600;
          color: #374151;
          font-size: 0.875rem;
        }

        .log-row:hover {
          background-color: #f9fafb;
        }

        .hash-display {
          font-family: monospace;
          font-weight: 500;
          background-color: #f3f4f6;
          padding: 2px 6px;
          border-radius: 4px;
          display: inline-block;
          cursor: pointer;
          transition: background-color 0.2s;
        }

        .hash-display:hover {
          background-color: #e5e7eb;
        }

        .wallet-balance {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 0.5rem;
          padding: 0.5rem 1rem;
          background-color: #f1f5f9;
          border-radius: 6px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
        }

        .balance-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .balance-actions {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          justify-content: flex-end;
        }

        .fund-button {
          padding: 0.5rem 1.25rem;
          background-color: #10b981;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.95rem;
          font-weight: 500;
          transition: background-color 0.2s;
        }
        .fund-button:hover {
          background-color: #059669;
        }
        .fund-button:disabled {
          background-color: #a1e9d2;
          cursor: not-allowed;
        }
        .refresh-balance-button {
          padding: 0.5rem 0.75rem;
          background-color: #e2e8f0;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 1rem;
          color: #334155;
          transition: background-color 0.2s;
        }
        .refresh-balance-button:hover {
          background-color: #cbd5e1;
        }
        .refresh-balance-button:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .balance-label {
          font-weight: bold;
        }

        .imp-instr-container {
          background: #fffaf5;
          border-radius: 24px;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
          padding: 1.5rem 1.5rem 1.5rem 2.5rem;
          margin: 1rem 3rem;
          flex: 0 1;
        }

        .imp-instr-container h3 {
          color: #f97316;
        }

        .steps-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3.5rem;
          margin-bottom: 2.5rem;
          max-width: 1200px;
          margin-left: auto;
          margin-right: auto;
        }
        .steps-container {
          background: #fff;
          border-radius: 24px;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
          padding: 2rem 1.5rem 1.5rem 1.5rem;
          flex: 0 1 520px;
          min-width: 0;
          max-width: 520px;
        }
        .steps-container h2 {
          text-align: center;
          font-size: 2.2rem;
          margin-bottom: 2rem;
        }
        .steps-container ol {
          margin: 0;
          padding-left: 1.5rem;
        }
        .steps-container ol li {
          font-size: 1.35rem;
          margin-bottom: 0.45rem;
          color: #374151;
          font-weight: 500;
          letter-spacing: 0.01em;
          line-height: 1.5;
          transition: color 0.2s;
        }
        .steps-container ol li:last-child {
          margin-bottom: 0;
        }
        .steps-image-outside {
          flex: 0 0 520px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .steps-image-outside img {
          max-width: 500px;
          width: 100%;
          height: auto;
          border-radius: 0px;
          box-shadow: 0 0px 0px rgba(0, 0, 0, 0.08);
        }
        @media (max-width: 1100px) {
          .steps-row {
            flex-direction: column;
            gap: 1.5rem;
          }
          .steps-image-outside {
            margin-top: 1rem;
            flex: 0 0 auto;
          }
          .steps-image-outside img {
            max-width: 320px;
          }
          .steps-container {
            max-width: 100%;
            width: 100%;
          }
        }

        /* Add/restore styles for the box */
        .wallet-benefits-box {
          background: #f9fafb;
          border-radius: 16px;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
          padding: 2.5rem 2.5rem 2rem 2.5rem;
          max-width: 600px;
          margin: 2.5rem 0 2rem 0;
        }
        .wallet-benefits-title {
          font-size: 2rem;
          font-weight: 700;
          color: #f97316;
          margin-bottom: 0.5rem;
        }
        .wallet-benefits-desc {
          font-size: 1.15rem;
          color: #374151;
          margin-bottom: 1.2rem;
        }
        .wallet-benefits-list {
          list-style: disc inside;
          text-align: left;
          margin: 0 auto;
          max-width: 500px;
          padding-left: 1.2em;
        }
        .wallet-benefits-list li {
          font-size: 1.13rem;
          color: #1e293b;
          margin-bottom: 0.5rem;
          font-weight: 500;
          line-height: 1.5;
          display: flex;
          align-items: center;
          gap: 0.5em;
        }
        .wallet-benefits-list li:last-child {
          margin-bottom: 0;
        }

        .success-message {
          text-align: center;
          background: #eafff0;
          border: 1.5px solid #b2f2d7;
          border-radius: 14px;
          padding: 2.5rem 1.5rem 2rem 1.5rem;
          margin: 0 auto 2.5rem auto;
          max-width: 700px;
          box-shadow: 0 2px 12px rgba(34, 197, 94, 0.06);
        }
        .success-title {
          font-size: 2.2rem;
          font-weight: 700;
          color: #1e293b;
          margin-bottom: 0.5rem;
          letter-spacing: -0.01em;
        }
        .success-subtext {
          color: #3b5b4b;
          font-size: 1.1rem;
          margin-bottom: 2rem;
        }
        .success-action-list {
          text-align: left;
          margin: 0 auto 2.2rem auto;
          padding-left: 1.5em;
          max-width: 420px;
          font-size: 1.08rem;
          color: #1e293b;
          line-height: 1.7;
        }
        .success-action-list li {
          margin-bottom: 0.7em;
        }
        .success-action-list a {
          color: #0070f3;
          text-decoration: underline;
          font-weight: 500;
        }
        .success-action-list a:hover {
          color: #0051a3;
        }
        .success-divider {
          border: none;
          border-top: 1.5px solid #b2f2d7;
          margin: 2.2rem auto 1.5rem auto;
          max-width: 420px;
        }

        .tweet-section {
          display: flex;
          justify-content: center;
          gap: 1.2rem;
          margin-top: 1.2rem;
        }
        .tweet-button,
        .bluesky-button {
          display: inline-flex;
          align-items: center;
          gap: 0.5em;
          padding: 0.7rem 1.5rem;
          border-radius: 6px;
          font-size: 1.08rem;
          font-weight: 600;
          text-decoration: none;
          transition:
            background 0.18s,
            color 0.18s,
            box-shadow 0.18s;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
        }
        .tweet-button {
          background: #1da1f2;
          color: #fff;
        }
        .tweet-button:hover {
          background: #0d8ddb;
          color: #fff;
        }
        .bluesky-button {
          background: #0066ff;
          color: #fff;
        }
        .bluesky-button:hover {
          background: #004bb5;
          color: #fff;
        }

        .block-number {
          font-family: monospace;
          font-size: 0.875rem;
          color: #4b5563;
          font-weight: 500;
        }

        .howto-tip {
          margin-top: 1.5rem;
          padding: 1rem;
          background: #fff8e1;
          border-left: 4px solid #ffb300;
          border-radius: 8px;
          font-size: 1.08rem;
          color: #7c4700;
          display: flex;
          align-items: center;
          gap: 0.5em;
        }
        .howto-link {
          color: #ff6f00;
          font-weight: 600;
          text-decoration: underline;
          margin-left: 0.25em;
        }
        .howto-link:hover {
          color: #ff9100;
          text-decoration: underline;
        }

        .blur-explanation {
          margin: 1.5rem auto 0 auto;
          background: none;
          color: #a67c00;
          border: none;
          border-radius: 0;
          padding: 0;
          font-size: 1.25rem;
          font-weight: 500;
          max-width: 700px;
          width: 100%;
          text-align: center;
          display: block;
          box-shadow: none;
          text-shadow: 0 2px 8px rgba(255, 255, 255, 0.7);
        }
        @media (max-width: 600px) {
          .blur-explanation {
            max-width: 98vw;
            font-size: 1.05rem;
          }
        }
      `}</style>
    </div>
  );
}
