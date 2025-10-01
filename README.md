# Liquefaction "Take My Ape" Demo

Site: https://takemyape.com

Liquefaction repository: https://github.com/key-encumbrance/liquefaction

## Overview

This project demonstrates NFT liquefaction of a Bored Ape NFT that lets anyone become its on-chain owner. It consists of:

- Oasis Sapphire smart contracts for encumbered wallets and NFT auctions
- A frontend interface allowing users to:
  - Create encumbered wallets
  - Claim temporary ownership of a Bored Ape NFT
  - Connect via WalletConnect to use the NFT in token-gated applications

## Complete Setup Instructions

To run the complete environment, follow these steps in order:

1. Start the Oasis blockchain:
```bash
docker run -it -p8545:8545 -p8546:8546 -p8547:8547 -p8548:8548 --platform linux/x86_64 ghcr.io/oasisprotocol/sapphire-localnet -test-mnemonic
```

2. Start Kurtosis with the specified parameters:
```bash
kurtosis run github.com/ethpandaops/ethereum-package --args-file ./devnet/network_params.yaml --image-download always --enclave liquefaction-pub-devnet
```

3. Ensure you have set the `NEXT_PUBLIC_PROJECT_ID` and `NEXT_PUBLIC_RELAY_URL` env vars for Walletkit/Reown support. Your project ID should be associated with the domain you are hosting the demo on.

4. Run the setup script to deploy contracts and configure the environment:
```bash
./setup_deployed_chain.sh
```

Or, on a test network:
```bash
BLOCK_HASH_ORACLE_UPDATER_KEY=<private key> ./setup_deployed_chain.sh --env test -k <owner private_key>
```

Ensure the owner address has funds in it.

5. (Optional) Migrate to the multi block hash setter.
```bash
cd backend/
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 npx hardhat run scripts/deployMultiBlockHashSetterProxy.ts
```

Run:
```bash
NEXT_PUBLIC_MULTI_BLOCK_HASH_SETTER_PROXY_ADDRESS=<deployment address> BLOCK_HASH_ORACLE_UPDATER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 npx hardhat run scripts/update-block-hashes-multi.ts
```

### Run the frontend

In a development environment:
```bash
cd frontend/
npx next dev
```

In a production environment:
```bash
cd frontend/
npx next build
npx next start
```

## Project Structure

- `frontend/`: Next.js application providing the user interface
  - `src/pages/`: React components for different pages
  - `src/components/`: Reusable UI components
  - `src/contracts/`: Contract ABIs
  - `src/utils/`: Utility functions and helpers
  - `src/hooks/`: Custom React hooks

- `backend/`: Smart contract development environment
  - `contracts/`: Solidity smart contracts
  - `scripts/`: Deployment and testing scripts

## Key Features

- Encumbered Wallets: Create wallets with specific usage constraints
- NFT Auction System: Bid for temporary ownership of NFTs
- WalletConnect Integration: Use temporarily owned NFTs in any compatible application

## Smart Contract Architecture

- **NFTAuctionPolicy**: Manages auctions and temporary NFT ownership
- **BasicEncumberedWallet**: Controls allowable operations on held assets
- **ApeLiquefactionWalletFactory**: Creates new encumbered wallets for users

