// Copyright 2024 Tether Operations Limited
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import { WalletAccountReadOnly } from '@tetherto/wdk-wallet'

import { SuiGrpcClient } from '@mysten/sui/grpc'
import { coinWithBalance, Transaction } from '@mysten/sui/transactions'
import { verifyPersonalMessageSignature, verifySignature } from '@mysten/sui/verify'
import { parseSerializedSignature } from '@mysten/sui/cryptography'

/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */

/** @typedef {import('@mysten/sui/client').SuiClientTypes.Network} Network */
/** @typedef {import('@mysten/sui/grpc').SuiGrpcClient} SuiGrpcClient */
/** @typedef {import('@mysten/sui/transactions').Transaction} Transaction */

/**
 * @typedef {Object} NativeSuiTransaction
 * @property {string} to - The transaction's recipient.
 * @property {number | bigint} value - The amount of suis to send to the recipient (in mists).
 */

/**
 * @typedef {NativeSuiTransaction | Transaction} SuiTransaction
 */

/**
 * @typedef {Object} SuiTransferOptions
 * @property {string} token - The address of the token to transfer.
 * @property {string} recipient - The address of the recipient.
 * @property {number | bigint} amount - The amount of tokens to transfer to the recipient (in base units).
 */

/**
 * @typedef {Object} SuiWalletConfig
 * @property {string} [rpcUrl] - The provider's rpc url.
 * @property {Network} [network] - The name of the network to use (default: "mainnet").
 * @property {number | bigint} [transferMaxFee] - The maximum fee amount for transfer operations.
 */

export default class WalletAccountReadOnlySui extends WalletAccountReadOnly {
  /**
   * Creates a new sui read-only wallet account.
   *
   * @param {string} address - The account's address.
   * @param {Omit<SuiWalletConfig, 'transferMaxFee'>} [config] - The configuration object.
   */
  constructor (address, config = { }) {
    super(address)

    /**
     * The read-only wallet account configuration.
     *
     * @protected
     * @type {Omit<SuiWalletConfig, 'transferMaxFee'>}
     */
    this._config = config

    /**
     * A sui client to interact with a node of the blockchain.
     *
     * @protected
     * @type {SuiGrpcClient | undefined}
     */
    this._client = undefined

    if (this._config.rpcUrl) {
      this._client = new SuiGrpcClient({
        network: config.network || 'mainnet',
        baseUrl: config.rpcUrl
      })
    }
  }

  /**
   * The account's address.
   *
   * @type {string}
   */
  get address () {
    return this._address
  }

  /**
   * Returns the account's sui balance.
   *
   * @returns {Promise<bigint>} The sui balance (in mists).
   */
  async getBalance () {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to retrieve balances.')
    }

    const address = await this.getAddress()

    const { balance: { balance } } = await this._client.getBalance({ owner: address })

    return BigInt(balance)
  }

  /**
   * Returns the account balance for a specific token.
   *
   * @param {string} coinType - The coin type (e.g. '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT').
   * @returns {Promise<bigint>} The token balance (in base unit).
   */
  async getTokenBalance (coinType) {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to retrieve token balances.')
    }

    const address = await this.getAddress()

    const { balance: { balance } } = await this._client.getBalance({ owner: address, coinType })

    return BigInt(balance)
  }

  /**
   * Quotes the costs of a send transaction operation.
   *
   * @param {SuiTransaction} tx - The transaction.
   * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
   */
  async quoteSendTransaction (tx) {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to quote send transaction operations.')
    }

    if (!(tx instanceof Transaction)) {
      const address = await this.getAddress()

      const nativeTx = new Transaction()

      nativeTx.setSender(address)

      const [coin] = nativeTx.splitCoins(nativeTx.gas, [tx.value])

      nativeTx.transferObjects([coin], tx.to)

      tx = nativeTx
    }

    const {
      Transaction: {
        effects: {
          gasUsed: { computationCost, storageCost, storageRebate }
        }
      }
    } = await this._client.core.simulateTransaction({
      transaction: await tx.build({ client: this._client }),
      include: { effects: true }
    })

    return { fee: BigInt(computationCost) + BigInt(storageCost) - BigInt(storageRebate) }
  }

  /**
   * Quotes the costs of a transfer operation.
   *
   * @param {SuiTransferOptions} options - The transfer's options.
   * @returns {Promise<Omit<TransferResult, 'hash'>>} The transfer's quotes.
   */
  async quoteTransfer (options) {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to quote transfer operations.')
    }

    const address = await this.getAddress()

    const tx = new Transaction()

    tx.setSender(address)

    tx.transferObjects(
      [coinWithBalance({ balance: options.amount, type: options.token })],
      options.recipient
    )

    const result = await this.quoteSendTransaction(tx)

    return result
  }

  /**
   * Returns a transaction's receipt.
   *
   * @param {string} hash - The transaction's hash.
   * @returns {Promise<*>} – The receipt, or null if the transaction has not been included in a block yet.
   */
  async getTransactionReceipt (hash) {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to fetch transaction receipts.')
    }

    const { response } = await this._client.getTransaction({ digest: hash })

    return response
  }

  /**
   * Returns the current allowance for the given token and spender.
   * @param {string} token The token's address.
   * @param {string} spender The spender's address.
   * @returns {Promise<bigint>} The allowance.
   */
  async getAllowance (token, spender) {
    if (!this._client) {
      throw new Error('The wallet must be connected to a provider to retrieve allowances.')
    }

    const address = await this.getAddress()

    return 0n
  }

  /**
   * Verifies a message's signature.
   *
   * @param {string} message - The original message.
   * @param {string} signature - The signature to verify.
   * @returns {Promise<boolean>} True if the signature is valid.
   */
  async verify (message, signature) {
    const address = await this.getAddress()

    const { serializedSignature } = parseSerializedSignature(signature)

    try {
      const pubkey = await verifySignature(new TextEncoder().encode(message), serializedSignature)
      return address === pubkey.toSuiAddress()
    } catch {
      return false
    }
  }

  /**
   * Verifies a personal message's signature.
   *
   * @param {string} message - The personal message.
   * @param {string} signature - The signature to verify.
   * @returns {Promise<boolean>} True if the signature is valid.
   */
  async verifyPersonalMessage (message, signature) {
    const address = await this.getAddress()

    const { serializedSignature } = parseSerializedSignature(signature)

    try {
      const pubkey = await verifyPersonalMessageSignature(new TextEncoder().encode(message), serializedSignature)
      return address === pubkey.toSuiAddress()
    } catch {
      return false
    }
  }
}
