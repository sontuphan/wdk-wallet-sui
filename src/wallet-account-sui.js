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

import { AssertionError, NotImplementedError, ValueError } from '@tetherto/wdk-wallet'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey, toSerializedSignature } from '@mysten/sui/cryptography'

import * as bip39 from 'bip39'

import WalletAccountReadOnlySui from './wallet-account-read-only-sui.js'

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
   * @param {SuiTransaction} tx - The transaction to sign.
   * @returns {Promise<SignatureWithBytes>} The signed transaction.
   * @throws {ValueError} If the transaction is not valid.
   */
  async signTransaction (tx) {
    throw new NotImplementedError('signTransaction(tx)')
  }

  /**
   * Sends a transaction.
   *
   * @param {SuiTransaction | SignatureWithBytes} tx - The transaction.
   * @returns {Promise<TransactionResult>} The transaction's result.
   * @throws {ValueError} If the transaction is not valid.
   * @throws {ProviderRequiredError} If the method requires a provider.
   * @throws {ProviderError} If the provider fails to perform the transaction.
   * @throws {TransactionError} If the transaction fails with an error.
   * @throws {MaximumFeeExceededError} If the costs of the transaction exceed the transaction max. fee option.
   */
  async sendTransaction (tx) {
    throw new NotImplementedError('sendTransaction(tx)')
  }

  /**
   * Transfers a token to another address.
   *
   * @param {SuiTransferOptions} options - The transfer's options.
   * @returns {Promise<TransferResult>} The transfer's result.
   * @throws {ValueError} If the transfer options are not valid.
   * @throws {ProviderRequiredError} If the method requires a provider.
   * @throws {ProviderError} If the provider fails to perform the transfer.
   * @throws {TransferError} If the transfer fails with an error.
   * @throws {MaximumFeeExceededError} If the costs of the transfer exceed the transfer max. fee option.
   */
  async transfer (options) {
    throw new NotImplementedError('transfer(options)')
  }

  /**
   * Returns a read-only copy of the account.
   *
   * @returns {Promise<WalletAccountReadOnlySui>} The read-only account.
   */
  async toReadOnlyAccount () {
    throw new NotImplementedError('toReadOnlyAccount()')
  }

  /**
   * Disposes the wallet account, erasing the private key from the memory.
   */
  dispose () {
    throw new NotImplementedError('dispose()')
  }
}
