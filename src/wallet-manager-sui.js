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

import WalletManager, { ProviderRequiredError, ValueError } from '@tetherto/wdk-wallet'

import WalletAccountReadOnlySui, { toClientError } from './wallet-account-read-only-sui.js'
import WalletAccountSui from './wallet-account-sui.js'

/** @typedef {import('@tetherto/wdk-wallet').FeeRates} FeeRates */

/** @typedef {import('@mysten/sui/grpc').SuiGrpcClient} SuiGrpcClient */

/** @typedef {import('./wallet-account-read-only-sui.js').SuiWalletConfig} SuiWalletConfig */

// The share of the reference gas price a transaction bids to be picked up
// ahead of the ones paying the network's minimum.
const FEE_RATE_FAST_MULTIPLIER = 200n

export default class WalletManagerSui extends WalletManager {
  /**
   * Creates a new wallet manager for the sui blockchain.
   *
   * @param {string | Uint8Array} seed - The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase or seed bytes.
   * @param {SuiWalletConfig} [config] - The configuration object.
   * @throws {ValueError} If the seed is not valid.
   */
  constructor (seed, config = {}) {
    super(seed, config)

    if (!this.seed) {
      throw new ValueError('The wallet manager must be created from a seed.')
    }

    /**
     * The sui wallet configuration.
     *
     * @protected
     * @type {SuiWalletConfig}
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
   * Returns the wallet account at a specific index (see [SLIP-0010](https://github.com/satoshilabs/slips/blob/master/slip-0010.md)).
   *
   * @example
   * // Returns the account with derivation path m/44'/784'/1'/0'/0'
   * const account = await wallet.getAccount(1)
   * @param {number} [index] - The index of the account to get (default: 0).
   * @returns {Promise<WalletAccountSui>} The account.
   * @throws {ValueError} If the index is not valid.
   */
  async getAccount (index = 0) {
    if (!Number.isInteger(index) || index < 0) {
      throw new ValueError('The account index must be a non-negative integer.')
    }

    return await this.getAccountByPath(`${index}'/0'/0'`)
  }

  /**
   * Returns the wallet account at a specific derivation path.
   *
   * @example
   * // Returns the account with derivation path m/44'/784'/0'/0'/1'
   * const account = await wallet.getAccountByPath("0'/0'/1'")
   * @param {string} path - The derivation path (e.g. "0'/0'/0'").
   * @returns {Promise<WalletAccountSui>} The account.
   */
  async getAccountByPath (path) {
    if (!this._accounts[path]) {
      this._accounts[path] = new WalletAccountSui(this.seed, path, this._config)
    }

    return this._accounts[path]
  }

  /**
   * Returns the current fee rates.
   *
   * Sui prices gas in mists per gas unit, and the network sets a reference
   * price every epoch: a transaction paying it is executed, one bidding above
   * it is picked up first when validators are congested.
   *
   * @returns {Promise<FeeRates>} The fee rates (in mists per gas unit).
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   * @throws {ProviderError} If the provider fails to fetch the reference gas price.
   */
  async getFeeRates () {
    if (!this._client) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to get fee rates.')
    }

    let referenceGasPrice

    try {
      ({ referenceGasPrice } = await this._client.getReferenceGasPrice())
    } catch (error) {
      throw toClientError(error)
    }

    const normal = BigInt(referenceGasPrice)

    return {
      normal,
      fast: (normal * FEE_RATE_FAST_MULTIPLIER) / 100n
    }
  }
}
