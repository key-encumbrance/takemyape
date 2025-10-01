// Default block hash oracle address
export const DEFAULT_BLOCKHASH_ORACLE_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Get the blockhash oracle contract address from environment variable or fall back to default
 */
export function getBlockHashOracleAddress(): string {
  // Use environment variable if available
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS) {
    return process.env.NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS;
  }
  return DEFAULT_BLOCKHASH_ORACLE_ADDRESS;
} 