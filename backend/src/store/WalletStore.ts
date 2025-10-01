// Store for managing wallets across all users
class WalletStore {
  private static instance: WalletStore;
  private wallets: Map<string, { address: string; index: number; contractAddress: string }[]>;

  private constructor() {
    this.wallets = new Map();
  }

  public static getInstance(): WalletStore {
    if (!WalletStore.instance) {
      WalletStore.instance = new WalletStore();
    }
    return WalletStore.instance;
  }

  public getWallets(userId: string): { address: string; index: number; contractAddress: string }[] {
    return this.wallets.get(userId) || [];
  }

  public addWallet(
    userId: string,
    wallet: { address: string; index: number; contractAddress: string },
  ): void {
    const userWallets = this.getWallets(userId);
    userWallets.push(wallet);
    this.wallets.set(userId, userWallets);
  }

  public clearAllWallets(): void {
    this.wallets.clear();
  }
}

export default WalletStore;
