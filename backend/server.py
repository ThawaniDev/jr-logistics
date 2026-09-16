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
from seed import seed_all

app = FastAPI(title="ISNAD API")

app.include_router(auth_router)
app.include_router(business_router)
app.include_router(worker_router)
app.include_router(admin_router)
app.include_router(common_router)

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
    await seed_all()
    logger.info("ISNAD API ready — demo data seeded")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
