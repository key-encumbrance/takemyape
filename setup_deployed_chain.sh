#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Default to dev environment if not specified
NETWORK_ENV=${NETWORK_ENV:-dev}

# Function to display usage
usage() {
  echo "Usage: $0 [OPTIONS]"
  echo "Options:"
  echo "  -e, --env ENV       Network environment (dev, test, prod) [default: dev]"
  echo "  -k, --key KEY       Private key for test environment funding"
  echo "  -h, --help          Display this help message"
  exit 1
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -e|--env)
      NETWORK_ENV="$2"
      shift 2
      ;;
    -k|--key)
      PRIVATE_KEY="$2"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

# Validate environment
if [[ ! "$NETWORK_ENV" =~ ^(dev|test|prod)$ ]]; then
  echo -e "${RED}ERROR: Invalid environment. Must be one of: dev, test, prod${NC}"
  exit 1
fi

# Validate private key for test environment
if [[ "$NETWORK_ENV" == "test" && -z "$PRIVATE_KEY" ]]; then
  echo -e "${YELLOW}Warning: No private key provided for test environment. Some functionality may be limited.${NC}"
  echo -e "${YELLOW}To provide a private key, use: $0 -e test -k YOUR_PRIVATE_KEY${NC}"
fi

echo -e "${GREEN}=== Liquefaction Demo Setup (Deployed Chain) ===${NC}"
echo -e "${YELLOW}Using network environment: ${NETWORK_ENV}${NC}"

# Step 1: Verify the Oasis blockchain is running
echo -e "${YELLOW}Verifying Oasis blockchain connection...${NC}"
if ! curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' http://localhost:8545 > /dev/null; then
  echo -e "${RED}ERROR: Oasis blockchain is not running. Please start it first.${NC}"
  exit 1
fi
echo -e "${GREEN}Blockchain connection verified!${NC}"

# Step 2: Deploy contracts
echo -e "${YELLOW}Deploying smart contracts...${NC}"
cd backend
rm -rf ignition/deployments

# Export environment variables for the deployment script
export NETWORK_ENV
if [[ -n "$PRIVATE_KEY" ]]; then
  export PRIVATE_KEY
fi

if [[ "$NETWORK_ENV" == "test" ]]; then
  NETWORK_NAME="sapphire_testnet"
elif [[ "$NETWORK_ENV" == "prod" ]]; then
  NETWORK_NAME="sapphire_mainnet"
else
  NETWORK_NAME="dev"
fi

echo -e "${GREEN}Running deploy on network: ${NETWORK_NAME}${NC}"
npx hardhat run scripts/deploy.ts --network $NETWORK_NAME | tee deployment.log

# Step 3: Get deployed contract addresses directly from logs
echo -e "${YELLOW}Extracting deployed addresses...${NC}"

# Extract addresses from deployment output
EIP712_UTILS_ADDRESS=$(grep -o "EIP712Utils deployed to: 0x[a-fA-F0-9]\{40\}" deployment.log | grep -o '0x[a-fA-F0-9]\{40\}')
BASIC_WALLET_ADDRESS=$(grep -o "BasicEncumberedWallet deployed to: 0x[a-fA-F0-9]\{40\}" deployment.log | grep -o '0x[a-fA-F0-9]\{40\}')
BLOCK_HASH_ORACLE_ADDRESS=$(grep -o "TrivialBlockHashOracle deployed to: 0x[a-fA-F0-9]\{40\}" deployment.log | grep -o '0x[a-fA-F0-9]\{40\}')
PROVETH_VERIFIER_ADDRESS=$(grep -o "ProvethVerifier deployed to: 0x[a-fA-F0-9]\{40\}" deployment.log | grep -o '0x[a-fA-F0-9]\{40\}')
TX_SERIALIZER_ADDRESS=$(grep -o "TransactionSerializer deployed to: 0x[a-fA-F0-9]\{40\}" deployment.log | grep -o '0x[a-fA-F0-9]\{40\}')
CONSTRAINED_POLICY_ADDRESS=$(grep -o "ConstrainedTransactionPolicy deployed to: 0x[a-fA-F0-9]\{40\}" deployment.log | grep -o '0x[a-fA-F0-9]\{40\}')
NFT_AUCTION_POLICY_ADDRESS=$(grep -o "NFTAuctionPolicy deployed to: 0x[a-fA-F0-9]\{40\}" deployment.log | grep -o '0x[a-fA-F0-9]\{40\}')
MESSAGE_POLICY_ADDRESS=$(grep -o "WalletConnectMessagePolicy deployed to: 0x[a-fA-F0-9]\{40\}" deployment.log | grep -o '0x[a-fA-F0-9]\{40\}')
OWNER_CONTROLS_ADDRESS=$(grep -o "NFTOwnerControls deployed to: 0x[a-fA-F0-9]\{40\}" deployment.log | grep -o '0x[a-fA-F0-9]\{40\}')
TX_POLICY_ADDRESS=$(grep -o "ConstrainedTransactionPolicy deployed to: 0x[a-fA-F0-9]\{40\}" deployment.log | grep -o '0x[a-fA-F0-9]\{40\}')
FACTORY_ADDRESS=$(grep -o "ApeLiquefactionWalletFactory deployed to: 0x[a-fA-F0-9]\{40\}" deployment.log | grep -o '0x[a-fA-F0-9]\{40\}')

# Verify all addresses were found
if [ -z "$EIP712_UTILS_ADDRESS" ] || [ -z "$BASIC_WALLET_ADDRESS" ] || [ -z "$BLOCK_HASH_ORACLE_ADDRESS" ] || \
   [ -z "$PROVETH_VERIFIER_ADDRESS" ] || [ -z "$TX_SERIALIZER_ADDRESS" ] || [ -z "$CONSTRAINED_POLICY_ADDRESS" ] || \
   [ -z "$OWNER_CONTROLS_ADDRESS" ] || [ -z "$TX_POLICY_ADDRESS" ] || [ -z "$MESSAGE_POLICY_ADDRESS" ]; then
  echo -e "${RED}ERROR: Failed to extract all contract addresses.${NC}"
  exit 1
fi

echo -e "${GREEN}Addresses extracted successfully:${NC}"
echo "EIP712Utils: $EIP712_UTILS_ADDRESS"
echo "BasicEncumberedWallet: $BASIC_WALLET_ADDRESS"
echo "TrivialBlockHashOracle: $BLOCK_HASH_ORACLE_ADDRESS"
echo "ProvethVerifier: $PROVETH_VERIFIER_ADDRESS"
echo "TransactionSerializer: $TX_SERIALIZER_ADDRESS"
echo "ConstrainedTransactionPolicy: $CONSTRAINED_POLICY_ADDRESS"
echo "NFTAuctionPolicy: $NFT_AUCTION_POLICY_ADDRESS"
echo "ApeLiquefactionWalletFactory: $FACTORY_ADDRESS"
echo "NFTOwnerControls: $OWNER_CONTROLS_ADDRESS"
echo "PublicTransactionPolicy: $TX_POLICY_ADDRESS"
echo "WalletConnectMessagePolicy: $MESSAGE_POLICY_ADDRESS"

# Step 4: Update environment variables
cd ..
echo -e "${YELLOW}Setting up environment...${NC}"

# Create or update .env.local
mkdir -p frontend
echo "NEXT_PUBLIC_NETWORK_ENV=$NETWORK_ENV" > frontend/.env.local
echo "NEXT_PUBLIC_EIP712_UTILS_ADDRESS=$EIP712_UTILS_ADDRESS" >> frontend/.env.local
echo "NEXT_PUBLIC_CONTRACT_ADDRESS=$BASIC_WALLET_ADDRESS" >> frontend/.env.local
echo "NEXT_PUBLIC_BLOCKHASH_ORACLE_ADDRESS=$BLOCK_HASH_ORACLE_ADDRESS" >> frontend/.env.local
echo "NEXT_PUBLIC_PROVETH_VERIFIER_ADDRESS=$PROVETH_VERIFIER_ADDRESS" >> frontend/.env.local
echo "NEXT_PUBLIC_TX_SERIALIZER_ADDRESS=$TX_SERIALIZER_ADDRESS" >> frontend/.env.local
echo "NEXT_PUBLIC_CONSTRAINED_POLICY_ADDRESS=$CONSTRAINED_POLICY_ADDRESS" >> frontend/.env.local
echo "NEXT_PUBLIC_NFT_AUCTION_POLICY_ADDRESS=$NFT_AUCTION_POLICY_ADDRESS" >> frontend/.env.local
echo "NEXT_PUBLIC_MESSAGE_POLICY_ADDRESS=$MESSAGE_POLICY_ADDRESS" >> frontend/.env.local
echo "NEXT_PUBLIC_FACTORY_ADDRESS=$FACTORY_ADDRESS" >> frontend/.env.local
echo "NEXT_PUBLIC_OWNER_CONTROLS_ADDRESS=$OWNER_CONTROLS_ADDRESS" >> frontend/.env.local
echo "NEXT_PUBLIC_TX_POLICY_ADDRESS=$TX_POLICY_ADDRESS" >> frontend/.env.local
echo "NEXT_PUBLIC_CLEAN_WALLETS=$(date +%s)" >> frontend/.env.local

# Copy any additional variables from root .env if it exists
if [ -f .env ]; then
  echo -e "${YELLOW}Copying variables from root .env file...${NC}"
  # Process each NEXT_PUBLIC_ variable in the .env file
  grep "^NEXT_PUBLIC_" .env | while read -r line; do
    # Extract the variable name (before the =)
    var_name=$(echo "$line" | cut -d= -f1)
    
    # Skip if the variable is already in frontend/.env.local
    if ! grep -q "^$var_name=" frontend/.env.local; then
      # Append the variable to frontend/.env.local
      echo "$line" >> frontend/.env.local
      echo -e "${GREEN}Added $var_name from root .env file${NC}"
    fi
  done
fi

# Step 5: Start block hash update script in the background
echo -e "${YELLOW}Starting block hash update script in the background...${NC}"
cd backend
npx hardhat run scripts/update-block-hashes.ts --network $NETWORK_NAME > block-hash-updates.log 2>&1 &
BLOCK_HASH_PID=$!
echo $BLOCK_HASH_PID > block-hash.pid
echo -e "${GREEN}Block hash update script started with PID: $BLOCK_HASH_PID${NC}"

# Step 6: Start frontend
echo -e "${GREEN}Environment set up complete. Starting frontend...${NC}"
cd ../frontend && npx next dev

# Cleanup function to be called on script exit
cleanup() {
  if [ -f backend/block-hash.pid ]; then
    echo -e "${YELLOW}Stopping block hash update script...${NC}"
    kill $(cat backend/block-hash.pid) 2>/dev/null || true
    rm backend/block-hash.pid
  fi
}

# Register cleanup function to be called on script exit
trap cleanup EXIT
