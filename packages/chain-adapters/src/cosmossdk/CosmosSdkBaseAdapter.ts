import { AssetId, ChainId } from '@shapeshiftoss/caip'
import { CosmosSignTx } from '@shapeshiftoss/hdwallet-core'
import { BIP44Params, KnownChainIds } from '@shapeshiftoss/types'
import * as unchained from '@shapeshiftoss/unchained-client'
import { bech32 } from 'bech32'

import { ChainAdapter as IChainAdapter } from '../api'
import { ErrorHandler } from '../error/ErrorHandler'
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
  ValidAddressResult,
  ValidAddressResultType,
} from '../types'
import { toRootDerivationPath } from '../utils'
import { cosmos } from './'

const CHAIN_TO_BECH32_PREFIX_MAPPING = {
  [KnownChainIds.CosmosMainnet]: 'cosmos',
  [KnownChainIds.OsmosisMainnet]: 'osmo',
}

const transformValidator = (validator: unchained.cosmos.Validator): cosmos.Validator => ({
  address: validator.address,
  moniker: validator.moniker,
  tokens: validator.tokens,
  commission: validator.commission.rate,
  apr: validator.apr,
})

export const cosmosSdkChainIds = [
  KnownChainIds.CosmosMainnet,
  KnownChainIds.OsmosisMainnet,
] as const

export type CosmosSdkChainId = typeof cosmosSdkChainIds[number]

export interface ChainAdapterArgs {
  chainId?: CosmosSdkChainId
  coinName: string
  providers: {
    http: unchained.cosmos.V1Api | unchained.osmosis.V1Api
    ws: unchained.ws.Client<unchained.cosmos.Tx> | unchained.ws.Client<unchained.osmosis.Tx>
  }
}

export interface CosmosSdkBaseAdapterArgs extends ChainAdapterArgs {
  defaultBIP44Params: BIP44Params
  supportedChainIds: Array<ChainId>
  chainId: CosmosSdkChainId
}

export abstract class CosmosSdkBaseAdapter<T extends CosmosSdkChainId> implements IChainAdapter<T> {
  protected readonly chainId: CosmosSdkChainId
  protected readonly coinName: string
  protected readonly defaultBIP44Params: BIP44Params
  protected readonly supportedChainIds: Array<ChainId>
  protected readonly providers: {
    http: unchained.cosmos.V1Api | unchained.osmosis.V1Api
    ws: unchained.ws.Client<unchained.cosmos.Tx> | unchained.ws.Client<unchained.osmosis.Tx>
  }

  protected assetId: AssetId
  protected parser: unchained.cosmos.TransactionParser

  protected constructor(args: CosmosSdkBaseAdapterArgs) {
    this.chainId = args.chainId
    this.coinName = args.coinName
    this.defaultBIP44Params = args.defaultBIP44Params
    this.supportedChainIds = args.supportedChainIds
    this.providers = args.providers

    if (!this.supportedChainIds.includes(this.chainId)) {
      throw new Error(`${this.chainId} not supported. (supported: ${this.supportedChainIds})`)
    }
  }

  abstract getType(): T
  abstract getFeeAssetId(): AssetId
  abstract getDisplayName(): string
  abstract buildSendTransaction(tx: BuildSendTxInput<T>): Promise<{ txToSign: ChainTxType<T> }>
  abstract getAddress(input: GetAddressInput): Promise<string>
  abstract getFeeData(input: Partial<GetFeeDataInput<T>>): Promise<FeeDataEstimate<T>>
  abstract signTransaction(signTxInput: SignTxInput<ChainTxType<T>>): Promise<string>
  abstract signAndBroadcastTransaction(signTxInput: SignTxInput<CosmosSignTx>): Promise<string>

  getChainId(): ChainId {
    return this.chainId
  }

  buildBIP44Params(params: Partial<BIP44Params>): BIP44Params {
    return { ...this.defaultBIP44Params, ...params }
  }

  async getAccount(pubkey: string): Promise<Account<T>> {
    try {
      const { data } = await this.providers.http.getAccount({ pubkey })

      const delegations = data.delegations.map<cosmos.Delegation>((delegation) => ({
        assetId: this.assetId,
        amount: delegation.balance.amount,
        validator: transformValidator(delegation.validator),
      }))

      const redelegations = data.redelegations.map<cosmos.Redelegation>((redelegation) => ({
        destinationValidator: transformValidator(redelegation.destinationValidator),
        sourceValidator: transformValidator(redelegation.sourceValidator),
        entries: redelegation.entries.map<cosmos.RedelegationEntry>((entry) => ({
          assetId: this.assetId,
          completionTime: Number(entry.completionTime),
          amount: entry.balance,
        })),
      }))

      const undelegations = data.unbondings.map<cosmos.Undelegation>((undelegation) => ({
        validator: transformValidator(undelegation.validator),
        entries: undelegation.entries.map<cosmos.UndelegationEntry>((entry) => ({
          assetId: this.assetId,
          completionTime: Number(entry.completionTime),
          amount: entry.balance.amount,
        })),
      }))

      const rewards = data.rewards.map<cosmos.ValidatorReward>((validatorReward) => ({
        validator: transformValidator(validatorReward.validator),
        rewards: validatorReward.rewards.map<cosmos.Reward>((reward) => ({
          assetId: this.assetId,
          amount: reward.amount,
        })),
      }))

      return {
        balance: data.balance,
        chainId: this.chainId,
        assetId: this.assetId,
        chain: this.getType(),
        chainSpecific: {
          accountNumber: data.accountNumber.toString(),
          delegations,
          redelegations,
          undelegations,
          rewards,
          sequence: data.sequence.toString(),
        },
        pubkey: data.pubkey,
        /* TypeScript can't guarantee the correct type for the chainSpecific field because of the generic return type.
           It is preferable to define and type the return instead of applying the cast below, but that's left as an exercise
           for the reader. */
      } as Account<T>
    } catch (err) {
      return ErrorHandler(err)
    }
  }

  async getTxHistory(input: TxHistoryInput): Promise<TxHistoryResponse> {
    try {
      const { data } = await this.providers.http.getTxHistory({
        pubkey: input.pubkey,
        pageSize: input.pageSize,
        cursor: input.cursor,
      })

      const txs = await Promise.all(
        data.txs.map(async (tx) => {
          const parsedTx = await this.parser.parse(tx, input.pubkey)

          return {
            address: input.pubkey,
            blockHash: parsedTx.blockHash,
            blockHeight: parsedTx.blockHeight,
            blockTime: parsedTx.blockTime,
            chainId: parsedTx.chainId,
            chain: this.getType(),
            confirmations: parsedTx.confirmations,
            txid: parsedTx.txid,
            fee: parsedTx.fee,
            status: parsedTx.status,
            trade: parsedTx.trade,
            transfers: parsedTx.transfers.map((transfer) => ({
              assetId: transfer.assetId,
              from: transfer.from,
              to: transfer.to,
              type: transfer.type,
              value: transfer.totalValue,
            })),
            data: parsedTx.data,
          }
        }),
      )

      return {
        cursor: data.cursor,
        pubkey: input.pubkey,
        transactions: txs,
      }
    } catch (err) {
      return ErrorHandler(err)
    }
  }

  async broadcastTransaction(hex: string): Promise<string> {
    try {
      const { data } = await this.providers.http.sendTx({ body: { rawTx: hex } })
      return data
    } catch (err) {
      return ErrorHandler(err)
    }
  }

  async validateAddress(address: string): Promise<ValidAddressResult> {
    const chain = this.getType()
    try {
      const { prefix } = bech32.decode(address)

      if (CHAIN_TO_BECH32_PREFIX_MAPPING[chain] !== prefix) {
        throw new Error(`Invalid address ${address} for ChainId: ${chain}`)
      }

      return {
        valid: true,
        result: ValidAddressResultType.Valid,
      }
    } catch (err) {
      console.error(err)
      return { valid: false, result: ValidAddressResultType.Invalid }
    }
  }

  async subscribeTxs(
    input: SubscribeTxsInput,
    onMessage: (msg: Transaction) => void,
    onError: (err: SubscribeError) => void,
  ): Promise<void> {
    const { wallet, bip44Params = this.defaultBIP44Params } = input

    const address = await this.getAddress({ wallet, bip44Params })
    const subscriptionId = toRootDerivationPath(bip44Params)

    await this.providers.ws.subscribeTxs(
      subscriptionId,
      { topic: 'txs', addresses: [address] },
      async (msg) => {
        const tx = await this.parser.parse(msg.data, msg.address)

        onMessage({
          address: tx.address,
          blockHash: tx.blockHash,
          blockHeight: tx.blockHeight,
          blockTime: tx.blockTime,
          chainId: tx.chainId,
          confirmations: tx.confirmations,
          fee: tx.fee,
          status: tx.status,
          trade: tx.trade,
          transfers: tx.transfers.map((transfer) => ({
            assetId: transfer.assetId,
            from: transfer.from,
            to: transfer.to,
            type: transfer.type,
            value: transfer.totalValue,
          })),
          txid: tx.txid,
        })
      },
      (err) => onError({ message: err.message }),
    )
  }

  unsubscribeTxs(input?: SubscribeTxsInput): void {
    if (!input) return this.providers.ws.unsubscribeTxs()

    const { bip44Params = this.defaultBIP44Params } = input
    const subscriptionId = toRootDerivationPath(bip44Params)

    this.providers.ws.unsubscribeTxs(subscriptionId, { topic: 'txs', addresses: [] })
  }

  closeTxs(): void {
    this.providers.ws.close('txs')
  }

  async getValidators(): Promise<Array<cosmos.Validator>> {
    try {
      const { data } = await this.providers.http.getValidators()
      return data.validators.map<cosmos.Validator>((validator) => transformValidator(validator))
    } catch (err) {
      return ErrorHandler(err)
    }
  }

  async getValidator(address: string): Promise<cosmos.Validator> {
    try {
      const { data: validator } = await this.providers.http.getValidator({ pubkey: address })
      return transformValidator(validator)
    } catch (err) {
      return ErrorHandler(err)
    }
  }
}
