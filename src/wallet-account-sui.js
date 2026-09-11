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

import { AssertionError, MaximumFeeExceededError, NotImplementedError, ProviderRequiredError, TransactionError, ValueError } from '@tetherto/wdk-wallet'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey, toSerializedSignature } from '@mysten/sui/cryptography'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'

import * as bip39 from 'bip39'

import WalletAccountReadOnlySui, { toTransactionError, toTransferError } from './wallet-account-read-only-sui.js'

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */
/** @typedef {import('@tetherto/wdk-wallet').KeyPair} KeyPair */
/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */

/** @typedef {import('@mysten/sui/cryptography').SignatureWithBytes} SignatureWithBytes */

/** @typedef {import('./wallet-account-read-only-sui.js').SuiTransaction} SuiTransaction */
/** @typedef {import('./wallet-account-read-only-sui.js').SuiTransferOptions} SuiTransferOptions */
/** @typedef {import('./wallet-account-read-only-sui.js').SuiWalletConfig} SuiWalletConfig */

// The SLIP-0044 coin-type prefix for sui. All path segments must be hardened:
// SLIP-0010 ed25519 derivation does not support non-hardened children.
const SLIP_0010_SUI_DERIVATION_PATH_PREFIX = "m/44'/784'"

/**
 * Tells a transaction that has already been signed from one that still has to
 * be.
 *
 * @param {*} tx - The transaction.
 * @returns {boolean} True if the transaction carries its bytes and signature.
 */
function isSignedTransaction (tx) {
  return typeof tx?.bytes === 'string' && typeof tx?.signature === 'string'
}

/**
 * Asserts that a user-supplied derivation path is exactly three hardened index
 * segments with no leading zeros, so that distinct path strings cannot alias
 * the same derived key (e.g. "00'" vs "0'"). The module prepends m/44'/784', so
 * a spec-compliant sui path (m/44'/784'/account'/change'/address') leaves
 * exactly three segments.
 *
 * @param {string} path - The derivation path.
 * @throws {ValueError} If the path is not three hardened, leading-zero-free index segments.
 */
function assertFullHardenedPath (path) {
  const segments = path.split('/')

  const isValid = segments.length === 3 && segments.every((segment) => /^(0|[1-9]\d*)'$/.test(segment))

  if (!isValid) {
    throw new ValueError('In sui, the derivation path must have exactly three hardened segments without leading zeros (e.g. "0\'/0\'/0\'").')
  }
}

/**
 * A sui wallet account. The read-only members are inherited from
 * {@link WalletAccountReadOnlySui}, this class adds the ones that need the
 * account's key.
 *
 * @implements {IWalletAccount<SignatureWithBytes>}
 */
export default class WalletAccountSui extends WalletAccountReadOnlySui {
  /**
   * Creates a new sui wallet account from a BIP-39 seed, deriving the account's
   * key at the given derivation path.
   *
   * @param {string | Uint8Array} seed - The BIP-39 seed phrase or raw seed bytes.
   * @param {string} path - The derivation path (e.g. "0'/0'/0'").
   * @param {SuiWalletConfig} [config] - The configuration object.
   * @throws {ValueError} If the seed or the path is not valid.
   */
  constructor (seed, path, config = {}) {
    if (typeof seed === 'string') {
      if (!bip39.validateMnemonic(seed)) {
        throw new ValueError('The seed phrase is invalid.')
      }

      seed = bip39.mnemonicToSeedSync(seed)
    }

    assertFullHardenedPath(path)

    const fullPath = `${SLIP_0010_SUI_DERIVATION_PATH_PREFIX}/${path}`

    const keypair = Ed25519Keypair.deriveKeypairFromSeed(seed, fullPath)

    const publicKey = keypair.getPublicKey()

    super(publicKey.toSuiAddress(), config)

    /**
     * The wallet account configuration.
     *
     * @protected
     * @type {SuiWalletConfig}
     */
    this._config = config

    /** @private */
    this._path = fullPath

    /**
     * The raw ed25519 private key (32 bytes), or undefined once the account has
     * been disposed. The signing keypair is rebuilt from it on demand, so the
     * account owns a single copy of the key material.
     *
     * @private
     * @type {Uint8Array | undefined}
     */
    this._rawPrivateKey = decodeSuiPrivateKey(keypair.getSecretKey()).secretKey

    /**
     * The raw ed25519 public key (32 bytes).
     *
     * @private
     * @type {Uint8Array}
     */
    this._rawPublicKey = publicKey.toRawBytes()

    /**
     * The read-only copy of this account, created on the first call to
     * {@link toReadOnlyAccount}.
     *
     * @private
     * @type {WalletAccountReadOnlySui | undefined}
     */
    this._suiReadOnlyAccount = undefined
  }

  /**
   * The derivation path's index of this account.
   *
   * @type {number}
   */
  get index () {
    const segments = this._path.split('/')

    return +segments[3].replace("'", '')
  }

  /**
   * The derivation path of this account (see [SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md)).
   *
   * @type {string}
   */
  get path () {
    return this._path
  }

  /**
   * The account's key pair.
   *
   * The uint8 arrays are bound to the wallet account, so any external change will reflect to the internal representation. For this reason,
   * it's strongly recommended to treat the key pair as a read-only view of the keys. While it's still technically possible to alter their
   * content, client code should never do so.
   *
   * @type {KeyPair}
   */
  get keyPair () {
    return {
      publicKey: this._rawPublicKey,
      privateKey: this._rawPrivateKey ?? null
    }
  }

  /**
   * Signs a message.
   *
   * The signature is serialized the way sui expects it, as the base64 of
   * `flag || signature || public key`, so it carries the key it is verified
   * against.
   *
   * @param {string} message - The message to sign.
   * @returns {Promise<string>} The message's signature.
   * @throws {AssertionError} If the account has been disposed.
   */
  async sign (message) {
    if (!this._rawPrivateKey) {
      throw new AssertionError('The wallet account has been disposed.')
    }

    const keypair = Ed25519Keypair.fromSecretKey(this._rawPrivateKey)

    const signature = await keypair.sign(new TextEncoder().encode(message))

    return toSerializedSignature({
      signature,
      signatureScheme: 'ED25519',
      publicKey: keypair.getPublicKey()
    })
  }

  /**
   * Signs a transaction.
   *
   * The transaction is resolved against the node first, so that what gets
   * signed is the transaction the node will execute, gas payment included.
   *
   * @param {SuiTransaction} tx - The transaction to sign.
   * @returns {Promise<SignatureWithBytes>} The signed transaction.
   * @throws {AssertionError} If the account has been disposed.
   */
  async signTransaction (tx) {
    if (!this._rawPrivateKey) {
      throw new AssertionError('The wallet account has been disposed.')
    }

    const transaction = await this._buildTransaction(tx)

    const keypair = Ed25519Keypair.fromSecretKey(this._rawPrivateKey)

    return await keypair.signTransaction(transaction)
  }

  /**
   * Quotes the costs of a send transaction operation.
   *
   * @param {SuiTransaction | SignatureWithBytes} tx - The transaction, signed or not.
   * @returns {Promise<Omit<TransactionResult, 'hash'>>} The transaction's quotes.
   */
  async quoteSendTransaction (tx) {
    if (isSignedTransaction(tx)) {
      tx = Transaction.from(fromBase64(tx.bytes))
    }

    return await super.quoteSendTransaction(tx)
  }

  /**
   * Sends a transaction.
   *
   * The transaction is signed if it isn't already, quoted, and only then
   * executed. The returned fee is the one the node charged, which the quote
   * doesn't know exactly.
   *
   * @param {SuiTransaction | SignatureWithBytes} tx - The transaction.
   * @returns {Promise<TransactionResult>} The transaction's result.
   * @throws {AssertionError} If the account has been disposed.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {ProviderError} If the provider fails to perform the transaction.
   * @throws {TransactionError} If the transaction fails to execute.
   * @throws {MaximumFeeExceededError} If the costs of the transaction exceed the transaction max. fee option.
   */
  async sendTransaction (tx) {
    if (!this._rawPrivateKey) {
      throw new AssertionError('The wallet account has been disposed.')
    }

    if (!this._client) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to send transactions.')
    }

    const signed = isSignedTransaction(tx) ? tx : await this.signTransaction(tx)

    const { fee } = await this.quoteSendTransaction(signed)

    if (this._config.transactionMaxFee !== undefined && fee > this._config.transactionMaxFee) {
      throw new MaximumFeeExceededError('Exceeded maximum fee cost for transaction operation.')
    }

    let result

    try {
      result = await this._client.core.executeTransaction({
        transaction: fromBase64(signed.bytes),
        signatures: [signed.signature],
        include: { effects: true }
      })
    } catch (error) {
      throw toTransactionError(error)
    }

    if (result.$kind === 'FailedTransaction') {
      const { digest, effects } = result.FailedTransaction

      throw new TransactionError(
        effects?.status?.error?.message ?? `The transaction '${digest}' failed to execute.`,
        { cause: result }
      )
    }

    const { digest, effects } = result.Transaction

    const { computationCost, storageCost, storageRebate } = effects.gasUsed

    return { hash: digest, fee: BigInt(computationCost) + BigInt(storageCost) - BigInt(storageRebate) }
  }

  /**
   * Transfers a token to another address.
   *
   * The transfer is signed once, so the transaction that is quoted against the
   * transfer's maximum fee is the one that executes.
   *
   * @param {SuiTransferOptions} options - The transfer's options.
   * @returns {Promise<TransferResult>} The transfer's result.
   * @throws {AssertionError} If the account has been disposed.
   * @throws {ProviderRequiredError} If the account is not connected to a provider.
   * @throws {TransferError} If the transfer fails to execute.
   * @throws {MaximumFeeExceededError} If the costs of the transfer exceed the transfer max. fee option.
   */
  async transfer (options) {
    if (!this._rawPrivateKey) {
      throw new AssertionError('The wallet account has been disposed.')
    }

    if (!this._client) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to transfer tokens.')
    }

    try {
      const tx = await this._getTransferTransaction(options)

      const signed = await this.signTransaction(tx)

      const { fee } = await this.quoteSendTransaction(signed)

      if (this._config.transferMaxFee !== undefined && fee > this._config.transferMaxFee) {
        throw new MaximumFeeExceededError('Exceeded maximum fee cost for transfer operation.')
      }

      const result = await this.sendTransaction(signed)

      return result
    } catch (error) {
      throw toTransferError(error)
    }
  }

  /**
   * Returns a read-only copy of the account.
   *
   * The copy is created once and reused, so that the account doesn't open a
   * connection to the provider on every call.
   *
   * @returns {Promise<WalletAccountReadOnlySui>} The read-only account.
   */
  async toReadOnlyAccount () {
    if (!this._suiReadOnlyAccount) {
      const address = await this.getAddress()

      this._suiReadOnlyAccount = new WalletAccountReadOnlySui(address, this._config)
    }

    return this._suiReadOnlyAccount
  }

  /**
   * Disposes the wallet account, erasing the private key from the memory.
   */
  dispose () {
    throw new NotImplementedError('dispose()')
  }
}
