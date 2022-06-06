import { AssetId, ChainId } from '@shapeshiftoss/caip'
import { BIP44Params, SupportedChainIds, UtxoAccountType } from '@shapeshiftoss/types'

import {
  Account,
  BuildSendTxInput,
  ChainTxType,
  FeeDataEstimate,
  GetAddressInput,
  GetFeeDataInput,
  SignTxInput,
  SubscribeError,
  SubscribeTxsInput,
  Transaction,
  TxHistoryInput,
  TxHistoryResponse,
  ValidAddressResult
} from './types'

export type ChainAdapter<T extends SupportedChainIds> = {
  /**
   * Get type of adapter
   */
  getType(): T

  getChainId(): ChainId

  /**
   * Base fee asset used to pay for txs on a given chain
   */
  getFeeAssetId(): AssetId

  /**
   * Get the supported account types for an adapter
   * For UTXO coins, that's the list of UTXO account types
   * For other networks, this is unimplemented, and left as a responsibility of the consumer.
   */
  getSupportedAccountTypes?(): Array<UtxoAccountType>
  /**
   * Get the balance of an address
   */
  getAccount(pubkey: string): Promise<Account<T>>

  buildBIP44Params(params: Partial<BIP44Params>): BIP44Params

  getTxHistory(input: TxHistoryInput): Promise<TxHistoryResponse<T>>

  buildSendTransaction(input: BuildSendTxInput<T>): Promise<{
    txToSign: ChainTxType<T>
  }>

  getAddress(input: GetAddressInput): Promise<string>

  signTransaction(signTxInput: SignTxInput<ChainTxType<T>>): Promise<string>

  signAndBroadcastTransaction?(signTxInput: SignTxInput<ChainTxType<T>>): Promise<string>

  getFeeData(input: Partial<GetFeeDataInput<T>>): Promise<FeeDataEstimate<T>>

  broadcastTransaction(hex: string): Promise<string>

  validateAddress(address: string): Promise<ValidAddressResult>

  subscribeTxs(
    input: SubscribeTxsInput,
    onMessage: (msg: Transaction<T>) => void,
    onError?: (err: SubscribeError) => void
  ): Promise<void>

  unsubscribeTxs(input?: SubscribeTxsInput): void

  closeTxs(): void
}
