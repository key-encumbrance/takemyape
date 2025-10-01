import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import { promises as fs } from "fs";
import path from "path";
import canonicalize from "canonicalize";

// Task to export contract ABIs
const TASK_EXPORT_ABIS = "export-abis";
task(TASK_EXPORT_ABIS, "Exports ABI files").setAction(async (_, hre) => {
  const outDir = path.join(hre.config.paths.root, "abis");
  await fs.mkdir(outDir, { recursive: true });

  const artifactNames = await hre.artifacts.getAllFullyQualifiedNames();
  await Promise.all(
    artifactNames.map(async (fqn) => {
      const { abi, contractName } = await hre.artifacts.readArtifact(fqn);
      if (abi.length === 0 || contractName.endsWith("Test")) return;
      await fs.writeFile(`${path.join(outDir, contractName)}.json`, `${canonicalize(abi)}\n`);
    }),
  );
});

// Deploy BasicEncumberedWallet
task("deploy-wallet", "Deploys the BasicEncumberedWallet contract").setAction(async (_, hre) => {
  await hre.run("compile");
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying with account: ${await deployer.getAddress()}`);

  const WalletFactory = await hre.ethers.getContractFactory("BasicEncumberedWallet");
  const walletContract = await WalletFactory.deploy();
  await walletContract.waitForDeployment();

  console.log(`BasicEncumberedWallet deployed at: ${await walletContract.getAddress()}`);
  return walletContract;
});

// Create an encumbered wallet
task("create-wallet", "Creates a new encumbered wallet")
  .addPositionalParam("contract", "Address of the deployed contract")
  .addPositionalParam("index", "Index for the new wallet")
  .setAction(async (args, hre) => {
    const walletContract = await hre.ethers.getContractAt("BasicEncumberedWallet", args.contract);
    const tx = await walletContract.createWallet(args.index);
    await tx.wait();
    console.log(`Wallet created at index ${args.index}`);
  });

// Get public key of a wallet
task("get-public-key", "Gets the public key of a wallet")
  .addPositionalParam("contract", "Contract address")
  .addPositionalParam("index", "Wallet index")
  .setAction(async (args, hre) => {
    const walletContract = await hre.ethers.getContractAt("BasicEncumberedWallet", args.contract);
    const publicKey = await walletContract.getPublicKey(args.index);
    console.log(`Public Key: ${publicKey}`);
  });

// Get wallet address
task("get-wallet-address", "Gets the wallet address")
  .addPositionalParam("contract", "Contract address")
  .addPositionalParam("index", "Wallet index")
  .setAction(async (args, hre) => {
    const walletContract = await hre.ethers.getContractAt("BasicEncumberedWallet", args.contract);
    const walletAddress = await walletContract.getWalletAddress(args.index);
    console.log(`Wallet Address: ${walletAddress}`);
  });

// Sign a message
task("sign-message", "Signs a message using an encumbered wallet")
  .addPositionalParam("contract", "Contract address")
  .addPositionalParam("index", "Wallet index")
  .addPositionalParam("message", "Message to sign")
  .setAction(async (args, hre) => {
    const walletContract = await hre.ethers.getContractAt("BasicEncumberedWallet", args.contract);
    const signedMessage = await walletContract.signMessageSelf(
      args.index,
      hre.ethers.toUtf8Bytes(args.message),
    );
    console.log(`Signed Message: ${signedMessage}`);
  });

// Hardhat configuration
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 999_999,
      },
      viaIR: true,
    },
  },
  networks: {
    sapphire_testnet: {
      url: "https://testnet.sapphire.oasis.dev",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 0x5aff,
    },
    sapphire_mainnet: {
      url: "https://sapphire.oasis.io",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 0x5afe,
    },
    dev: {
      url: "http://127.0.0.1:8545",
      accounts: [
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      ],
      chainId: 0x5afd,
      timeout: 10_000_000,
    },
  },
  mocha: {
    timeout: 600_000,
  },
};

export default config;
