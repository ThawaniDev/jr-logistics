"""One-off clean-state reset for JR Logistics controlled E2E testing.

Wipes transactional/test data. Preserves: platform architecture, settings,
Super Admin, staff accounts (RBAC), and REAL user accounts (never auto-deleted).
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from db import db  # noqa: E402

KEEP_PHONES = {
    "+966500000301",  # staff — support
    "+966500000302",  # staff — operations
    "+966500000303",  # staff — finance/accountant
    "+966530534184",  # real business (عماد)
    "+966593603404",  # real driver (عماد)
}

WIPE_COLLECTIONS = [
    "requests", "offers", "transactions", "settlements", "ledger", "approvals",
    "invoices", "cancellations", "ratings", "tickets", "notifications",
    "audit_logs", "withdrawals", "driver_documents", "driver_locations",
    "client_pricing", "otps", "office_invites", "agreements", "office_documents",
    "job_events", "job_messages",
]


async def main():
    for c in WIPE_COLLECTIONS:
        res = await db[c].delete_many({})
        print(f"wiped {c}: {res.deleted_count}")

    # Only the Super Admin, the 3 staff accounts, and the two known REAL accounts
    # (KEEP_PHONES) are real. Every other business/worker account is test-generated.
    doomed = await db.users.find(
        {"role": {"$in": ["business", "worker", "office"]},
         "phone": {"$nin": list(KEEP_PHONES)}},
        {"_id": 1, "phone": 1, "name": 1},
    ).to_list(5000)
    ids = [u["_id"] for u in doomed]
    for u in doomed:
        print(f"  delete user: {u.get('name')} — {u.get('phone')}")
    if ids:
        await db.users.delete_many({"_id": {"$in": ids}})
        await db.wallets.delete_many({"user_id": {"$in": ids}})
    print(f"deleted test/demo users: {len(ids)}")

    res = await db.wallets.update_many({}, {"$set": {"available": 0.0, "reserved": 0.0}})
    print(f"wallets reset: {res.modified_count}")

    await db.users.update_many({"role": "worker"}, {"$set": {
        "worker_profile.cancel_count": 0,
        "worker_profile.cancel_count_week": 0,
        "worker_profile.jobs_completed": 0,
        "worker_profile.suspended_until": None,
        "worker_profile.availability": "available",
        "worker_profile.verification_status": "verified",
    }})
    print("worker profiles reset (kept drivers marked verified for controlled E2E)")

    await db.counters.delete_many({})
    print("invoice counters reset")

    by_role = {r: await db.users.count_documents({"role": r})
               for r in ("admin", "staff", "business", "worker")}
    print("remaining users by role:", by_role)
    survivors = await db.users.find({}, {"name": 1, "phone": 1, "role": 1, "staff_profile.staff_role": 1}).to_list(100)
    for s in survivors:
        print(f"  kept: [{s['role']}{('/' + s['staff_profile']['staff_role']) if s.get('staff_profile') else ''}] {s.get('name')} — {s.get('phone')}")


asyncio.run(main())
