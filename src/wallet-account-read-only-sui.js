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

import { NoSuchElementError, ProviderError, ProviderErrorReason, ProviderRequiredError, TransactionError, TransactionErrorReason, TransferError, TransferErrorReason, ValueError, WalletAccountReadOnly, WdkError } from '@tetherto/wdk-wallet'

import FailoverProvider from '@tetherto/wdk-failover-provider'

import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport'

import { SimulationError } from '@mysten/sui/client'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { coinWithBalance, isTransaction, Transaction } from '@mysten/sui/transactions'
import { verifyPersonalMessageSignature, verifySignature } from '@mysten/sui/verify'
import { parseSerializedSignature } from '@mysten/sui/cryptography'
import { isValidTransactionDigest } from '@mysten/sui/utils'

/** @typedef {import('@tetherto/wdk-wallet').TransactionReceipt} TransactionReceipt */
/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */

/** @typedef {import('@mysten/sui/client').SuiClientTypes.Network} Network */
/** @typedef {import('@protobuf-ts/runtime-rpc').RpcTransport} RpcTransport */
/** @typedef {import('@mysten/sui/grpc').GrpcTypes.ExecutedTransaction} ExecutedTransaction */

/**
 * @typedef {Object} SimpleSuiTransaction
 * @property {string} to - The transaction's recipient.
 * @property {number | bigint} value - The amount of suis to send to the recipient (in mists).
 */

/**
 * @typedef {SimpleSuiTransaction | Transaction} SuiTransaction
 */

/**
 * @typedef {Object} SuiTransferOptions
 * @property {string} token - The address of the token to transfer.
 * @property {string} recipient - The address of the recipient.
 * @property {number | bigint} amount - The amount of tokens to transfer to the recipient (in base units).
 */

/**
 * @typedef {Object} SuiWalletConfig
 * @property {string | string[]} [rpcUrl] - The provider's rpc url. An array enables failover.
 * @property {RpcTransport | RpcTransport[]} [transport] - A grpc transport to talk to the provider through, used instead of the one built from `rpcUrl`. An array enables failover.
 * @property {number} [retries] - The number of failover retry attempts when more than one provider is given (default: 3).
 * @property {Network} [network] - The name of the network to use (default: "mainnet").
 * @property {number | bigint} [transactionMaxFee] - The maximum fee amount for sending transactions.
 * @property {number | bigint} [transferMaxFee] - The maximum fee amount for transfer operations.
 */

/**
 * The sui fields added to a normalized transaction receipt.
 *
 * @typedef {Object} SuiReceiptFields
 * @property {boolean} success - The execution's result. Always known, since a sui transaction is only observable once executed.
 * @property {bigint} fee - The gas cost (in mists).
 * @property {bigint} [checkpoint] - The sequence number of the checkpoint including the transaction, as returned by the node.
 * @property {number} [timestamp] - The unix timestamp of the checkpoint including the transaction (in milliseconds).
 * @property {ExecutedTransaction} receipt - The native executed transaction.
 */

/**
 * A sui transaction receipt: the normalized, cross-chain fields plus sui's native ones.
 *
 * @typedef {TransactionReceipt & SuiReceiptFields} SuiTransactionReceipt
 */

/**
 * Decodes a grpc status message. Grpc-web percent-encodes it to keep it
 * ASCII-only on the wire, and the transport hands it over still encoded.
 *
 * @param {string} message - The status message, as received.
 * @returns {string} The decoded message, or the message itself if it carries a percent sign that isn't a valid escape.
 */
function decodeStatusMessage (message) {
  try {
    return decodeURIComponent(message)
  } catch {
    return message
  }
}

/**
 * The provider error reason matching each grpc status code.
 *
 * @type {Record<string, string>}
 */
const PROVIDER_ERROR_REASONS = {
  UNAUTHENTICATED: ProviderErrorReason.UNAUTHORIZED,
  PERMISSION_DENIED: ProviderErrorReason.FORBIDDEN,
  DEADLINE_EXCEEDED: ProviderErrorReason.REQUEST_TIMEOUT,
  INTERNAL: ProviderErrorReason.INTERNAL_SERVER_ERROR,
  UNAVAILABLE: ProviderErrorReason.NETWORK_ERROR
}

/**
 * The message of the errors reporting that the account cannot cover the amount
 * it is about to send. Neither the node nor the sdk gives them a code of their
 * own, so they are recognised by their message.
 *
 * @type {RegExp}
 */
const INSUFFICIENT_BALANCE_MESSAGE = /insufficient (sui )?balance|insufficientcoinbalance/i

/**
 * The message of the errors reporting that the account doesn't hold enough of
 * the token being transferred, as opposed to not holding enough sui.
 *
 * @type {RegExp}
 */
const INSUFFICIENT_TOKEN_BALANCE_MESSAGE = /^insufficient balance of/i

/**
 * Turns an error raised while resolving, simulating or executing a transaction
 * into the matching wallet development kit error.
 *
 * @param {Error} error - The error thrown by the sdk.
 * @returns {ValueError | ProviderError | TransactionError} The wallet development kit error.
 */
export function toTransactionError (error) {
  if (INSUFFICIENT_BALANCE_MESSAGE.test(error?.message)) {
    return new TransactionError(error.message, { reason: TransactionErrorReason.INSUFFICIENT_BALANCE, cause: error })
  }

  // Resolving runs the transaction against the node, so a provider failure arrives wrapped.
  const status = 'code' in error ? error : error.cause

  if (status instanceof Error && 'code' in status) {
    return toClientError(status)
  }

  if (error instanceof SimulationError) {
    return new TransactionError(error.message, { cause: error })
  }

  return new ValueError(error?.message ?? 'The transaction is not valid.', { cause: error })
}

/**
 * Turns an error raised while quoting or performing a transfer into the
 * matching wallet development kit error. A transaction that cannot execute is
 * reported as the transfer it was carrying out.
 *
 * @param {Error} error - The error raised by the transfer.
 * @returns {WdkError} The wallet development kit error.
 */
export function toTransferError (error) {
  if (error instanceof TransactionError) {
    let reason

    if (INSUFFICIENT_TOKEN_BALANCE_MESSAGE.test(error.message)) {
      reason = TransferErrorReason.INSUFFICIENT_TOKEN_BALANCE
    } else if (error.reason === TransactionErrorReason.INSUFFICIENT_BALANCE) {
      reason = TransferErrorReason.INSUFFICIENT_BALANCE
    }

    return new TransferError(error.message, { reason, cause: error })
  }

  if (error instanceof WdkError) {
    return error
  }

  return new ValueError(error?.message ?? 'The transfer options are not valid.', { cause: error })
}

/**
 * Turns an error thrown by the grpc client into the matching wallet development
 * kit error. An invalid argument is rejected on the caller's behalf and never
 * reaches the ledger, so it is reported as a value error rather than as a
 * failure of the provider.
 *
 * @param {Error} error - The error thrown by the grpc client.
 * @returns {ValueError | ProviderError} The wallet development kit error.
 */
export function toClientError (error) {
  const message = decodeStatusMessage(error?.message ?? 'The provider failed to answer the request.')

  const code = 'code' in error ? String(error.code) : ''

  if (code === 'INVALID_ARGUMENT') {
    return new ValueError(message, { cause: error })
  }

  return new ProviderError(message, {
    reason: PROVIDER_ERROR_REASONS[code] || ProviderErrorReason.NETWORK_ERROR,
    cause: error
  })
}

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
    this._client = WalletAccountReadOnlySui.createClient(config)
  }

  /**
   * Creates the client a wallet talks to a node through.
   *
   * Several providers are served behind a failover transport, so a call that a
   * node fails to answer is retried against the next one. Failing over at the
   * transport covers every request the sdk makes, including the ones it sends
   * through its own service clients.
   *
   * @param {SuiWalletConfig} config - The configuration object.
   * @returns {SuiGrpcClient | undefined} The client, or undefined if the configuration names no provider.
   */
  static createClient (config) {
    const { network = 'mainnet', retries = 3 } = config

    const provider = config.transport ?? config.rpcUrl

    if (Array.isArray(provider)) {
      if (provider.length > 0) {
        const failoverProvider = new FailoverProvider({ retries })

        for (const entry of provider) {
          const option = typeof entry === 'string'
            ? new GrpcWebFetchTransport({ baseUrl: entry })
            : entry

          // Merging per candidate keeps a retry from reusing the base url of the provider that failed.
          failoverProvider.addProvider({
            mergeOptions: (options) => options ?? { },
            unary: (method, input, options) => option.unary(method, input, option.mergeOptions(options))
          })
        }

        return new SuiGrpcClient({ network, transport: failoverProvider.initialize() })
      }
    } else if (provider) {
      const transport = typeof provider === 'string'
        ? new GrpcWebFetchTransport({ baseUrl: provider })
        : provider

      return new SuiGrpcClient({ network, transport })
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
   * The poll cadence of {@link waitForTransaction}, in milliseconds.
   *
   * Mainnet produces a checkpoint about every 200 milliseconds, so a
   * transaction that has executed is reported final within roughly a second.
   *
   * @type {number}
   */
  get defaultWaitInterval () {
    return 500
  }

  /**
   * The time budget of {@link waitForTransaction}, in milliseconds.
   *
   * A sui transaction is either executed or rejected when it is submitted, with
   * no mempool to wait in, so a digest the node still doesn't know after this
   * long is not going to land.
   *
   * @type {number}
   */
  get defaultWaitTimeout () {
    return 30_000
  }

  /**
   * Returns the account's sui balance.
   *
   * @returns {Promise<bigint>} The sui balance (in mists).
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the provider fails to fetch the balance.
   */
  async getBalance () {
    if (!this._client) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to retrieve balances.')
    }

    const address = await this.getAddress()

    try {
      const { balance: { balance } } = await this._client.getBalance({ owner: address })

      return BigInt(balance)
    } catch (error) {
      throw toClientError(error)
    }
  }

  /**
   * Returns the account balance for a specific token.
   *
   * @param {string} coinType - The coin type (e.g. '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT').
   * @returns {Promise<bigint>} The token balance (in base unit).
   * @throws {ValueError} If the coin type is not valid.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the provider fails to fetch the balance.
   */
  async getTokenBalance (coinType) {
    if (!this._client) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to retrieve token balances.')
    }

    const address = await this.getAddress()

    try {
      const { balance: { balance } } = await this._client.getBalance({ owner: address, coinType })

      return BigInt(balance)
    } catch (error) {
      throw toClientError(error)
    }
  }

  /**
   * Quotes the costs of a send transaction operation.
   *
   * @param {SuiTransaction} tx - The transaction.
   * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
   * @throws {ValueError} If the transaction is not valid.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the provider fails to estimate the costs of the transaction.
   * @throws {TransactionError} If the transaction fails to execute.
   */
  async quoteSendTransaction (tx) {
    if (!this._client) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to quote send transaction operations.')
    }

    const transaction = await this._buildTransaction(tx)

    let result

    try {
      result = await this._client.core.simulateTransaction({
        transaction,
        include: { effects: true }
      })
    } catch (error) {
      throw toTransactionError(error)
    }

    if (result.$kind === 'FailedTransaction') {
      const { effects } = result.FailedTransaction

      throw new TransactionError(effects?.status?.error?.message ?? 'The transaction failed to execute.', { cause: result })
    }

    const { computationCost, storageCost, storageRebate } = result.Transaction.effects?.gasUsed ?? { }

    if ([computationCost, storageCost, storageRebate].some((cost) => cost == null)) {
      throw new ProviderError('The provider did not report the gas used by the transaction.', {
        reason: ProviderErrorReason.INTERNAL_SERVER_ERROR
      })
    }

    return { fee: BigInt(computationCost) + BigInt(storageCost) - BigInt(storageRebate) }
  }

  /**
   * Quotes the costs of a transfer operation.
   *
   * @param {SuiTransferOptions} options - The transfer's options.
   * @returns {Promise<Omit<TransferResult, 'hash'>>} The transfer's quotes.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {TransferError} If the transfer fails to execute.
   */
  async quoteTransfer (options) {
    if (!this._client) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to quote transfer operations.')
    }

    try {
      const tx = await this._getTransferTransaction(options)

      const result = await this.quoteSendTransaction(tx)

      return result
    } catch (error) {
      throw toTransferError(error)
    }
  }

  /**
   * Returns a transaction's receipt.
   *
   * @deprecated Use {@link getTransaction} instead, which returns a normalized, finality-based receipt. The native receipt stays available on the `receipt` field of its return value.
   * @param {string} hash - The transaction's digest.
   * @returns {Promise<ExecutedTransaction | null>} The receipt, or null if the transaction has not been executed yet.
   * @throws {ValueError} If the digest is not valid.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the provider fails to fetch the transaction's receipt.
   */
  async getTransactionReceipt (hash) {
    if (!this._client) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to fetch transaction receipts.')
    }

    if (!isValidTransactionDigest(hash)) {
      throw new ValueError(`'${hash}' is not a valid transaction digest.`)
    }

    let response

    try {
      ({ response } = await this._client.ledgerService.getTransaction({
        digest: hash,
        readMask: { paths: ['digest', 'signatures', 'checkpoint', 'timestamp', 'effects', 'balance_changes'] }
      }))
    } catch (error) {
      if (error?.code === 'NOT_FOUND') {
        return null
      }

      throw toClientError(error)
    }

    return response.transaction || null
  }

  /**
   * Returns a normalized, finality-based receipt for a transaction.
   *
   * A sui transaction is only observable once it has been executed, and it
   * cannot be reverted afterwards: it is reported as `confirmed` as soon as the
   * node returns its effects, and as `final` once it is part of a checkpoint.
   * Sui has no mempool, so `pending` and `dropped` are never reported: a digest
   * the node cannot resolve yet is reported as a missing transaction.
   *
   * @param {string} hash - The transaction's digest.
   * @returns {Promise<SuiTransactionReceipt>} The normalized receipt.
   * @throws {ValueError} If the digest is not valid.
   * @throws {NoSuchElementError} If no transaction has been found for the given digest.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the provider fails to fetch the transaction.
   */
  async getTransaction (hash) {
    if (!this._client) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to fetch transactions.')
    }

    if (!isValidTransactionDigest(hash)) {
      throw new ValueError(`'${hash}' is not a valid transaction digest.`)
    }

    let response

    try {
      ({ response } = await this._client.ledgerService.getTransaction({
        digest: hash,
        readMask: { paths: ['digest', 'checkpoint', 'timestamp', 'effects.status', 'effects.gas_used'] }
      }))
    } catch (error) {
      if (error?.code === 'NOT_FOUND') {
        throw new NoSuchElementError(`No transaction found for the digest '${hash}'.`, { cause: error })
      }

      throw toClientError(error)
    }

    const transaction = response.transaction

    if (!transaction) {
      throw new NoSuchElementError(`No transaction found for the digest '${hash}'.`)
    }

    const { checkpoint, timestamp, effects } = transaction

    const {
      computationCost = 0n,
      storageCost = 0n,
      storageRebate = 0n
    } = effects?.gasUsed || { }

    return {
      hash: transaction.digest || hash,
      finality: checkpoint === undefined ? 'confirmed' : 'final',
      success: Boolean(effects?.status?.success),
      block: checkpoint === undefined ? undefined : Number(checkpoint),
      fee: computationCost + storageCost - storageRebate,
      checkpoint,
      timestamp: timestamp === undefined ? undefined : Number(timestamp.seconds) * 1000 + Math.floor(timestamp.nanos / 1e6),
      receipt: transaction
    }
  }

  /**
   * Verifies a message's signature.
   *
   * @param {string} message - The original message.
   * @param {string} signature - The signature to verify.
   * @returns {Promise<boolean>} True if the signature is valid.
   * @throws {ValueError} If the signature is not correctly encoded.
   */
  async verify (message, signature) {
    const address = await this.getAddress()

    let serializedSignature

    try {
      ({ serializedSignature } = parseSerializedSignature(signature))
    } catch (error) {
      throw new ValueError(error?.message ?? 'The signature is not valid.', { cause: error })
    }

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
   * @throws {ValueError} If the signature is not correctly encoded.
   */
  async verifyPersonalMessage (message, signature) {
    const address = await this.getAddress()

    let serializedSignature

    try {
      ({ serializedSignature } = parseSerializedSignature(signature))
    } catch (error) {
      throw new ValueError(error?.message ?? 'The signature is not valid.', { cause: error })
    }

    try {
      const pubkey = await verifyPersonalMessageSignature(new TextEncoder().encode(message), serializedSignature)
      return address === pubkey.toSuiAddress()
    } catch {
      return false
    }
  }

  /**
   * Builds the transaction a transfer is carried out with.
   *
   * @protected
   * @param {SuiTransferOptions} options - The transfer's options.
   * @returns {Promise<Transaction>} The transfer's transaction.
   * @throws {ValueError} If the transfer options are not valid.
   */
  async _getTransferTransaction (options) {
    const address = await this.getAddress()

    const tx = new Transaction()

    tx.setSender(address)

    tx.transferObjects(
      [coinWithBalance({ balance: options.amount, type: options.token })],
      options.recipient
    )

    return tx
  }

  /**
   * Resolves a transaction into the bytes that are simulated, signed and
   * executed.
   *
   * A {@link SimpleSuiTransaction} is first turned into the sui send it
   * describes, and a transaction that doesn't name its sender is sent from this
   * account, which sets the sender on the given transaction.
   *
   * Resolving is a round trip to the provider rather than a local encoding
   * step: the node runs the transaction to pick the gas coins and set the gas
   * price and budget, which is why a transaction that cannot execute is
   * reported here.
   *
   * @protected
   * @param {SuiTransaction} tx - The transaction.
   * @returns {Promise<Uint8Array>} The bcs-encoded transaction.
   * @throws {ValueError} If the transaction is not valid.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the provider fails to resolve the transaction.
   * @throws {TransactionError} If the transaction cannot execute.
   */
  async _buildTransaction (tx) {
    if (!this._client) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to build transactions.')
    }

    const address = await this.getAddress()

    try {
      if (!isTransaction(tx)) {
        const nativeTx = new Transaction()

        const [coin] = nativeTx.splitCoins(nativeTx.gas, [tx.value])

        nativeTx.transferObjects([coin], tx.to)

        tx = nativeTx
      }

      tx.setSenderIfNotSet(address)

      return await tx.build({ client: this._client })
    } catch (error) {
      throw toTransactionError(error)
    }
  }
}
