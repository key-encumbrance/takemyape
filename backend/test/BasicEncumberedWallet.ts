import { ethers } from "hardhat";
import * as sapphire from "@oasisprotocol/sapphire-paratime";

describe("BasicEncumberedWallet", () => {
  async function deployWallet() {
    // Contracts are deployed using the first signer/account by default
    const [firstSigner] = await ethers.getSigners();
    const owner = sapphire.wrap(firstSigner);

    const Eip712UtilsFactory = await ethers.getContractFactory("EIP712Utils");
    const eip712Utils = await Eip712UtilsFactory.deploy();

    const BasicEncumberedWalletFactory = await ethers.getContractFactory("BasicEncumberedWallet", {
      libraries: {
        EIP712Utils: eip712Utils.target,
      },
    });
    const wallet = await BasicEncumberedWalletFactory.deploy();

    return { owner, wallet: wallet.connect(owner) };
  }

  describe("Wallet", () => {
    it("Should create a new wallet", async () => {
      const { owner, wallet } = await deployWallet();
      await wallet.createWallet(0).then(async (w) => w.wait());
      console.log(await wallet.getPublicKey(0));
    });
  });
});
