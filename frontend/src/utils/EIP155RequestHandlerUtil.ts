import {
  EIP155_CHAINS,
  EIP155_SIGNING_METHODS,
  TEIP155Chain,
} from "@/data/EIP155Data";
import {
  getWallet,
  refreshWalletContractInstances,
} from "@/utils/EIP155WalletUtil";
import {
  getSignParamsMessage,
  getSignTypedDataParamsData,
} from "@/utils/HelperUtil";
import { formatJsonRpcError, formatJsonRpcResult } from "@json-rpc-tools/utils";
import { SignClientTypes } from "@walletconnect/types";
import { getSdkError } from "@walletconnect/utils";
import SettingsStore from "@/store/SettingsStore";
import { ethers } from "ethers";

type RequestEventArgs = Omit<
  SignClientTypes.EventArguments["session_request"],
  "verifyContext"
>;

export async function approveEIP155Request(requestEvent: RequestEventArgs) {
  const { params, id } = requestEvent;
  const { chainId, request } = params;

  SettingsStore.setActiveChainId(chainId);

  try {
    // Try to get the wallet
    console.log("Getting wallet for params:", params);
    let wallet = await getWallet(params);
    console.log("Got wallet:", wallet);
    // If the wallet is in a bad state, try to refresh it
    if (!wallet || !wallet.messagePolicyContract) {
      console.log("Wallet is in a bad state, attempting to refresh...");
      // Attempt to refresh wallet instances before proceeding
      await refreshWalletContractInstances();
      wallet = await getWallet(params);

      // If still undefined after refresh, throw error
      if (!wallet || !wallet.messagePolicyContract) {
        throw new Error(
          "Unable to reconnect wallet. Please try again or reconnect your wallet.",
        );
      }
    }

    switch (request.method) {
      case EIP155_SIGNING_METHODS.PERSONAL_SIGN:
      case EIP155_SIGNING_METHODS.ETH_SIGN:
        try {
          const message = getSignParamsMessage(request.params);
          const signedMessage = await wallet.signMessage(message);
          return formatJsonRpcResult(id, signedMessage);
        } catch (error: any) {
          console.error(error);
          alert(error.message);
          return formatJsonRpcError(id, error.message);
        }

      case EIP155_SIGNING_METHODS.ETH_SIGN_TYPED_DATA:
      case EIP155_SIGNING_METHODS.ETH_SIGN_TYPED_DATA_V3:
      case EIP155_SIGNING_METHODS.ETH_SIGN_TYPED_DATA_V4:
        try {
          const {
            domain,
            types,
            message: data,
            primaryType,
          } = getSignTypedDataParamsData(request.params);

          // Remove EIP712Domain from types as it's handled separately
          delete types.EIP712Domain;

          try {
            // Try to sign the message
            const signedData = await wallet._signTypedData(
              domain,
              types,
              data,
              primaryType,
            );
            return formatJsonRpcResult(id, signedData);
          } catch (signError: any) {
            console.error("Error in ETH_SIGN_TYPED_DATA:", signError);

            // Check if this is a user rejection error, which we want to handle gracefully
            if (
              signError.message &&
              (signError.message.includes("user rejected") ||
                signError.message.includes("User rejected") ||
                signError.message.includes("user denied") ||
                signError.message.includes("ethers-user-denied") ||
                signError.code === 4001 ||
                signError.code === "ACTION_REJECTED")
            ) {
              console.log(
                "User rejected the request, returning appropriate error",
              );
              return formatJsonRpcError(
                id,
                getSdkError("USER_REJECTED").message,
              );
            }

            // For other errors, throw so the outer catch can handle it
            throw signError;
          }
        } catch (error: any) {
          console.error("Error processing typed data signing request:", error);

          // Check again for user rejection patterns at the outer level
          if (
            error.message &&
            (error.message.includes("user rejected") ||
              error.message.includes("User rejected") ||
              error.message.includes("user denied") ||
              error.message.includes("ethers-user-denied") ||
              error.code === 4001 ||
              error.code === "ACTION_REJECTED")
          ) {
            console.log(
              "User rejected the request, returning appropriate error",
            );
            return formatJsonRpcError(id, getSdkError("USER_REJECTED").message);
          }

          // Only show UI alert for non-rejection errors
          alert(error.message);
          return formatJsonRpcError(id, error.message);
        }

      case EIP155_SIGNING_METHODS.ETH_SEND_TRANSACTION:
        try {
          const provider = new ethers.JsonRpcProvider(
            EIP155_CHAINS[chainId as TEIP155Chain].rpc,
          );
          const sendTransaction = request.params[0];
          const signedTx = await wallet.signMessage(sendTransaction);
          const txResponse = await provider.broadcastTransaction(signedTx);
          const txHash =
            typeof txResponse === "string" ? txResponse : txResponse?.hash;
          const txReceipt = await txResponse.wait();
          console.log(
            `Transaction broadcasted on chain ${chainId} , ${{
              txHash,
            }}, status: ${txReceipt?.status}`,
          );
          return formatJsonRpcResult(id, txHash);
        } catch (error: any) {
          console.error(error);
          return formatJsonRpcError(id, error.message);
        }

      case EIP155_SIGNING_METHODS.ETH_SIGN_TRANSACTION:
        try {
          const signTransaction = request.params[0];
          const signature = await wallet.signTransaction(signTransaction);
          return formatJsonRpcResult(id, signature);
        } catch (error: any) {
          console.error(error);
          alert(error.message);
          return formatJsonRpcError(id, error.message);
        }
      default:
        throw new Error(getSdkError("INVALID_METHOD").message);
    }
  } catch (error: any) {
    console.error("Error in approveEIP155Request:", error);
    return formatJsonRpcError(id, error.message);
  }
}

export function rejectEIP155Request(request: RequestEventArgs) {
  const { id } = request;

  return formatJsonRpcError(id, getSdkError("USER_REJECTED").message);
}
