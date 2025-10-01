import React, { Component, ErrorInfo, ReactNode } from "react";
import { toast } from "react-hot-toast";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * ErrorBoundary to catch and handle errors in React components
 * Particularly focusing on MetaMask rejections
 */
class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  // Update state when an error is caught
  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true };
  }

  // Handle the error and reset state
  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Error caught by ErrorBoundary:", error);
    console.error("Component stack:", errorInfo.componentStack);

    // Check if this is a user rejection from MetaMask
    if (
      error &&
      ((typeof error.message === "string" &&
        (error.message.includes("user rejected") ||
          error.message.includes("User rejected") ||
          error.message.includes("user denied") ||
          error.message.includes("ethers-user-denied"))) ||
        (error as any).code === 4001 ||
        (error as any).code === "ACTION_REJECTED" ||
        (error as any).action === "signTypedData")
    ) {
      console.log("User rejected the request, this is expected behavior");
      // Just log and silently continue
    } else {
      // Show toast for unexpected errors
      toast.error("Something went wrong. Please try again.");
    }

    // Reset the error state to allow the app to recover
    this.setState({ hasError: false });
  }

  public render() {
    // We don't need a fallback UI since we handle the error and continue
    return this.props.children;
  }
}

export default ErrorBoundary;
