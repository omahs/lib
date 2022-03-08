import { ChainAdapterManager } from '@shapeshiftoss/chain-adapters'
import { NativeAdapterArgs, NativeHDWallet } from '@shapeshiftoss/hdwallet-native'
import { ChainTypes } from '@shapeshiftoss/types'
import BigNumber from 'bignumber.js'
import dotenv from 'dotenv'
import readline from 'readline-sync'

import { FoxyApi } from './api'
import {
  foxContractAddress,
  foxyContractAddress,
  foxyStakingContractAddress,
  liquidityReserveContractAddress
} from './constants'

dotenv.config()

const { DEVICE_ID = 'device123', MNEMONIC } = process.env

const getWallet = async (): Promise<NativeHDWallet> => {
  if (!MNEMONIC) {
    throw new Error('Cannot init native wallet without mnemonic')
  }
  const nativeAdapterArgs: NativeAdapterArgs = {
    mnemonic: MNEMONIC,
    deviceId: DEVICE_ID
  }
  const wallet = new NativeHDWallet(nativeAdapterArgs)
  await wallet.initialize()

  return wallet
}

const main = async (): Promise<void> => {
  const unchainedUrls = {
    [ChainTypes.Ethereum]: {
      httpUrl: 'https://api.ethereum.shapeshift.com',
      wsUrl: 'wss://api.ethereum.shapeshift.com'
    }
  }
  const adapterManager = new ChainAdapterManager(unchainedUrls)
  const wallet = await getWallet()

  const api = new FoxyApi({
    adapter: adapterManager.byChain(ChainTypes.Ethereum), // adapter is an ETH @shapeshiftoss/chain-adapters
    providerUrl: 'http://127.0.0.1:8545'
  })

  const userAddress = await adapterManager.byChain(ChainTypes.Ethereum).getAddress({ wallet })
  console.info('talking from ', userAddress)

  const totalSupply = async () => {
    try {
      const supply = await api.totalSupply({ tokenContractAddress: foxyContractAddress })
      console.info('totalSupply', supply.toString())
    } catch (e) {
      console.error('Total Supply Error:', e)
    }
  }

  const stakingTokenBalance = async () => {
    try {
      const balance = await api.balance({
        tokenContractAddress: foxContractAddress,
        userAddress
      })
      console.info('balance', balance.toString())
    } catch (e) {
      console.error('Staking Balance Error:', e)
    }
  }

  const rewardTokenBalance = async () => {
    try {
      const balance = await api.balance({
        tokenContractAddress: foxyContractAddress,
        userAddress
      })
      console.info('balance', balance.toString())
    } catch (e) {
      console.error('Reward Balance Error:', e)
    }
  }

  const approve = async (tokenContractAddress: string, contractAddress: string) => {
    try {
      const approve = await api.approve({
        tokenContractAddress,
        contractAddress,
        userAddress,
        wallet
      })
      console.info('approve', approve)
    } catch (e) {
      console.error('Approve Error:', e)
    }
  }

  const stake = async (amount: string) => {
    try {
      console.info('staking...')
      const stake = await api.deposit({
        contractAddress: foxyStakingContractAddress,
        tokenContractAddress: foxContractAddress,
        amountDesired: new BigNumber(amount),
        userAddress,
        wallet
      })
      console.info('stake', stake)
    } catch (e) {
      console.error('Stake Error:', e)
    }
  }

  const unstake = async (amount: string) => {
    try {
      const unstake = await api.withdraw({
        contractAddress: foxyStakingContractAddress,
        tokenContractAddress: foxContractAddress,
        amountDesired: new BigNumber(amount),
        userAddress,
        wallet
      })
      console.info('unstake', unstake)
    } catch (e) {
      console.error('Unstake Error:', e)
    }
  }

  const instantUnstake = async () => {
    try {
      const deposit = await api.instantWithdraw({
        contractAddress: foxyStakingContractAddress,
        tokenContractAddress: foxContractAddress,
        userAddress,
        wallet
      })
      console.info('deposit', deposit)
    } catch (e) {
      console.error('Deposit Error:', e)
    }
  }

  const options = [
    'Approve StakingContract',
    'Approve LiquidityReserve',
    'Stake',
    'Unstake',
    'Instant Unstake',
    'Reward Token Balance',
    'Staking Token Balance',
    'Total Supply'
    // 'Circulating Supply (TVL),
    // 'Mine Blocks To Next Cycle',
    // 'Claim Withdraw'
  ]
  const contracts = ['Staking Token', 'Reward Token']

  let index = readline.keyInSelect(options, 'Select an action.\n')

  while (index !== -1) {
    let amount = '0'
    let tokenContract
    switch (index) {
      case 0:
        tokenContract = readline.keyInSelect(contracts, 'Which contract do you want to approve.\n')
        switch (tokenContract) {
          case 0:
            await approve(foxContractAddress, foxyStakingContractAddress)
            break
          case 1:
            await approve(foxyContractAddress, foxyStakingContractAddress)
            break
          default:
            break
        }
        break
      case 1:
        tokenContract = readline.keyInSelect(contracts, 'Which contract do you want to approve.\n')
        switch (tokenContract) {
          case 0:
            await approve(foxContractAddress, liquidityReserveContractAddress)
            break
          case 1:
            await approve(foxyContractAddress, liquidityReserveContractAddress)
            break
          default:
            break
        }
        break
      case 2:
        amount = readline.question('How much do you want to stake?\n')
        await stake(amount)
        break
      case 3:
        amount = readline.question('How much do you want to unstake?\n')
        await unstake(amount)
        break
      case 4:
        await instantUnstake()
        break
      case 5:
        await rewardTokenBalance()
        break
      case 6:
        await stakingTokenBalance()
        break
      case 7:
        await totalSupply()
        break
    }
    index = readline.keyInSelect(options, 'Select an action.\n')
  }
}

main().then(() => console.info('Exit'))
