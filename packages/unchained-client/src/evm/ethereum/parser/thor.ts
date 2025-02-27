import { ChainId } from '@shapeshiftoss/caip'
import { ethers } from 'ethers'

import { Tx } from '../../../generated/ethereum'
import { BaseTxMetadata, Dex, TradeType } from '../../../types'
import { getSigHash, SubParser, txInteractsWithContract, TxSpecific } from '../../parser'
import THOR_ABI from './abi/thor'
import { THOR_ROUTER_CONTRACT_MAINNET, THOR_ROUTER_CONTRACT_ROPSTEN } from './constants'

const SWAP_TYPES = ['SWAP', '=', 's']

export interface TxMetadata extends BaseTxMetadata {
  parser: 'thor'
}

export interface ParserArgs {
  chainId: ChainId
  rpcUrl: string
}

export class Parser implements SubParser<Tx> {
  readonly routerContract: string
  readonly abiInterface = new ethers.utils.Interface(THOR_ABI)

  readonly supportedFunctions = {
    depositSigHash: this.abiInterface.getSighash('deposit'),
    transferOutSigHash: this.abiInterface.getSighash('transferOut'),
  }

  constructor(args: ParserArgs) {
    // TODO: Router contract can change, use /inbound_addresses endpoint to determine current router contract.
    // We will also need to know all past router contract addresses if we intend on using receive address as the means for detection
    this.routerContract = (() => {
      switch (args.chainId) {
        case 'eip155:1':
          return THOR_ROUTER_CONTRACT_MAINNET
        case 'eip155:3':
          return THOR_ROUTER_CONTRACT_ROPSTEN
        default:
          throw new Error('chainId is not supported. (supported chainIds: eip155:1, eip155:3)')
      }
    })()
  }

  async parse(tx: Tx): Promise<TxSpecific | undefined> {
    if (!txInteractsWithContract(tx, this.routerContract)) return
    if (!tx.inputData) return

    const txSigHash = getSigHash(tx.inputData)

    if (!Object.values(this.supportedFunctions).some((hash) => hash === txSigHash)) return

    const decoded = this.abiInterface.parseTransaction({ data: tx.inputData })

    // failed to decode input data
    if (!decoded) return

    const data: TxMetadata = {
      method: decoded.name,
      parser: 'thor',
    }

    const [type] = decoded.args.memo.split(':')

    if (SWAP_TYPES.includes(type) || type === 'OUT') {
      return { trade: { dexName: Dex.Thor, type: TradeType.Trade, memo: decoded.args.memo }, data }
    }

    if (type === 'REFUND') {
      return { trade: { dexName: Dex.Thor, type: TradeType.Refund, memo: decoded.args.memo }, data }
    }

    // memo type not supported
    return
  }
}
