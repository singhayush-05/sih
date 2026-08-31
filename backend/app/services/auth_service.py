"""
Auth service — handles user registration, login, and token management.
"""

from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId

from app.database import get_database
from app.models.user import create_user_document, UserRole
from app.utils.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.utils.exceptions import (
    ConflictException,
    CredentialsException,
    NotFoundException,
    BadRequestException,
)
from app.config import settings

MAX_BCRYPT_PASSWORD_BYTES = 72


async def register_user(
    email: str,
    password: str,
    full_name: str,
    phone: Optional[str] = None,
    upi_id: Optional[str] = None,
    initial_balance: Optional[float] = None,
) -> dict:
    """
    Register a new user account.
    Raises ConflictException if email already exists.
    """
    db = get_database()

    # Check if email already exists
    existing = await db.users.find_one({"email": email})
    if existing:
        raise ConflictException("An account with this email already exists")

    # Check if phone is taken (if provided)
    if phone:
        existing_phone = await db.users.find_one({"phone": phone})
        if existing_phone:
            raise ConflictException("An account with this phone number already exists")

    # Check if UPI ID is taken (if provided)
    if upi_id:
        existing_upi = await db.users.find_one({"upi_id": upi_id})
        if existing_upi:
            raise ConflictException("This UPI ID is already registered")

    if len(password.encode("utf-8")) > MAX_BCRYPT_PASSWORD_BYTES:
        raise BadRequestException("Password must be at most 72 bytes long")

    # Create user document
    if len(password.encode("utf-8")) > 72:
        from app.utils.exceptions import BadRequestException
        raise BadRequestException("Password is too long (bcrypt supports max 72 bytes)")
    hashed = hash_password(password)
    user_doc = create_user_document(
        email=email,
        full_name=full_name,
        hashed_password=hashed,
        role=UserRole.USER,
        phone=phone,
        upi_id=upi_id,
        initial_balance=initial_balance,
    )

    result = await db.users.insert_one(user_doc)
    user_doc["_id"] = str(result.inserted_id)

    return user_doc


async def login_user(email: str, password: str) -> dict:
    """
    Authenticate user and return JWT tokens.
    Raises CredentialsException if credentials are invalid.
    """
    db = get_database()

    user = await db.users.find_one({"email": email})
    if not user:
        raise CredentialsException("Invalid email or password")

    if not verify_password(password, user["hashed_password"]):
        raise CredentialsException("Invalid email or password")

    if not user.get("is_active", False):
        raise CredentialsException("Account is deactivated")

    # Create tokens
    user_id = str(user["_id"])
    token_data = {
        "sub": user_id,
        "email": user["email"],
        "role": user["role"],
    }

    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "role": user["role"],
        "user_id": user_id,
        "full_name": user["full_name"],
    }


async def refresh_access_token(refresh_token: str) -> dict:
    """
    Generate a new access token from a valid refresh token.
    """
    payload = decode_token(refresh_token)
    if payload is None or payload.get("type") != "refresh":
        raise CredentialsException("Invalid refresh token")

    user_id = payload.get("sub")
    db = get_database()
    user = await db.users.find_one({"_id": ObjectId(user_id)})

    if not user:
        raise CredentialsException("User not found")

    token_data = {
        "sub": str(user["_id"]),
        "email": user["email"],
        "role": user["role"],
    }

    new_access_token = create_access_token(token_data)
    new_refresh_token = create_refresh_token(token_data)

    return {
        "access_token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
        "role": user["role"],
        "user_id": str(user["_id"]),
        "full_name": user["full_name"],
    }


async def authenticate_google_user(credential: str) -> dict:
    """
    Authenticate a user using a verified Google ID token.

    Verifies:
    - Signature & public keys
    - Audience (settings.GOOGLE_CLIENT_ID)
    - Issuer (accounts.google.com)
    - Expiration
    - Email verification

    Looks up user by:
    1. google_id (sub)
    2. email (links google_id to existing local account without overwriting password)
    3. Creates new user with standard defaults if account does not exist.

    Returns the standard JWT tokens and user metadata.
    """
    from google.oauth2 import id_token
    from google.auth.transport import requests as google_requests

    if not credential:
        raise BadRequestException("Google credential is required")

    # 1. Verify Google ID Token
    try:
        id_info = id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            audience=settings.GOOGLE_CLIENT_ID if settings.GOOGLE_CLIENT_ID else None
        )
    except ValueError as e:
        raise CredentialsException(f"Invalid Google ID token: {str(e)}")
    except Exception as e:
        raise CredentialsException(f"Could not verify Google ID token: {str(e)}")

    # 2. Verify Issuer
    issuer = id_info.get("iss")
    if issuer not in ["accounts.google.com", "https://accounts.google.com"]:
        raise CredentialsException("Invalid Google token issuer")

    # 3. Verify Email Verification
    if not id_info.get("email_verified", False):
        raise CredentialsException("Google account email is not verified")

    # 4. Extract verified claims
    google_sub = id_info.get("sub")
    email = id_info.get("email")
    name = id_info.get("name") or id_info.get("given_name") or (email.split("@")[0] if email else "Google User")
    picture = id_info.get("picture")

    if not google_sub or not email:
        raise CredentialsException("Google token missing sub or email claim")

    email = email.lower().strip()
    db = get_database()

    # 5. Lookup user: First by google_id
    user = await db.users.find_one({"google_id": google_sub})

    if not user:
        # Second: Look up by verified email (existing local account)
        user = await db.users.find_one({"email": email})
        if user:
            # Safely link Google ID to existing account without touching password
            updates = {
                "google_id": google_sub,
                "updated_at": datetime.now(timezone.utc)
            }
            # Update avatar if user doesn't already have one
            current_avatar = (user.get("profile") or {}).get("avatar_url")
            if picture and not current_avatar:
                updates["profile.avatar_url"] = picture

            await db.users.update_one({"_id": user["_id"]}, {"$set": updates})
            user["google_id"] = google_sub
            if picture and not current_avatar:
                if not isinstance(user.get("profile"), dict):
                    user["profile"] = {}
                user["profile"]["avatar_url"] = picture
        else:
            # Third: Create new user document reusing standard defaults
            base_upi = f"{email.split('@')[0]}@upi"
            existing_upi = await db.users.find_one({"upi_id": base_upi})
            upi_id = base_upi if not existing_upi else f"{email.split('@')[0]}.{google_sub[-4:]}@upi"

            user_doc = create_user_document(
                email=email,
                full_name=name,
                hashed_password=None,
                role=UserRole.USER,
                phone=None,
                upi_id=upi_id,
                initial_balance=None,  # Reuses existing 50000.0 default from create_user_document
                google_id=google_sub,
                avatar_url=picture,
                auth_provider="google",
            )
            result = await db.users.insert_one(user_doc)
            user_doc["_id"] = result.inserted_id
            user = user_doc

    # Check active status
    if not user.get("is_active", True):
        raise CredentialsException("Account is deactivated")

    # 6. Generate standard JWT tokens
    user_id = str(user["_id"])
    token_data = {
        "sub": user_id,
        "email": user["email"],
        "role": user.get("role", "user"),
    }

    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "role": user.get("role", "user"),
        "user_id": user_id,
        "full_name": user.get("full_name", name),
    }


async def seed_admin():
    """
    Seed the admin account on first startup if it doesn't exist.
    Called from the app startup event.
    """
    db = get_database()

    existing_admin = await db.users.find_one({"role": "admin"})
    if existing_admin:
        print(f"[OK] Admin account already exists: {existing_admin['email']}")
        return

    if len(settings.ADMIN_PASSWORD.encode("utf-8")) > MAX_BCRYPT_PASSWORD_BYTES:
        raise BadRequestException("Admin password must be at most 72 bytes long")

    hashed = hash_password(settings.ADMIN_PASSWORD)
    admin_doc = create_user_document(
        email=settings.ADMIN_EMAIL,
        full_name=settings.ADMIN_FULL_NAME,
        hashed_password=hashed,
        role=UserRole.ADMIN,
    )
    # Admin gets a high balance for demo purposes
    admin_doc["balance"] = 0.0

    await db.users.insert_one(admin_doc)
    print(f"[OK] Admin account seeded: {settings.ADMIN_EMAIL}")
