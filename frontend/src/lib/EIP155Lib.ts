import { ethers } from "ethers";
import {
  derToEthSignature,
  createEthereumMessage,
} from "../utils/ethereum-signatures";
import { getTypedDataParams, filterUnusedTypes } from "./eip-712";

/**
 * Types
 */
interface IInitArgs {
  mnemonic?: string;
}
export interface EIP155Wallet {
  getAddress(): Promise<string>;
  signMessage(message: string): Promise<string>;
  _signTypedData(
    domain: any,
    types: any,
    data: any,
    _primaryType?: string,
  ): Promise<string>;
  signTransaction(transaction: ethers.TransactionRequest): Promise<string>;
}

function getCurrentTime(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Library
 */
export default class EIP155Lib implements EIP155Wallet {
  // messagePolicyContract now holds our WalletConnectMessagePolicy contract
  messagePolicyContract: ethers.Contract;
  basicEncumberedWalletContract: ethers.Contract;
  addr: string;
  walletIndex: number | string;
  constructor(
    messagePolicyContract: ethers.Contract,
    basicEncumberedWalletContract: ethers.Contract,
    address: string,
    walletIndex: number | string,
  ) {
    this.messagePolicyContract = messagePolicyContract;
    this.basicEncumberedWalletContract = basicEncumberedWalletContract;
    this.addr = address;
    this.walletIndex = walletIndex;
  }

  static init(
    messagePolicyContract: ethers.Contract,
    basicEncumberedWalletContract: ethers.Contract,
    address: string,
    walletIndex: number | string,
  ) {
    return new EIP155Lib(
      messagePolicyContract,
      basicEncumberedWalletContract,
      address,
      walletIndex,
    );
  }

  async getAddress() {
    return this.addr;
  }

  async signMessage(message: string) {
    console.log("Signing message via WalletConnectMessagePolicy:", message);

    // Check if the contract is defined
    if (!this.messagePolicyContract) {
      console.error("Message policy contract is undefined!");
      throw new Error(
        "WalletConnect session lost. Please reconnect your wallet.",
      );
    }

    const encodedMessage = createEthereumMessage(message);

    // Call the messagePolicyContract's signMessage function instead of the wallet directly
    try {
      console.log("Using address:", this.addr, "for signing");

      // Verify the contract is still valid before calling
      if (
        !this.messagePolicyContract.runner ||
        !this.messagePolicyContract.target
      ) {
        console.error(
          "Message policy contract is in an invalid state:",
          this.messagePolicyContract,
        );
        throw new Error(
          "WalletConnect policy contract is in an invalid state. Please reconnect your wallet.",
        );
      }

      // Attempt the signature with proper parameters (message, account)
      const signature = await this.messagePolicyContract.signMessage(
        encodedMessage,
        this.addr,
      );

      const ethSignature = derToEthSignature(
        signature,
        message,
        this.addr,
        "message",
      );
      if (!ethSignature) {
        throw new Error("Failed to sign message");
      }
      console.log("Signature received:", ethSignature);
      return ethSignature;
    } catch (error) {
      console.error("Error signing message via policy:", error);

      // Provide more helpful error message based on error type
      if (
        error instanceof Error &&
        (error.message.includes("Cannot read properties of undefined") ||
          error.message.includes("null") ||
          error.message.includes("is not a function"))
      ) {
        throw new Error(
          "WalletConnect session expired. Please reconnect your wallet.",
        );
      } else {
        throw error;
      }
    }
  }

  async _signTypedData(
    domain: any,
    types: any,
    data: any,
    _primaryType: string,
  ) {
    // Check if the contract is defined
    if (!this.messagePolicyContract) {
      console.error("Message policy contract is undefined!");
      throw new Error(
        "WalletConnect session lost. Please reconnect your wallet.",
      );
    }

    // Validate domain parameters
    if (!domain || typeof domain !== "object") {
      throw new Error("Invalid domain parameters for EIP-712 signing");
    }

    // Validate types
    if (!types || typeof types !== "object") {
      throw new Error("Invalid types for EIP-712 signing");
    }

    // Validate data
    if (!data || typeof data !== "object") {
      throw new Error("Invalid data for EIP-712 signing");
    }

    console.log("Before:", types, "Primary type:", _primaryType);
    const filteredTypes = filterUnusedTypes(types, _primaryType);
    console.log("After filtering unused types:", filteredTypes);
    const { typeString, encodedData, domainParams } = getTypedDataParams({
      domain,
      types: filteredTypes,
      message: data,
      primaryType: _primaryType,
    });

    try {
      console.log("Using address:", this.addr, "for signing");
      console.log("Domain params:", domainParams);
      console.log("Type string:", typeString);
      console.log("Encoded data:", encodedData);

      // Enroll the encumbrance policy for this domain
      // The transaction will fail if it's already enrolled, but whatever
      const asset = ethers.keccak256(
        ethers.toUtf8Bytes("EIP-712 " + domain.name),
      );
      try {
        const authorizedAddress = await (
          this.messagePolicyContract.runner as ethers.Signer
        ).getAddress();
        const dd = await this.basicEncumberedWalletContract.findEip712Asset(
          domainParams,
          "0x",
          "0x",
        );
        console.log(
          "Entering encumbrance contract with message policy for domain " +
            domain.name +
            " toward address " +
            authorizedAddress,
          "Computed asset:",
          asset,
          "Empirical:",
          dd,
        );
        console.log("Wallet index:", this.walletIndex);
        console.log(
          "Message policy contract:",
          await this.messagePolicyContract.getAddress(),
        );
        const tx =
          await this.basicEncumberedWalletContract.enterEncumbranceContract(
            this.walletIndex,
            [asset],
            await this.messagePolicyContract.getAddress(),
            getCurrentTime() + 3600 * 24 * 7,
            ethers.AbiCoder.defaultAbiCoder().encode(
              ["address"],
              [authorizedAddress],
            ),
          );
        await tx.wait();
      } catch (e) {
        console.warn(
          "Entering the encumbrance contract failed. We'll assume it's already been entered.",
          e,
        );
      }

      // Call the messagePolicyContract's signTypedData function
      const signature = await this.messagePolicyContract.signTypedData(
        this.addr,
        domainParams,
        typeString,
        encodedData,
      );

      const typeHash = ethers.TypedDataEncoder.hash(
        domain,
        filteredTypes,
        data,
      );

      // Convert the signature to Ethereum format
      const ethSignature = derToEthSignature(
        signature,
        typeHash,
        this.addr,
        "digest",
      );
      if (!ethSignature) {
        throw new Error("Failed to convert signature to Ethereum format");
      }

      return ethSignature;
    } catch (error) {
      console.error("Error signing typed data via policy:", error);
      throw error;
    }
  }

  // TODO: fix
  async signTransaction(
    transaction: ethers.TransactionRequest,
  ): Promise<string> {
    // Transaction signing should still go through the encumbrance policy
    // This function might need to be implemented differently or remain unsupported
    console.error(
      "Transaction signing is not supported via the WalletConnectMessagePolicy",
    );
    throw new Error("Transaction signing not supported via this policy");
  }
}
