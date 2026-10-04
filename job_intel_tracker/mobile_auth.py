"""Disabled-by-default, single-owner native PKCE handoff. No provider secrets here."""

import base64
import hashlib
import html
import json
import os
import re
import secrets
import time
from urllib.parse import urlencode, urlparse

from fastapi import HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict

SCOPES = {"read", "jobs:write", "contribute", "attachments:metadata"}
TABLES = """
CREATE TABLE IF NOT EXISTS mobile_flows(hash TEXT PRIMARY KEY, redirect TEXT, challenge TEXT, state TEXT, expires REAL, code_hash TEXT UNIQUE, code_expires REAL);
CREATE TABLE IF NOT EXISTS mobile_sessions(hash TEXT PRIMARY KEY, expires REAL, revoked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS mobile_apple_flows(hash TEXT PRIMARY KEY, ticket TEXT);
"""


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def configure(app, db, public_origin, owner, configured_owner):
    enabled = os.getenv("MOBILE_AUTH_ENABLED") == "1"
    callbacks = set()
    if enabled:
        try:
            values = json.loads(os.getenv("MOBILE_REDIRECT_URIS", "[]"))
            if (
                not isinstance(values, list)
                or not values
                or len(values) > 4
                or not public_origin
                or not configured_owner
            ):
                raise ValueError()
            for value in values:
                u = urlparse(value)
                if (
                    u.scheme != "https"
                    or not u.hostname
                    or u.username
                    or u.password
                    or u.path != "/auth/mobile/callback"
                    or value != public_origin + "/auth/mobile/callback"
                    or u.query
                    or u.fragment
                    or u.port not in (None, 443)
                    or value != "https://" + u.hostname + (":443" if u.port == 443 else "") + "/auth/mobile/callback"
                ):
                    raise ValueError()
                callbacks.add(value)
        except (ValueError, TypeError):
            raise RuntimeError(
                "Native authentication requires an explicit HTTPS origin and exact HTTPS callback allowlist"
            ) from None
    with db() as c:
        c.executescript(TABLES)

    def available():
        if not enabled:
            raise HTTPException(404, "Native authentication unavailable")

    def origin(req):
        if req.headers.get("origin") not in (None, public_origin):
            raise HTTPException(403, "Origin check failed")

    def ticket(raw):
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", raw):
            raise HTTPException(401, "Login unavailable or expired")
        with db() as c:
            row = c.execute(
                "SELECT * FROM mobile_flows WHERE hash=? AND expires>? AND code_hash IS NULL",
                (digest(raw), time.time()),
            ).fetchone()
        if not row:
            raise HTTPException(401, "Login unavailable or expired")
        return row

    class Start(BaseModel):
        model_config = ConfigDict(extra="forbid")
        redirect_uri: str
        code_challenge: str
        code_challenge_method: str
        client_state: str
        provider: str

    @app.get("/auth/mobile/callback")
    def callback_fallback():
        available()
        return HTMLResponse(
            '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width">'
            "<title>Return to Job Intel mobile</title><h1>Return to the mobile app</h1>"
            "<p>If it did not open, restart sign-in after checking app-link setup.</p></html>"
        )

    @app.post("/auth/mobile/start")
    def start(p: Start, req: Request):
        available()
        origin(req)
        if (
            p.redirect_uri not in callbacks
            or p.provider != "apple"
            or p.code_challenge_method != "S256"
            or not re.fullmatch(r"[A-Za-z0-9_-]{43}", p.code_challenge)
            or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", p.client_state)
        ):
            raise HTTPException(400, "Invalid native login request")
        raw = secrets.token_urlsafe(32)
        expires = time.time() + 300
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            c.execute("DELETE FROM mobile_flows WHERE expires<=?", (time.time(),))
            c.execute(
                "DELETE FROM mobile_apple_flows WHERE hash NOT IN (SELECT hash FROM flows WHERE expires>?)",
                (time.time(),),
            )
            c.execute("DELETE FROM mobile_sessions WHERE expires<=?", (time.time(),))
            if c.execute("SELECT COUNT(*) FROM mobile_flows").fetchone()[0] >= 64:
                raise HTTPException(429, "Retry native login later")
            c.execute(
                "INSERT INTO mobile_flows VALUES(?,?,?,?,?,NULL,NULL)",
                (digest(raw), p.redirect_uri, p.code_challenge, p.client_state, expires),
            )
        return {"authorization_url": public_origin + "/auth/mobile/authorize?ticket=" + raw, "expires_at": expires}

    @app.get("/auth/mobile/authorize")
    def authorize(req: Request, ticket: str):
        available()
        row = ticket_row(ticket)
        try:
            owner(req)
        except HTTPException as error:
            if error.status_code != 401:
                raise
            return RedirectResponse("/auth/apple?mobile_ticket=" + ticket, status_code=303)
        with db() as c:
            s = c.execute(
                "SELECT csrf FROM sessions WHERE hash=?", (digest(req.cookies.get("session", "")),)
            ).fetchone()
        # Deliberate browser approval prevents a link with an attacker's PKCE challenge
        # from silently minting an owner credential in the signed-in browser.
        return HTMLResponse(
            '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Approve native sign-in</title><h1>Approve Job Intel mobile sign-in</h1><p>Approve only a sign-in you just started in your mobile app.</p><p>Return address: '
            + html.escape(row["redirect"])
            + '</p><form method="post" action="/auth/mobile/approve"><input type="hidden" name="ticket" value="'
            + html.escape(ticket)
            + '"><input type="hidden" name="csrf" value="'
            + html.escape(s["csrf"])
            + '"><button type="submit">Approve mobile sign-in</button></form></html>'
        )

    ticket_row = ticket

    @app.post("/auth/mobile/approve")
    async def approve(req: Request):
        available()
        if req.headers.get("origin") != public_origin:
            raise HTTPException(403, "Origin check failed")
        form = await req.form()
        owner(req, csrf=str(form.get("csrf", "")))
        raw = str(form.get("ticket", ""))
        row = ticket_row(raw)
        code = secrets.token_urlsafe(32)
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            changed = c.execute(
                "UPDATE mobile_flows SET code_hash=?,code_expires=? WHERE hash=? AND code_hash IS NULL AND expires>?",
                (digest(code), time.time() + 60, digest(raw), time.time()),
            )
            if changed.rowcount != 1:
                raise HTTPException(401, "Login unavailable or expired")
        return RedirectResponse(
            row["redirect"] + "?" + urlencode({"code": code, "state": row["state"]}), status_code=303
        )

    class Exchange(BaseModel):
        model_config = ConfigDict(extra="forbid")
        code: str
        code_verifier: str
        redirect_uri: str

    @app.post("/auth/mobile/exchange")
    def exchange(p: Exchange, req: Request):
        available()
        origin(req)
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}", p.code) or not re.fullmatch(
            r"[A-Za-z0-9._~-]{43,128}", p.code_verifier
        ):
            raise HTTPException(401, "Native exchange denied")
        challenge = base64.urlsafe_b64encode(hashlib.sha256(p.code_verifier.encode()).digest()).decode().rstrip("=")
        token = "mobile_" + secrets.token_urlsafe(32)
        expires = time.time() + 900
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            row = c.execute(
                "SELECT * FROM mobile_flows WHERE code_hash=? AND expires>? AND code_expires>?",
                (digest(p.code), time.time(), time.time()),
            ).fetchone()
            if not row or row["redirect"] != p.redirect_uri or not secrets.compare_digest(row["challenge"], challenge):
                raise HTTPException(401, "Native exchange denied")
            c.execute("DELETE FROM mobile_flows WHERE hash=?", (row["hash"],))
            c.execute("INSERT INTO mobile_sessions VALUES(?,?,0)", (digest(token), expires))
        return {"access_token": token, "expires_at": expires, "actor": "owner"}

    @app.post("/auth/mobile/logout")
    def logout(req: Request):
        available()
        origin(req)
        bearer = req.headers.get("authorization", "")
        if not bearer.startswith("Bearer "):
            raise HTTPException(401, "Invalid credential")
        with db() as c:
            result = c.execute("UPDATE mobile_sessions SET revoked=1 WHERE hash=?", (digest(bearer[7:]),))
            if result.rowcount != 1:
                raise HTTPException(401, "Invalid credential")
        return {"ok": True}

    app.state.mobile_ticket = ticket_row
    app.state.mobile_enabled = enabled
