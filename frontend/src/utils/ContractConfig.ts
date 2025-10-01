/**
 * Contract addresses configuration file
 * These addresses should be replaced with the actual deployed contract addresses
 */

// Default contract addresses (will be overridden by env variables if available)
export const DEFAULT_CONTRACT_ADDRESS =
  "0x0000000000000000000000000000000000000000";
export const DEFAULT_FACTORY_ADDRESS =
  "0x0000000000000000000000000000000000000000";
export const DEFAULT_MESSAGE_POLICY_ADDRESS =
  "0x0000000000000000000000000000000000000000";
export const DEFAULT_AUCTION_POLICY_ADDRESS =
  "0x0000000000000000000000000000000000000000"; // Update this with the actual deployed auction contract address
export const DEFAULT_TX_POLICY_ADDRESS =
  "0x0000000000000000000000000000000000000000"; // Transaction policy address
export const DEFAULT_BLOCKHASH_ORACLE_ADDRESS =
  "0x0000000000000000000000000000000000000000"; // Blockhash oracle address

/**
 * Get the contract address from environment variable or fall back to default
 */
export function getContractAddress(): string {
  // Use environment variable if available
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS
  ) {
    return process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  }
  return DEFAULT_CONTRACT_ADDRESS;
}

/**
 * Get the factory contract address from environment variable or fall back to default
 */
export function getFactoryAddress(): string {
  // Use environment variable if available
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_FACTORY_ADDRESS
  ) {
    return process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
  }
  return DEFAULT_FACTORY_ADDRESS;
}

/**
 * Get the message policy contract address from environment variable or fall back to default
 */
export function getMessagePolicyAddress(): string {
  // Use environment variable if available
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_MESSAGE_POLICY_ADDRESS
  ) {
    return process.env.NEXT_PUBLIC_MESSAGE_POLICY_ADDRESS;
  }
  return DEFAULT_MESSAGE_POLICY_ADDRESS;
}

/**
 * Get the auction policy contract address from environment variable or fall back to default
 */
export function getAuctionPolicyAddress(): string {
  // Use environment variable if available
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_NFT_AUCTION_POLICY_ADDRESS
  ) {
    return process.env.NEXT_PUBLIC_NFT_AUCTION_POLICY_ADDRESS;
  }
  return DEFAULT_AUCTION_POLICY_ADDRESS;
}

/**
 * Get the transaction policy contract address from environment variable or fall back to default
 */
export function getTxPolicyAddress(): string {
  // Use environment variable if available
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_TX_POLICY_ADDRESS
  ) {
    return process.env.NEXT_PUBLIC_TX_POLICY_ADDRESS;
  }
  return DEFAULT_TX_POLICY_ADDRESS;
}

/**
 * Get the blockhash oracle contract address from environment variable or fall back to default
 */
export function getBlockHashOracleAddress(): string {
  // Use environment variable if available
  if (
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS
  ) {
    return process.env.NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS;
  }
  return DEFAULT_BLOCKHASH_ORACLE_ADDRESS;
}

export function getOwnerControlsAddress(): string {
  return (
    process.env.NEXT_PUBLIC_OWNER_CONTROLS_ADDRESS ||
    "0x0000000000000000000000000000000000000000"
  );
}
