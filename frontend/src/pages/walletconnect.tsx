import SettingsStore from "@/store/SettingsStore";
import { walletkit } from "@/utils/WalletConnectUtil";
import { parseUri } from "@walletconnect/utils";
import { styledToast } from "@/utils/HelperUtil";
import { Input, Loading } from "@nextui-org/react";
import { useState } from "react";
import {
  eip155Addresses,
  eip155Wallets,
  refreshWalletContractInstances,
} from "@/utils/EIP155WalletUtil";

interface WalletConnectButtonProps {
  walletAddress: string;
}

const WalletConnectButton = ({ walletAddress }: WalletConnectButtonProps) => {
  const [showConnectView, setShowConnectView] = useState(false);
  const [uri, setUri] = useState("");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectedTo, setConnectedTo] = useState("");

  async function onConnect(uri: string) {
    const { topic: pairingTopic } = parseUri(uri);

    // Handle pairing expiration
    const pairingExpiredListener = ({ topic }: { topic: string }) => {
      if (pairingTopic === topic) {
        styledToast(
          "Pairing expired. Please try again with new Connection URI",
          "error",
        );
        setConnected(false);
        setConnectedTo("");
        walletkit.core.pairing.events.removeListener(
          "pairing_expire",
          pairingExpiredListener,
        );
      }
    };

    walletkit.once("session_proposal", () => {
      walletkit.core.pairing.events.removeListener(
        "pairing_expire",
        pairingExpiredListener,
      );
    });

    try {
      setLoading(true);
      walletkit.core.pairing.events.on(
        "pairing_expire",
        pairingExpiredListener,
      );
      console.log("Connecting with WalletConnect URI:", pairingTopic);
      console.log("Setting EIP155 Address to:", walletAddress);

      // Set the specific wallet address that will be used for WalletConnect
      SettingsStore.setEIP155Address(walletAddress);

      // Ensure this address is in our tracked addresses list
      if (!eip155Addresses.includes(walletAddress)) {
        console.log("Adding address to eip155Addresses:", walletAddress);
        eip155Addresses.push(walletAddress);
      }

      // Log current wallet state for debugging
      console.log("Current eip155Addresses:", eip155Addresses);
      console.log("Current eip155Wallets:", Object.keys(eip155Wallets));

      // Check if this URI is already paired
      const pairings = walletkit.core.pairing.getPairings();
      console.log(
        "Existing pairings:",
        pairings.map((p) => p.topic),
      );
      const existingPairing = pairings.find((p) => p.topic === pairingTopic);

      // Make sure our wallet contract instances are fresh
      try {
        await refreshWalletContractInstances();
      } catch (refreshError) {
        console.warn("Error refreshing wallet instances:", refreshError);
        // Continue anyway as we'll try to establish a new connection
      }

      if (existingPairing) {
        console.log("Found existing pairing with topic:", pairingTopic);

        try {
          // Disconnect the existing pairing
          console.log("Disconnecting existing pairing...");
          await walletkit.core.pairing.disconnect({
            topic: pairingTopic,
          });

          // Wait a moment for the disconnection to process
          await new Promise((resolve) => setTimeout(resolve, 500));
          console.log("Disconnected existing pairing, creating new one...");
        } catch (disconnectError) {
          console.warn(
            "Error disconnecting existing pairing:",
            disconnectError,
          );
          // Continue anyway since we're going to try to reconnect
        }
      }

      // Pair with the WalletConnect URI
      await walletkit.pair({ uri });
      setConnected(true);
      setConnectedTo(walletAddress);
      console.log("Connected with WalletConnect URI:", pairingTopic);
      styledToast("Connected successfully!", "success");

      // Wait a brief moment and refresh wallet instances again to ensure everything is up-to-date
      setTimeout(async () => {
        try {
          await refreshWalletContractInstances();
          console.log("Wallet instances refreshed after successful connection");
        } catch (error) {
          console.warn(
            "Error refreshing wallet instances after connection:",
            error,
          );
        }
      }, 1000);
    } catch (error) {
      styledToast((error as Error).message, "error");
      console.error("Connection error:", error);
    } finally {
      setLoading(false);
      setUri("");
    }
  }

  if (!showConnectView) {
    return (
      <button
        onClick={() => setShowConnectView(true)}
        className="walletconnect-button"
      >
        <svg viewBox="0 0 32 32" width="16" height="16" fill="none">
          <path
            d="M9.58819 11.8556C13.1696 8.27416 18.9243 8.27416 22.5057 11.8556L23.0431 12.3931C23.2643 12.6142 23.2643 12.9741 23.0431 13.1952L21.1663 15.0721C21.0557 15.1826 20.8758 15.1826 20.7652 15.0721L20.0069 14.3138C17.6946 12.0015 14.3992 12.0015 12.087 14.3138L11.2842 15.1166C11.1737 15.2271 10.9938 15.2271 10.8832 15.1166L9.00642 13.2397C8.7853 13.0186 8.7853 12.6587 9.00642 12.4376L9.58819 11.8556ZM26.3848 15.7349L28.045 17.3952C28.2661 17.6163 28.2661 17.9762 28.045 18.1973L21.5948 24.6475C21.3737 24.8686 21.0138 24.8686 20.7926 24.6475C20.7926 24.6475 20.7926 24.6475 20.7926 24.6475L16.2335 20.0884C16.1782 20.0331 16.0883 20.0331 16.033 20.0884C16.033 20.0884 16.033 20.0884 16.033 20.0884L11.4739 24.6475C11.2528 24.8686 10.8929 24.8686 10.6718 24.6475C10.6718 24.6475 10.6718 24.6475 10.6718 24.6475L4.22165 18.1973C4.00054 17.9762 4.00054 17.6163 4.22165 17.3952L5.88189 15.7349C6.10301 15.5138 6.46289 15.5138 6.684 15.7349L11.2431 20.294C11.2984 20.3493 11.3883 20.3493 11.4436 20.294C11.4436 20.294 11.4436 20.294 11.4436 20.294L16.0027 15.7349C16.2239 15.5138 16.5837 15.5138 16.8048 15.7349C16.8048 15.7349 16.8048 15.7349 16.8048 15.7349L21.364 20.294C21.4193 20.3493 21.5091 20.3493 21.5644 20.294L26.1235 15.7349C26.3446 15.5138 26.7045 15.5138 26.9256 15.7349L26.3848 15.7349Z"
            fill="white"
          />
        </svg>
        {connected ? "View Connection" : "Connect with WalletConnect"}
      </button>
    );
  }

  return (
    <div className="connection-form">
      <div className="connection-header">
        <h4>WalletConnect</h4>
        <button
          onClick={() => setShowConnectView(false)}
          className="close-button"
        >
          Close
        </button>
      </div>

      {connected && (
        <div className="connection-status">
          <div className="status-indicator">
            <div className="status-dot"></div>
            <span>Connected</span>
          </div>
          <p className="connection-label">Connected Address</p>
          <p className="connection-address">{connectedTo}</p>
        </div>
      )}

      <div className="connection-input">
        <p>Enter WalletConnect URI</p>
        <div className="input-group">
          <input
            type="text"
            placeholder="e.g. wc:a281567bb3e4..."
            value={uri}
            onChange={(e) => setUri(e.target.value)}
          />
          <button
            disabled={!uri || loading}
            onClick={() => onConnect(uri)}
            className="connect-button"
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WalletConnectButton;
