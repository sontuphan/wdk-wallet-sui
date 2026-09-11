export default class WalletManagerSui extends WalletManager {
    /**
     * Creates a new wallet manager for the sui blockchain.
     *
     * @param {string | Uint8Array} seed - The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase or seed bytes.
     * @param {SuiWalletConfig} [config] - The configuration object.
     * @throws {ValueError} If the seed is not valid.
     */
    constructor(seed: string | Uint8Array, config?: SuiWalletConfig);
    /**
     * A sui client to interact with a node of the blockchain.
     *
     * @protected
     * @type {SuiGrpcClient | undefined}
     */
    protected _client: SuiGrpcClient | undefined;
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
    getAccount(index?: number): Promise<WalletAccountSui>;
    /**
     * Returns the wallet account at a specific derivation path.
     *
     * @example
     * // Returns the account with derivation path m/44'/784'/0'/0'/1'
     * const account = await wallet.getAccountByPath("0'/0'/1'")
     * @param {string} path - The derivation path (e.g. "0'/0'/0'").
     * @returns {Promise<WalletAccountSui>} The account.
     */
    getAccountByPath(path: string): Promise<WalletAccountSui>;
}
export type FeeRates = import("@tetherto/wdk-wallet").FeeRates;
export type SuiGrpcClient = import("@mysten/sui/grpc").SuiGrpcClient;
export type SuiWalletConfig = import("./wallet-account-read-only-sui.js").SuiWalletConfig;
import WalletManager from '@tetherto/wdk-wallet';
import WalletAccountSui from './wallet-account-sui.js';
