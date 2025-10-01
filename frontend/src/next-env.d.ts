/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/basic-features/typescript for more information.

declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_PROJECT_ID: string;
    NEXT_PUBLIC_RELAY_URL: string;
    NEXT_PUBLIC_CONTRACT_ADDRESS: string;
    NEXT_PUBLIC_CLEAN_WALLETS: string;
  }
}
