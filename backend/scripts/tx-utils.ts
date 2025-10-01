import { ethers, type Transaction } from "ethers";

export interface Type2Transaction {
  chainId: bigint;
  nonce: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  gasLimit: bigint;
  destination: string;
  amount: bigint;
  payload: string;
}

export function convertTransaction(ttx: Type2Transaction): Transaction {
  const transaction = {
    chainId: ttx.chainId,
    nonce: Number(ttx.nonce),
    maxPriorityFeePerGas: ttx.maxPriorityFeePerGas,
    maxFeePerGas: ttx.maxFeePerGas,
    gasLimit: ttx.gasLimit,
    to: ttx.destination,
    value: ttx.amount,
    data: ttx.payload,
  };

  const ethersTx = ethers.Transaction.from({ ...transaction, type: 2 });
  return ethersTx;
}

export function convertTransaction2(ttx: any[]): Transaction {
  const transaction = {
    chainId: ttx[0],
    nonce: Number(ttx[1]),
    maxPriorityFeePerGas: ttx[2],
    maxFeePerGas: ttx[3],
    gasLimit: ttx[4],
    to: ttx[5],
    value: ttx[6],
    data: ttx[7],
  };

  const ethersTx = ethers.Transaction.from({ ...transaction, type: 2 });
  return ethersTx;
}
