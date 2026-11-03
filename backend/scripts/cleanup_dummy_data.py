"""Dummy/test data cleanup — removes demo + test accounts and their orphaned records.
Keep-list: admin account + owner's real business and worker accounts.
Preview DB only. Backup verified before running: /app/backups/pre_cleanup_*.
"""
import asyncio
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
from motor.motor_asyncio import AsyncIOMotorClient

KEEP_PHONES = {"+966530534184", "+966593603404"}  # owner business + worker accounts
TEST_NAME = re.compile(r"iter\d|test|dummy|تجريبي|اختبار|نزاع|16[a-d]?\s|demo", re.I)
TEST_PHONE = re.compile(r"^\+9665(5\d{7}|530\d{5}|540\d{5}|720\d{5}|501\d{4}|711\d{4})$")


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]

    keep_ids, delete_ids, deleted_summary = set(), [], {}
    async for u in db.users.find({}, {"name": 1, "phone": 1, "role": 1, "is_demo": 1}):
        if u["role"] == "admin" or u.get("phone") in KEEP_PHONES:
            keep_ids.add(u["_id"])
            continue
        delete_ids.append(u["_id"])
        deleted_summary[u["role"]] = deleted_summary.get(u["role"], 0) + 1

    res = await db.users.delete_many({"_id": {"$in": delete_ids}})
    print(f"USERS DELETED: {res.deleted_count} by role: {deleted_summary}")
    print(f"USERS KEPT: {len(keep_ids)}")

    # orphaned records referencing deleted users
    orphan_map = [
        ("agreements", "office_id"), ("api_keys", "business_id"), ("tickets", "user_id"),
        ("documents", "worker_id"), ("wallets", "user_id"), ("staff_notes", "user_id"),
        ("login_attempts", None),
    ]
    for coll, field in orphan_map:
        if field:
            res = await db[coll].delete_many({field: {"$nin": list(keep_ids)}})
        else:
            res = await db[coll].delete_many({})
        if res.deleted_count:
            print(f"ORPHANS {coll}: {res.deleted_count}")

    # admin notifications for deleted users were already cleared in the operational reset
    kept = []
    async for u in db.users.find({}, {"name": 1, "phone": 1, "role": 1}):
        kept.append(f"{u['role']}: {u.get('name')} ({u.get('phone')})")
    print("REMAINING USERS:", kept)
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
