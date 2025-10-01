import toast from "react-hot-toast";
import { EIP155_CHAINS, TEIP155Chain } from "@/data/EIP155Data";
import { ethers } from "ethers";
import bs58 from "bs58";

/**
 * Truncates string (in the middle) via given lenght value
 */
export function truncate(value: string, length: number) {
  if (value?.length <= length) {
    return value;
  }

  const separator = "...";
  const stringLength = length - separator.length;
  const frontLength = Math.ceil(stringLength / 2);
  const backLength = Math.floor(stringLength / 2);

  return (
    value.substring(0, frontLength) +
    separator +
    value.substring(value.length - backLength)
  );
}

/**
 * Converts hex to utf8 string if it is valid bytes
 */
export function convertHexToUtf8(value: string) {
  if (ethers.isHexString(value)) {
    return ethers.toUtf8String(value);
  }

  return value;
}

/**
 * Gets message from various signing request methods by filtering out
 * a value that is not an address (thus is a message).
 * If it is a hex string, it gets converted to utf8 string
 */
export function getSignParamsMessage(params: string[]) {
  console.log("params", params);
  const message = params.filter((p) => !ethers.isAddress(p))[0];

  return convertHexToUtf8(message);
}

/**
 * Gets data from various signTypedData request methods by filtering out
 * a value that is not an address (thus is data).
 * If data is a string convert it to object
 */
export function getSignTypedDataParamsData(params: string[]) {
  console.log("params", params);
  const data = params.filter((p) => !ethers.isAddress(p))[0];

  if (typeof data === "string") {
    const obj = JSON.parse(data);
    console.log("Final data obj:", obj);
    return obj;
  }

  return data;
}

/**
 * Get our address from params checking if params string contains one
 * of our wallet addresses
 */
export function getWalletAddressFromParams(addresses: string[], params: any) {
  const paramsString = JSON.stringify(params);
  let address = "";
  console.log("paramsString", paramsString);
  addresses.forEach((addr) => {
    console.log("addr", addr);
    if (paramsString.toLowerCase().includes(addr.toLowerCase())) {
      address = addr;
    }
  });

  return address;
}

/**
 * Check if chain is part of EIP155 standard
 */
export function isEIP155Chain(chain: string) {
  return chain.includes("eip155");
}

/**
 * Formats chainId to its name
 */
export function formatChainName(chainId: string) {
  return EIP155_CHAINS[chainId as TEIP155Chain]?.name ?? chainId;
}

export function styledToast(message: string, type: string) {
  if (type === "success") {
    toast.success(message, {
      position: "bottom-left",
      style: {
        borderRadius: "10px",
        background: "#333",
        color: "#fff",
      },
    });
  } else if (type === "error") {
    toast.error(message, {
      position: "bottom-left",
      style: {
        borderRadius: "10px",
        background: "#333",
        color: "#fff",
      },
    });
  }
}

export const decodeDIDToSecp256k1PublicKey = (did: string): string => {
  // Check if the DID starts with the correct prefix
  if (!did.startsWith("did:key:zQ3s")) {
    throw new Error('Invalid DID format. Must start with "did:key:zQ3s"');
  }

  // Extract the Base58 encoded part
  const encodedPart = did.slice("did:key:zQ3s".length);

  // Decode the Base58 string
  const decodedBuffer = bs58.decode(encodedPart);

  // Convert the Buffer to a hex string
  const publicKey = Buffer.from(decodedBuffer).toString("hex");

  // Add the '0x' prefix
  return "0x" + publicKey;
};

export enum KEY_TYPES {
  secp256k1 = "secp256k1",
  secp256r1 = "secp256r1",
  ed25519 = "ed25519",
  x25519 = "x25519",
  rsa = "rsa",
  "p-384" = "p-384",
  "p-521" = "p-521",
}

export const decodeDIDToPublicKey = (
  did: string,
): {
  key: `0x${string}`;
  keyType: KEY_TYPES;
} => {
  // Define the DID prefix to key type mapping
  const didPrefixToKeyType: Record<string, KEY_TYPES> = {
    "did:key:zQ3s": KEY_TYPES.secp256k1,
    "did:key:zDn": KEY_TYPES.secp256r1,
    "did:key:z6Mk": KEY_TYPES.ed25519,
    "did:key:z6LS": KEY_TYPES.x25519,
    "did:key:z4MX": KEY_TYPES.rsa,
    "did:key:z82L": KEY_TYPES["p-384"],
    "did:key:z2J9": KEY_TYPES["p-521"],
  };

  // Find the matching key type prefix
  const matchingPrefix = Object.keys(didPrefixToKeyType).find((prefix) =>
    did.startsWith(prefix),
  );

  if (!matchingPrefix) {
    throw new Error("Invalid DID format. Unsupported key type.");
  }

  // Extract the Base58 encoded part
  const encodedPart = did.slice(matchingPrefix.length);

  // Decode the Base58 string
  const decodedBuffer = bs58.decode(encodedPart);

  // Convert the Buffer to a hex string
  const publicKey = Buffer.from(decodedBuffer).toString("hex");

  // Add the '0x' prefix
  const formattedPublicKey = `0x${publicKey}` as `0x${string}`;

  // Get the key type
  const keyType = didPrefixToKeyType[matchingPrefix];

  return {
    key: formattedPublicKey,
    keyType,
  };
};

export function bigIntReplacer(_key: string, value: any) {
  if (typeof value === "bigint") {
    return value.toString();
  }

  return value;
}
