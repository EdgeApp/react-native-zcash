use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::wallet;

fn err(msg: impl ToString) -> Error {
    Error::from_reason(msg.to_string())
}

fn map<T>(value: wallet::WalletResult<T>) -> Result<T> {
    value.map_err(err)
}

#[napi(object)]
pub struct JsAddresses {
    pub unified_address: String,
    pub sapling_address: String,
    pub transparent_address: String,
}

#[napi(object)]
pub struct JsBalance {
    pub transparent_available_zatoshi: String,
    pub transparent_total_zatoshi: String,
    pub sapling_available_zatoshi: String,
    pub sapling_total_zatoshi: String,
    pub orchard_available_zatoshi: String,
    pub orchard_total_zatoshi: String,
    pub ironwood_available_zatoshi: String,
    pub ironwood_total_zatoshi: String,
}

#[napi(object)]
pub struct JsTransaction {
    pub raw_transaction_id: String,
    pub block_time_in_seconds: i64,
    pub mined_height: i64,
    pub value: String,
    pub fee: Option<String>,
    pub to_address: Option<String>,
    pub is_shielding: bool,
    pub is_expired: bool,
    pub memos: Vec<String>,
}

#[napi(object)]
pub struct JsPoll {
    pub alias: String,
    pub status: String,
    pub scan_progress: f64,
    pub network_block_height: u32,
    pub balances: JsBalance,
    pub transactions: Vec<JsTransaction>,
}

impl From<wallet::Addresses> for JsAddresses {
    fn from(value: wallet::Addresses) -> Self {
        Self {
            unified_address: value.unified_address,
            sapling_address: value.sapling_address,
            transparent_address: value.transparent_address,
        }
    }
}

impl From<wallet::Balance> for JsBalance {
    fn from(value: wallet::Balance) -> Self {
        Self {
            transparent_available_zatoshi: value.transparent_available_zatoshi,
            transparent_total_zatoshi: value.transparent_total_zatoshi,
            sapling_available_zatoshi: value.sapling_available_zatoshi,
            sapling_total_zatoshi: value.sapling_total_zatoshi,
            orchard_available_zatoshi: value.orchard_available_zatoshi,
            orchard_total_zatoshi: value.orchard_total_zatoshi,
            ironwood_available_zatoshi: value.ironwood_available_zatoshi,
            ironwood_total_zatoshi: value.ironwood_total_zatoshi,
        }
    }
}

impl From<wallet::Transaction> for JsTransaction {
    fn from(value: wallet::Transaction) -> Self {
        Self {
            raw_transaction_id: value.raw_transaction_id,
            block_time_in_seconds: value.block_time_in_seconds,
            mined_height: value.mined_height,
            value: value.value,
            fee: value.fee,
            to_address: value.to_address,
            is_shielding: value.is_shielding,
            is_expired: value.is_expired,
            memos: value.memos,
        }
    }
}

impl From<wallet::Poll> for JsPoll {
    fn from(value: wallet::Poll) -> Self {
        Self {
            alias: value.alias,
            status: value.status,
            scan_progress: value.scan_progress,
            network_block_height: value.network_block_height,
            balances: value.balances.into(),
            transactions: value.transactions.into_iter().map(Into::into).collect(),
        }
    }
}

#[napi]
pub fn set_document_directory(path: String) -> Result<()> {
    map(wallet::set_document_directory(path))
}

#[napi]
pub async fn initialize(
    mnemonic_seed: String,
    birthday_height: u32,
    alias: String,
    network_name: String,
    default_host: String,
    default_port: u32,
    new_wallet: bool,
) -> Result<()> {
    map(wallet::initialize(
        mnemonic_seed,
        birthday_height,
        alias,
        network_name,
        default_host,
        default_port,
        new_wallet,
    )
    .await)
}

#[napi]
pub async fn stop(alias: String) -> Result<String> {
    map(wallet::stop(alias).await)
}

#[napi]
pub async fn rescan(alias: String) -> Result<()> {
    map(wallet::rescan(alias).await)
}

#[napi]
pub async fn derive_unified_address(alias: String) -> Result<JsAddresses> {
    map(wallet::derive_unified_address(alias).await).map(Into::into)
}

#[napi]
pub async fn get_latest_network_height(alias: String) -> Result<u32> {
    map(wallet::get_latest_network_height(alias).await)
}

#[napi]
pub async fn get_birthday_height(host: String, port: u32) -> Result<u32> {
    map(wallet::get_birthday_height(host, port).await)
}

#[napi]
pub fn is_valid_address(address: String, network: String) -> bool {
    wallet::is_valid_address(address, network)
}

#[napi]
pub fn derive_viewing_key(mnemonic_seed: String, network: String) -> Result<String> {
    map(wallet::derive_viewing_key(mnemonic_seed, network))
}

#[napi]
pub fn ironwood_activation_height(network: String) -> Option<u32> {
    wallet::ironwood_activation_height(network)
}

#[napi]
pub async fn poll(alias: String) -> Result<JsPoll> {
    map(wallet::poll(alias).await).map(Into::into)
}

#[napi]
pub async fn propose_transfer(
    alias: String,
    zatoshi: String,
    to_address: String,
    memo: Option<String>,
) -> Result<String> {
    map(wallet::propose_transfer(alias, zatoshi, to_address, memo).await)
}

#[napi]
pub async fn create_transfer(
    alias: String,
    proposal_base64: String,
    mnemonic_seed: String,
) -> Result<String> {
    map(wallet::create_transfer(alias, proposal_base64, mnemonic_seed).await)
}

#[napi]
pub async fn broadcast_transfer(alias: String, txid: String) -> Result<String> {
    map(wallet::broadcast_transfer(alias, txid).await)
}

#[napi]
pub async fn shield_funds(
    alias: String,
    seed: String,
    memo: String,
    threshold: String,
) -> Result<String> {
    map(wallet::shield_funds(alias, seed, memo, threshold).await)
}

#[napi]
pub async fn propose_orchard_to_ironwood_migration(alias: String) -> Result<String> {
    map(wallet::propose_orchard_to_ironwood_migration(alias).await)
}

#[napi]
pub async fn propose_fulfilling_payment_uri(alias: String, payment_uri: String) -> Result<String> {
    map(wallet::propose_fulfilling_payment_uri(alias, payment_uri).await)
}

#[napi]
pub async fn emit_existing_transactions(alias: String) -> Result<()> {
    map(wallet::emit_existing_transactions(alias).await)
}
