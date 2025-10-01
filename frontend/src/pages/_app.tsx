import { AppProps } from "next/app";
import "../../public/main.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { Toaster } from "react-hot-toast";
import Modal from "@/components/Modal";
import Layout from "@/components/Layout";
import { useEffect } from "react";
import { toast } from "react-hot-toast";
import ErrorBoundary from "@/components/ErrorBoundary";

import { config } from "../utils/wagmi";

const client = new QueryClient();

export default function App({ Component, pageProps }: AppProps) {
  // Set up global error handler for unhandled rejections
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      // Prevent the default browser behavior that would show an error
      event.preventDefault();

      // Log the error for debugging purposes
      console.error("Unhandled Promise Rejection:", event.reason);

      // Check for the specific error pattern from the user query
      if (
        event.reason &&
        typeof event.reason === "object" &&
        (event.reason.code === "ACTION_REJECTED" ||
          event.reason.code === 4001) &&
        (event.reason.action === "signTypedData" ||
          (event.reason.info &&
            event.reason.info.payload &&
            event.reason.info.payload.method &&
            event.reason.info.payload.method.includes("eth_signTypedData")))
      ) {
        console.log(
          "User rejected eth_signTypedData request, ignoring this error",
        );
        return;
      }

      // Check if this is a user rejection error, which we can safely ignore
      if (
        event.reason &&
        ((typeof event.reason.message === "string" &&
          (event.reason.message.includes("user rejected") ||
            event.reason.message.includes("User rejected") ||
            event.reason.message.includes("user denied"))) ||
          event.reason.code === 4001 ||
          event.reason.code === "ACTION_REJECTED")
      ) {
        console.log("User rejected the request, this is expected behavior");
        // No need to show an error toast for user rejections
        return;
      }

      // For any other type of error, show a toast notification
      toast.error("An error occurred. Please try again.");
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener(
        "unhandledrejection",
        handleUnhandledRejection,
      );
    };
  }, []);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={client}>
        <RainbowKitProvider>
          <ErrorBoundary>
            <Toaster />
            <Component {...pageProps} />
            <Modal />
          </ErrorBoundary>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
