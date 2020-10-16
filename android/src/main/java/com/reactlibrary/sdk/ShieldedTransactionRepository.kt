package com.reactlibrary.sdk

import android.content.Context
import androidx.room.Room
import androidx.room.RoomDatabase
import cash.z.ecc.android.sdk.db.DerivedDataDb
import cash.z.ecc.android.sdk.ext.ZcashSdk
import cash.z.ecc.android.sdk.transaction.PagedTransactionRepository


open class ShieldedTransactionRepository : PagedTransactionRepository {

    private val shieldedDataDb: ShieldedTransactionDb

    constructor(db: ShieldedTransactionDb, size: Int = 10): super(db, size) {
        shieldedDataDb = db
    }

    /**
     * Constructor that creates the database.
     */
    constructor(
        context: Context,
        pageSize: Int = 10,
        dataDbName: String = ZcashSdk.DB_DATA_NAME
    ) : this(
        Room.databaseBuilder(context, ShieldedTransactionDb::class.java, dataDbName)
            .setJournalMode(RoomDatabase.JournalMode.TRUNCATE)
            .addMigrations(DerivedDataDb.MIGRATION_3_4)
            .addMigrations(DerivedDataDb.MIGRATION_4_3)
            .addMigrations(DerivedDataDb.MIGRATION_4_5)
            .build(),
        pageSize
    )

    fun blockCount(): Int {
        return shieldedDataDb.shieldedTransactionDao().countBlocks()
    }
}
