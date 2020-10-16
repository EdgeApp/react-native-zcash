package com.reactlibrary.sdk

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Query
import cash.z.ecc.android.sdk.db.DerivedDataDb
import cash.z.ecc.android.sdk.db.TransactionDao
import cash.z.ecc.android.sdk.db.entity.*

//
// Database
//


@Database(
    entities = [
        TransactionEntity::class,
        Block::class,
        Received::class,
        Account::class,
        Sent::class
    ],
    version = 5,
    exportSchema = true
)
abstract class ShieldedTransactionDb : DerivedDataDb() {
    abstract fun shieldedTransactionDao(): ShieldedTransactionDao
}

@Dao
interface ShieldedTransactionDao : TransactionDao {
    @Query("SELECT COUNT(height) FROM blocks")
    fun countBlocks(): Int
}
