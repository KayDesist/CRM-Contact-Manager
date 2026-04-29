from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from database import create_tables
from routes.auth_routes import router as auth_router
from routes.chat_routes import router as chat_router


APP_DIR = Path(__file__).resolve().parent
load_dotenv(APP_DIR / ".env", override=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    yield


app = FastAPI(title="CRM Contact Manager", lifespan=lifespan)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(chat_router, prefix="/api/chat", tags=["chat"])

app.mount("/static", StaticFiles(directory=APP_DIR / "static"), name="static")


@app.get("/")
async def root():
    return RedirectResponse(url="/static/login.html")
