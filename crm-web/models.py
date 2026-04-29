from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from pydantic import BaseModel
from typing import Optional
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(256), nullable=False)
    monday_api_token = Column(String(512), nullable=True)
    monday_board_id = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class PendingContact(Base):
    __tablename__ = "pending_contacts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, unique=True, index=True)
    contact_data = Column(Text, nullable=False)  # JSON string
    created_at = Column(DateTime(timezone=True), server_default=func.now())


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class UserRegister(BaseModel):
    username: str
    password: str
    monday_api_token: Optional[str] = None
    monday_board_id: Optional[str] = None


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    monday_board_id: str

    class Config:
        from_attributes = True


class ChatMessage(BaseModel):
    message: str


class DirectEdit(BaseModel):
    updates: dict  # {field: value, ...}
