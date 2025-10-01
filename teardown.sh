#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Liquefaction Demo Teardown ===${NC}"

# Find and stop any running Oasis containers
echo -e "${YELLOW}Stopping any running Oasis blockchain containers...${NC}"
CONTAINERS=$(docker ps -q --filter ancestor=ghcr.io/oasisprotocol/sapphire-localnet)

if [ -z "$CONTAINERS" ]; then
  echo -e "${YELLOW}No running Oasis containers found.${NC}"
else
  echo -e "${YELLOW}Stopping containers: ${CONTAINERS}${NC}"
  docker stop $CONTAINERS
  echo -e "${GREEN}Containers stopped.${NC}"
fi

# Clean up deployments folder
echo -e "${YELLOW}Cleaning up deployments folder...${NC}"
rm -rf backend/ignition/deployments
echo -e "${GREEN}Deployments folder removed.${NC}"

echo -e "${GREEN}Teardown complete. Your environment is reset.${NC}" 