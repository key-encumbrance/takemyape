// Global store for managing wallets across all users
// This is a server-side singleton that persists across API requests
let globalWallets: Map<
  string,
  { address: string; index: number; contractAddress: string }[]
> = new Map();

export class WalletStore {
  // Get all wallets for a specific user
  static getWallets(
    userId: string,
  ): { address: string; index: number; contractAddress: string }[] {
    return globalWallets.get(userId) || [];
  }

  // Add a wallet for a specific user
  static addWallet(
    userId: string,
    wallet: { address: string; index: number; contractAddress: string },
  ): void {
    const userWallets = WalletStore.getWallets(userId);
    userWallets.push(wallet);
    globalWallets.set(userId, userWallets);
  }

  // Clear wallets for a specific user
  static clearWallets(userId: string): void {
    globalWallets.delete(userId);
  }

  // Clear all wallets for all users
  static clearAllWallets(): void {
    globalWallets = new Map();
  }
}

export default WalletStore;
