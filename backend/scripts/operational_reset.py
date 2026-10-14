"""Operational reset — clears the old operating cycle from the PREVIEW database.
Approved by owner 2026-10-14 after verified backup at /app/backups/pre_reset_*.
Preserves: users, documents, agreements, settings, audit_logs, tickets, api_keys, staff_notes.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
from motor.motor_asyncio import AsyncIOMotorClient

RESET_COLLECTIONS = [
    "requests", "offers", "settlements", "transactions", "wallets", "ledger",
    "custody", "complaints", "job_events", "assignment_history", "cancellations",
    "attendance", "invoices", "payout_batches", "webhook_deliveries", "api_logs",
    "live_locations", "chat_messages", "notifications",
    "pricing_rules", "client_pricing",
]
PRESERVED = ["users", "documents", "agreements", "settings", "audit_logs",
             "tickets", "api_keys", "staff_notes", "pricing_history"]


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]
    print(f"DB: {db.name}")
    removed = {}
    for c in RESET_COLLECTIONS:
        res = await db[c].delete_many({})
        if res.deleted_count:
            removed[c] = res.deleted_count
    print("CLEARED:", removed)
    print("TOTAL_CLEARED:", sum(removed.values()))
    kept = {}
    for c in PRESERVED:
        kept[c] = await db[c].count_documents({})
    print("PRESERVED:", kept)
    w = await db.wallets.count_documents({})
    print("wallets after reset:", w)
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
