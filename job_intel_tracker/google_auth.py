"""Google server code flow; operator-approved subject only, never email linking."""

import base64
import hashlib
import os
import re
import secrets
import time
from pathlib import Path
from urllib.parse import urlencode, urlparse

import httpx
import jwt
from fastapi import HTTPException, Request
from fastapi.responses import RedirectResponse
from starlette.concurrency import run_in_threadpool

from . import enrollment

ISSUER = "https://accounts.google.com"
JWKS = "https://www.googleapis.com/oauth2/v3/certs"
TABLE = """CREATE TABLE IF NOT EXISTS google_flows(
 hash TEXT PRIMARY KEY, nonce TEXT NOT NULL, verifier TEXT NOT NULL,
 expires REAL NOT NULL, mobile_ticket TEXT
)"""


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def binding():
    client = os.getenv("GOOGLE_CLIENT_ID", "")
    redirect = os.getenv("GOOGLE_REDIRECT_URI", "")
    url = urlparse(redirect)
    if (
        not client
        or url.scheme != "https"
        or not url.hostname
        or url.username
        or url.password
        or url.query
        or url.fragment
        or url.path != "/auth/google/callback"
    ):
        raise ValueError("Configure Google client ID and exact HTTPS /auth/google/callback")
    return client, redirect


def owner_subject():
    # Setting a subject is an explicit local operator approval of an additional
    # identity for the SAME owner. Browser claims never enroll or link identities.
    subject = os.getenv("GOOGLE_OWNER_SUB") or None
    filename = os.getenv("GOOGLE_OWNER_SUB_FILE")
    if filename:
        payload = enrollment.read_private(Path(filename))
        client, redirect = binding()
        if (
            payload.get("issuer") != ISSUER
            or payload.get("client_id") != client
            or payload.get("redirect_uri") != redirect
            or payload.get("approved") is not True
            or not isinstance(payload.get("sub"), str)
            or not payload.get("sub")
            or (subject and subject != payload.get("sub"))
        ):
            raise ValueError("Invalid approved Google owner file")
        subject = payload.get("sub")
    if subject is not None and (not isinstance(subject, str) or not subject or len(subject) > 256):
        raise ValueError("Invalid Google owner subject")
    return subject


def validate_token(token, nonce, client, key):
    # The two issuer spellings are explicitly documented by Google; canonicalize
    # only after cryptographic verification. Reject arbitrary discovery endpoints.
    claims = jwt.decode(
        token,
        key,
        algorithms=["RS256"],
        audience=client,
        issuer=[ISSUER, "accounts.google.com"],
        options={"require": ["exp", "iat", "sub", "nonce", "aud", "iss"]},
    )
    audience = claims["aud"]
    if (
        not isinstance(claims["sub"], str)
        or not claims["sub"]
        or len(claims["sub"]) > 256
        or not isinstance(claims["nonce"], str)
        or not secrets.compare_digest(claims["nonce"], nonce)
        or ("azp" in claims and claims["azp"] != client)
        or (isinstance(audience, list) and len(audience) > 1 and claims.get("azp") != client)
    ):
        raise ValueError("Identity denied")
    return claims["sub"]


def configure(app, db, public_origin, demo, owner_subject, session):
    configured = False
    client, redirect = "", ""
    if any(
        os.getenv(key)
        for key in ("GOOGLE_CLIENT_ID", "GOOGLE_REDIRECT_URI", "GOOGLE_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET_FILE")
    ):
        try:
            client, redirect = binding()
            if public_origin and redirect != public_origin + "/auth/google/callback":
                raise ValueError("Google callback must match public origin")
            if os.getenv("GOOGLE_CLIENT_SECRET") and os.getenv("GOOGLE_CLIENT_SECRET_FILE"):
                raise ValueError("Choose one Google client secret source")
            configured = bool(
                owner_subject
                and (os.getenv("GOOGLE_CLIENT_SECRET") or os.getenv("GOOGLE_CLIENT_SECRET_FILE"))
                and not demo
            )
        except ValueError:
            raise RuntimeError("Invalid Google authentication configuration") from None
    app.state.google_configured = configured
    keys = jwt.PyJWKClient(JWKS)
    with db() as c:
        c.execute(TABLE)

    @app.get("/auth/google")
    def start(req: Request, mobile_ticket: str | None = None):
        if not configured:
            raise HTTPException(503, "Google login is not configured")
        if mobile_ticket:
            if not app.state.mobile_enabled:
                raise HTTPException(404)
            if app.state.mobile_ticket(mobile_ticket)["provider"] != "google":
                raise HTTPException(401, "Provider mismatch")
        state, nonce, verifier = (secrets.token_urlsafe(32) for _ in range(3))
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            c.execute("DELETE FROM google_flows WHERE expires<=?", (time.time(),))
            if c.execute("SELECT COUNT(*) FROM google_flows").fetchone()[0] >= 64:
                raise HTTPException(429, "Retry login later")
            c.execute(
                "INSERT INTO google_flows VALUES(?,?,?,?,?)",
                (digest(state), nonce, verifier, time.time() + 300, mobile_ticket),
            )
        response = RedirectResponse(
            "https://accounts.google.com/o/oauth2/v2/auth?"
            + urlencode(
                {
                    "client_id": client,
                    "redirect_uri": redirect,
                    "response_type": "code",
                    "scope": "openid",
                    "state": state,
                    "nonce": nonce,
                    "code_challenge": challenge,
                    "code_challenge_method": "S256",
                    "prompt": "select_account",
                }
            )
        )
        response.set_cookie("google_flow", state, secure=True, httponly=True, samesite="lax", max_age=300)
        return response

    @app.get("/auth/google/callback")
    async def callback(req: Request):
        if not configured:
            raise HTTPException(503, "Google login is not configured")
        state = req.query_params.get("state", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", state) or not secrets.compare_digest(
            digest(state), digest(req.cookies.get("google_flow", ""))
        ):
            raise HTTPException(401, "Invalid state")
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            flow = c.execute(
                "SELECT * FROM google_flows WHERE hash=? AND expires>?", (digest(state), time.time())
            ).fetchone()
            c.execute("DELETE FROM google_flows WHERE hash=?", (digest(state),))
        if not flow:
            raise HTTPException(401, "Expired login")
        try:
            code = req.query_params.get("code", "")
            if not code or req.query_params.get("error"):
                raise ValueError("Authorization denied")
            secret_file = os.getenv("GOOGLE_CLIENT_SECRET_FILE")
            secret = Path(secret_file).read_text().strip() if secret_file else os.environ["GOOGLE_CLIENT_SECRET"]
            if not secret:
                raise ValueError("Missing secret")
            async with httpx.AsyncClient(timeout=15) as transport:
                response = await transport.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "client_id": client,
                        "client_secret": secret,
                        "code": code,
                        "grant_type": "authorization_code",
                        "redirect_uri": redirect,
                        "code_verifier": flow["verifier"],
                    },
                )
                response.raise_for_status()
                token = response.json()["id_token"]
            key = await run_in_threadpool(keys.get_signing_key_from_jwt, token)
            subject = validate_token(token, flow["nonce"], client, key.key)
            if not owner_subject or not secrets.compare_digest(subject, owner_subject):
                raise ValueError("Non-owner")
            if flow["mobile_ticket"]:
                app.state.mobile_ticket(flow["mobile_ticket"])
        except (jwt.PyJWTError, httpx.HTTPError, ValueError, KeyError, OSError, TypeError):
            # No provider exception text, codes, claims, secrets or tokens in logs.
            raise HTTPException(401, "Identity verification failed") from None
        destination = "/auth/mobile/authorize?ticket=" + flow["mobile_ticket"] if flow["mobile_ticket"] else "/"
        result = session(RedirectResponse(destination, status_code=303))
        result.delete_cookie("google_flow")
        return result
