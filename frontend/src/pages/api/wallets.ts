import { NextApiRequest, NextApiResponse } from "next";
import WalletStore from "../../store/WalletStore";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Get user ID from the connected wallet address in the request
  const userAddress = req.query.address as string;

  if (!userAddress) {
    return res.status(400).json({ message: "Wallet address required" });
  }

  const userId = userAddress.toLowerCase();

  switch (req.method) {
    case "GET":
      // Return user's wallets
      return res.status(200).json(WalletStore.getWallets(userId));

    case "POST":
      // Add a new wallet
      const newWallet = req.body;
      WalletStore.addWallet(userId, newWallet);
      return res.status(201).json(newWallet);

    case "DELETE":
      // Clear wallets only for the specific user
      WalletStore.clearWallets(userId);
      return res.status(200).json({ message: "User wallets cleared" });

    default:
      return res.status(405).json({ message: "Method not allowed" });
  }
}
