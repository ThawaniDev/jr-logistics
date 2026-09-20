from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / '.env')

import os
import logging
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from db import db, client
from routers.auth import router as auth_router
from routers.business import router as business_router
from routers.worker import router as worker_router
from routers.admin import router as admin_router
from routers.common import router as common_router
from routers.documents import router as documents_router
from routers.pricing import router as pricing_router
from routers.finance import router as finance_router
from routers.location import router as location_router
from routers.reports import router as reports_router
from routers.jobs import router as jobs_router
from routers.operations import router as operations_router
from routers.office import router as office_router
from routers.custody import router as custody_router
from routers.complaints import router as complaints_router
from routers.integrations import router as integrations_router
from seed import seed_all
from storage import init_storage

app = FastAPI(title="ISNAD API")

app.include_router(auth_router)
app.include_router(business_router)
app.include_router(worker_router)
app.include_router(admin_router)
app.include_router(common_router)
app.include_router(documents_router)
app.include_router(jobs_router)
app.include_router(operations_router)
app.include_router(office_router)
app.include_router(pricing_router)
app.include_router(finance_router)
app.include_router(location_router)
app.include_router(reports_router)
app.include_router(custody_router)
app.include_router(complaints_router)
app.include_router(integrations_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup():
    await db.users.create_index("phone", unique=True)
    await db.otps.create_index("phone")
    await db.notifications.create_index("user_id")
    await db.offers.create_index("request_id")
    await db.offers.create_index("worker_id")
    await db.transactions.create_index("user_id")
    await db.audit_logs.create_index("created_at")
    await db.driver_documents.create_index("worker_id")
    await db.client_pricing.create_index([("business_id", 1), ("status", 1)])
    await db.settlements.create_index("request_id")
    await db.settlements.create_index("status")
    await db.custody.create_index("offer_id")
    await db.complaints.create_index("user_id")
    await db.complaints.create_index("request_id")
    await db.api_keys.create_index("key_hash")
    await db.api_logs.create_index("business_id")
    await db.assignment_history.create_index("request_id")
    await db.webhook_deliveries.create_index("business_id")
    await db.ledger.create_index("created_at")
    await db.ledger.create_index("user_id")
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    await seed_all()
    logger.info("ISNAD API ready — demo data seeded")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
