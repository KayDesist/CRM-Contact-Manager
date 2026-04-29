from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import User, UserRegister, UserLogin, UserResponse
from auth import hash_password, verify_password, create_token, get_current_user_id

router = APIRouter()


@router.post("/register")
def register(data: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(
        username=data.username,
        hashed_password=hash_password(data.password),
        monday_api_token=(data.monday_api_token or "").strip(),
        monday_board_id=(data.monday_board_id or "").strip(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"token": create_token(user.id), "user": UserResponse.model_validate(user)}


@router.post("/login")
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return {"token": create_token(user.id), "user": UserResponse.model_validate(user)}


@router.get("/me", response_model=UserResponse)
def me(user_id: int = Depends(get_current_user_id), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user
