import { ethers } from "ethers";
import {
  type BigNumberish,
  type BytesLike,
  type TypedDataDomain,
  type TypedDataField,
} from "ethers";

type EIP712Domain = {
  name?: string | null;
  version?: string | null;
  chainId?: BigNumberish | null;
  verifyingContract?: string | null;
  salt?: BytesLike | null;
};

type EIP712DomainParameters = {
  name: string;
  version: string;
  chainId: BigNumberish;
  verifyingContract: string;
  salt: BytesLike;
  usedParamsMask: number;
};

export type PopulatedTypedData = {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  primaryType: string;
  message: Record<string, any>;
};

export function getDomainParams(domain: EIP712Domain): EIP712DomainParameters {
  let usedParamsMask: number = 0;
  const domainParameterNames: (keyof EIP712Domain)[] = [
    "name",
    "version",
    "chainId",
    "verifyingContract",
    "salt",
  ];
  for (const [i, domainParameterName] of domainParameterNames.entries()) {
    if (
      Object.keys(domain).includes(domainParameterName) &&
      domain[domainParameterName] !== undefined &&
      domain[domainParameterName] !== null
    ) {
      usedParamsMask |= 1 << i;
    }
  }

  return {
    name: domain.name ?? "",
    version: domain.version ?? "",
    chainId: domain.chainId ?? 0n,
    verifyingContract:
      domain.verifyingContract ?? "0x0000000000000000000000000000000000000000",
    salt:
      domain.salt ??
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    usedParamsMask,
  };
}

export function getTypedDataParams(typedData: PopulatedTypedData): {
  typeString: string;
  encodedData: string;
  domainParams: EIP712DomainParameters;
} {
  const typedDataEnc = ethers.TypedDataEncoder.from(typedData.types);
  const typeString = typedDataEnc.encodeType(typedData.primaryType);
  const encodedData = ethers.dataSlice(
    typedDataEnc.encodeData(typedData.primaryType, typedData.message),
    32,
  );
  const domainParameters = getDomainParams(typedData.domain);
  return {
    typeString,
    encodedData,
    domainParams: domainParameters,
  };
}

export function filterUnusedTypes(
  typedData: Record<string, TypedDataField[]>,
  primaryType: string,
): Record<string, TypedDataField[]> {
  // Helper function to extract base type from array type
  const getBaseType = (type: string): string => {
    if (type.endsWith("[]")) {
      return type.slice(0, -2);
    }
    return type;
  };

  // Function to get all used types recursively
  const getUsedTypes = (type: string, visited: Set<string>): Set<string> => {
    // Built-in type as specified by EIP-712
    const builtIn =
      /^(bytes\d+|uint\d{1,3}|int\d{1,3}|bool|address|bytes|string)(\[\d*\])?$/;
    if (builtIn.test(type)) {
      return visited;
    }

    if (visited.has(type)) {
      return visited;
    }
    visited.add(type);

    if (!typedData[type]) {
      return visited;
    }

    for (const def of typedData[type]) {
      const baseType = getBaseType(def.type);
      if (baseType !== type) {
        // Avoid self-reference loops
        getUsedTypes(baseType, visited);
      }
    }

    return visited;
  };

  // Get all used types for the primary type
  const usedTypes = getUsedTypes(primaryType, new Set<string>());
  usedTypes.add(primaryType); // Ensure the primary type itself is included

  // Filter the types object to include only used types
  const filteredTypes: Record<string, TypedDataField[]> = {};
  for (const type of usedTypes) {
    filteredTypes[type] = typedData[type];
  }

  return filteredTypes;
}
