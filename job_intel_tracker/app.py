"""Single-owner job intelligence service. No model provider required."""

import hashlib
import json
import os
import secrets
import sqlite3
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

STAGES = ["Prospect", "Applied", "Screening", "Interview", "Offer", "Closed", "Rejected", "Withdrawn"]


def create_app(data_dir=None, demo=False):
    if demo and (os.getenv("APP_ENV") == "production" or not data_dir):
        raise RuntimeError("Demo requires an explicit isolated directory and non-production environment")
    root = Path(data_dir or os.getenv("DATA_DIR", "data")).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    uploads = root / "uploads"
    uploads.mkdir(mode=0o700, exist_ok=True)
    dbpath = root / "tracker.sqlite3"

    def db():
        c = sqlite3.connect(dbpath, timeout=20)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys=ON")
        return c

    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, kind TEXT NOT NULL, job TEXT, author TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL, updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS revisions(id TEXT, version INTEGER, actor TEXT, body TEXT, timestamp REAL, PRIMARY KEY(id,version));
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, actor TEXT, action TEXT, resource TEXT, timestamp REAL);
        CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY, name TEXT UNIQUE, scopes TEXT, jobs TEXT, expires REAL, revoked INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, csrf TEXT, expires REAL);
        CREATE TABLE IF NOT EXISTS flows(hash TEXT PRIMARY KEY, nonce TEXT, expires REAL);
        CREATE TABLE IF NOT EXISTS idem(actor TEXT, key TEXT, digest TEXT, result TEXT, PRIMARY KEY(actor,key));
        CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, job TEXT REFERENCES records(id), author TEXT, filename TEXT, mime TEXT, version INTEGER, timestamp REAL);
        """)
    app = FastAPI(title="job_intel_tracker", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.db = db

    def digest(s):
        return hashlib.sha256(s.encode()).hexdigest()

    def audit(c, actor, action, resource):
        c.execute(
            "INSERT INTO audit(actor,action,resource,timestamp) VALUES(?,?,?,?)", (actor, action, resource, time.time())
        )

    def principal(req, scope="read", job=None):
        bearer = req.headers.get("authorization", "")
        with db() as c:
            if bearer.startswith("Bearer "):
                t = c.execute("SELECT * FROM tokens WHERE hash=?", (digest(bearer[7:]),)).fetchone()
                if not t or t["revoked"] or t["expires"] < time.time():
                    raise HTTPException(401, "Invalid credential")
                if scope not in json.loads(t["scopes"]) or (
                    job and json.loads(t["jobs"]) and job not in json.loads(t["jobs"])
                ):
                    raise HTTPException(403, "Scope denied")
                return t["name"], json.loads(t["jobs"])
            s = c.execute(
                "SELECT * FROM sessions WHERE hash=? AND expires>?",
                (digest(req.cookies.get("session", "")), time.time()),
            ).fetchone()
        if not s:
            raise HTTPException(401, "Sign in required")
        if req.method not in ("GET", "HEAD") and req.headers.get("origin") not in (None, str(req.base_url).rstrip("/")):
            raise HTTPException(403, "Origin check failed")
        if req.method not in ("GET", "HEAD") and not secrets.compare_digest(
            req.headers.get("x-csrf-token", ""), s["csrf"]
        ):
            raise HTTPException(403, "CSRF check failed")
        return "owner", []

    def owner(req):
        if principal(req)[0] != "owner":
            raise HTTPException(403, "Owner required")

    def session(response):
        raw, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with db() as c:
            c.execute("INSERT INTO sessions VALUES(?,?,?)", (digest(raw), csrf, time.time() + 28800))
        response.set_cookie("session", raw, httponly=True, secure=not demo, samesite="lax", max_age=28800)
        return response

    @app.middleware("http")
    async def headers(req, call):
        if demo and req.client.host not in ("127.0.0.1", "::1", "testclient"):
            return JSONResponse({"detail": "Demo is loopback only"}, 403)
        if (
            req.method not in ("GET", "HEAD")
            and req.headers.get("content-length", "0").isdigit()
            and int(req.headers.get("content-length", "0")) > 6 * 1024 * 1024
        ):
            return JSONResponse({"detail": "Request too large"}, 413)
        r = await call(req)
        r.headers.update(
            {
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "Cache-Control": "no-store",
                "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://appleid.apple.com",
            }
        )
        return r

    @app.get("/")
    def index():
        return FileResponse(Path(__file__).parent / "static/index.html")

    @app.get("/auth/info")
    def info():
        return {"demo": demo, "configured": bool(os.getenv("APPLE_CLIENT_ID") and os.getenv("APPLE_OWNER_SUB"))}

    @app.post("/auth/demo")
    def demo_login(req: Request):
        if not demo or req.headers.get("origin") not in (None, str(req.base_url).rstrip("/")):
            raise HTTPException(403)
        return session(JSONResponse({"ok": True}))

    @app.get("/auth/apple")
    def apple():
        client, redirect, sub = [os.getenv(x) for x in ("APPLE_CLIENT_ID", "APPLE_REDIRECT_URI", "APPLE_OWNER_SUB")]
        if not all(
            (
                client,
                redirect,
                sub,
                os.getenv("APPLE_TEAM_ID"),
                os.getenv("APPLE_KEY_ID"),
                os.getenv("APPLE_PRIVATE_KEY_FILE"),
            )
        ) or not (redirect or "").startswith("https://"):
            raise HTTPException(503, "Apple login is not configured")
        state, nonce = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        with db() as c:
            c.execute("INSERT INTO flows VALUES(?,?,?)", (digest(state), nonce, time.time() + 300))
        r = RedirectResponse(
            "https://appleid.apple.com/auth/authorize?"
            + urlencode(
                {
                    "client_id": client,
                    "redirect_uri": redirect,
                    "response_type": "code",
                    "response_mode": "form_post",
                    "state": state,
                    "nonce": nonce,
                }
            )
        )
        r.set_cookie("flow", state, secure=True, httponly=True, samesite="none", max_age=300)
        return r

    @app.post("/auth/callback")
    async def callback(req: Request):
        form = await req.form()
        state = str(form.get("state", ""))
        if not state or not secrets.compare_digest(state, req.cookies.get("flow", "")):
            raise HTTPException(401, "Invalid state")
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            flow = c.execute("SELECT * FROM flows WHERE hash=? AND expires>?", (digest(state), time.time())).fetchone()
            c.execute("DELETE FROM flows WHERE hash=?", (digest(state),))
        if not flow:
            raise HTTPException(401, "Expired login")
        try:
            code = str(form.get("code", ""))
            if not code:
                raise ValueError("Missing authorization code")
            client_secret = jwt.encode(
                {
                    "iss": os.environ["APPLE_TEAM_ID"],
                    "iat": int(time.time()),
                    "exp": int(time.time()) + 300,
                    "aud": "https://appleid.apple.com",
                    "sub": os.environ["APPLE_CLIENT_ID"],
                },
                Path(os.environ["APPLE_PRIVATE_KEY_FILE"]).read_text(),
                algorithm="ES256",
                headers={"kid": os.environ["APPLE_KEY_ID"]},
            )
            async with httpx.AsyncClient(timeout=15) as client:
                exchange = await client.post(
                    "https://appleid.apple.com/auth/token",
                    data={
                        "client_id": os.environ["APPLE_CLIENT_ID"],
                        "client_secret": client_secret,
                        "code": code,
                        "grant_type": "authorization_code",
                        "redirect_uri": os.environ["APPLE_REDIRECT_URI"],
                    },
                )
                exchange.raise_for_status()
                token = exchange.json()["id_token"]
            key = jwt.PyJWKClient("https://appleid.apple.com/auth/keys").get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                audience=os.environ["APPLE_CLIENT_ID"],
                issuer="https://appleid.apple.com",
                options={"require": ["exp", "iat", "sub", "nonce", "aud", "iss"]},
            )
            if claims["nonce"] != flow["nonce"] or claims["sub"] != os.environ["APPLE_OWNER_SUB"]:
                raise ValueError("Identity denied")
        except (jwt.PyJWTError, httpx.HTTPError, ValueError, KeyError, OSError):
            raise HTTPException(401, "Identity verification failed") from None
        r = session(RedirectResponse("/", status_code=303))
        r.delete_cookie("flow")
        return r

    @app.get("/api/me")
    def me(req: Request):
        actor, _ = principal(req)
        with db() as c:
            s = c.execute(
                "SELECT csrf FROM sessions WHERE hash=?", (digest(req.cookies.get("session", "")),)
            ).fetchone()
        return {"actor": actor, "csrf": s["csrf"] if s else None, "stages": STAGES}

    @app.post("/auth/logout")
    def logout(req: Request):
        principal(req)
        with db() as c:
            c.execute("DELETE FROM sessions WHERE hash=?", (digest(req.cookies.get("session", "")),))
        r = JSONResponse({"ok": True})
        r.delete_cookie("session")
        return r

    def unpack(r):
        return {**dict(r), "body": json.loads(r["body"])}

    @app.get("/api/records")
    def records(req: Request, kind: str | None = None, job: str | None = None, q: str = ""):
        _, jobs = principal(req, job=job)
        with db() as c:
            rows = c.execute("SELECT * FROM records ORDER BY updated DESC").fetchall()
        return [
            unpack(r)
            for r in rows
            if (not kind or r["kind"] == kind)
            and (not job or r["job"] == job)
            and (not jobs or r["id"] in jobs or r["job"] in jobs or r["kind"] == "filters")
            and q.lower() in r["body"].lower()
        ]

    class Record(BaseModel):
        kind: str
        job: str | None = None
        version: int = Field(ge=0)
        body: dict

    def validate(p):
        if p.kind not in ("job", "research", "note", "rating", "interview", "filters"):
            raise HTTPException(422, "Unknown record kind")
        if len(json.dumps(p.body)) > 100000:
            raise HTTPException(422, "Record too large")
        if p.kind == "job" and (
            not isinstance(p.body.get("title"), str)
            or not isinstance(p.body.get("company"), str)
            or not p.body.get("title")
            or not p.body.get("company")
            or p.body.get("stage") not in STAGES
        ):
            raise HTTPException(422, "Job needs title, company and valid stage")
        if p.kind == "job" and p.body.get("grandfathered") and not p.body.get("exception_reason"):
            raise HTTPException(422, "Owner exception rationale required")
        if (
            p.kind == "job"
            and p.body.get("comp_status") == "Verified"
            and not (p.body.get("comp_source") and p.body.get("comp_checked"))
        ):
            raise HTTPException(422, "Verified compensation requires source and checked date")
        if p.kind == "job":
            for field in ("base_min", "base_max"):
                value = p.body.get(field)
                if value is not None and (not isinstance(value, (int, float)) or value < 0):
                    raise HTTPException(422, "Base salary must be nonnegative numeric or null")
            if p.body.get("base_min") and p.body.get("base_max") and p.body["base_min"] > p.body["base_max"]:
                raise HTTPException(422, "Invalid base salary range")
        if p.kind == "research" and (not p.body.get("source") or not p.body.get("observed_at")):
            raise HTTPException(422, "Research needs source and observed_at provenance")
        if p.kind == "filters" and (
            not isinstance(p.body.get("active_cap"), int)
            or not 1 <= p.body["active_cap"] <= 100
            or not isinstance(p.body.get("base_floor"), (int, float))
            or p.body["base_floor"] < 0
            or not isinstance(p.body.get("lanes"), list)
            or not p.body["lanes"]
            or not all(isinstance(x, str) and x for x in p.body["lanes"])
        ):
            raise HTTPException(422, "Invalid structured search policy")
        if p.kind == "rating" and (
            not isinstance(p.body.get("score"), (int, float))
            or not 0 <= p.body["score"] <= 100
            or not all(p.body.get(k) for k in ("rationale", "rubric", "evidence"))
        ):
            raise HTTPException(422, "Rating needs score 0–100, rationale, rubric and evidence")

    @app.put("/api/records/{rid}")
    def write(rid: str, p: Record, req: Request):
        if len(rid) > 100:
            raise HTTPException(422)
        validate(p)
        if p.kind in ("job", "filters") and p.job is not None:
            raise HTTPException(422, "Top-level record cannot have parent job")
        scope = "jobs:write" if p.kind == "job" else "contribute"
        actor, _jobs = principal(req, scope, rid if p.kind in ("job", "filters") else p.job)
        if p.kind == "filters" and rid != "search-policy":
            raise HTTPException(422, "Use search-policy ID")
        if p.kind == "filters" and actor != "owner":
            raise HTTPException(403)
        if p.kind == "rating" and "override" in p.body and actor != "owner":
            raise HTTPException(403)
        key = req.headers.get("idempotency-key")
        if not key or len(key) > 200:
            raise HTTPException(400, "Idempotency-Key required")
        fingerprint = digest(rid + json.dumps(p.model_dump(), sort_keys=True))
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            cached = c.execute("SELECT * FROM idem WHERE actor=? AND key=?", (actor, key)).fetchone()
            if cached:
                if cached["digest"] != fingerprint:
                    raise HTTPException(409, "Idempotency key reused with different content")
                return json.loads(cached["result"])
            old = c.execute("SELECT * FROM records WHERE id=?", (rid,)).fetchone()
            if old and (old["kind"] != p.kind or old["job"] != p.job):
                raise HTTPException(409, "Record identity is immutable")
            if old and actor != "owner" and old["kind"] != "job" and old["author"] != actor:
                raise HTTPException(403, "Agents cannot edit another author or existing owner job")
            if (old["version"] if old else 0) != p.version:
                raise HTTPException(409, "Stale version; reload before editing")
            if p.kind not in ("job", "filters"):
                parent = c.execute("SELECT id FROM records WHERE id=? AND kind='job'", (p.job,)).fetchone()
                if not parent:
                    raise HTTPException(422, "Parent job required")
            if p.kind == "job":
                if p.body.get("primary_id"):
                    primary = c.execute(
                        "SELECT body FROM records WHERE id=? AND kind='job'", (p.body["primary_id"],)
                    ).fetchone()
                    if not primary or p.body["primary_id"] == rid:
                        raise HTTPException(422, "Valid primary opportunity required")
                    pb = json.loads(primary["body"])
                    if pb.get("primary_id") or pb["company"].casefold() != p.body["company"].casefold():
                        raise HTTPException(422, "Alternative must link to primary role at same employer")
                all_jobs = c.execute("SELECT * FROM records WHERE kind='job' AND id!=?", (rid,)).fetchall()
                for candidate in all_jobs:
                    existing = json.loads(candidate["body"])
                    if (
                        existing["company"].casefold() == p.body["company"].casefold()
                        and not existing.get("primary_id")
                        and not p.body.get("primary_id")
                        and existing["stage"] not in ("Closed", "Rejected", "Withdrawn")
                        and p.body["stage"] not in ("Closed", "Rejected", "Withdrawn")
                    ):
                        raise HTTPException(409, "Employer has a primary role; link alternative using primary_id")
                policy_record = c.execute("SELECT body FROM records WHERE kind='filters'").fetchone()
                cap = json.loads(policy_record["body"])["active_cap"] if policy_record else 10
                is_active = lambda body: (
                    body["stage"] not in ("Prospect", "Closed", "Rejected", "Withdrawn") and not body.get("primary_id")
                )
                count = sum(is_active(json.loads(j["body"])) for j in all_jobs)
                becoming_active = is_active(p.body) and (not old or not is_active(json.loads(old["body"])))
                if (
                    becoming_active
                    and count >= cap
                    and not (actor == "owner" and req.headers.get("x-owner-cap-override") == "true")
                ):
                    raise HTTPException(
                        409, "Active cap reached; owner may explicitly override with X-Owner-Cap-Override: true"
                    )
            body = dict(p.body)
            if old and p.kind == "job" and actor != "owner":
                previous = json.loads(old["body"])
                for protected in ("owner_assessment", "grandfathered", "exception_reason"):
                    if body.get(protected) != previous.get(protected):
                        raise HTTPException(403, "Owner decision fields cannot be changed by agents")
            if (
                p.kind == "job"
                and actor != "owner"
                and not old
                and any(body.get(field) for field in ("owner_assessment", "grandfathered", "exception_reason"))
            ):
                raise HTTPException(403, "Owner decision fields cannot be set by agents")
            if p.kind == "job":
                history = json.loads(old["body"]).get("timeline", []) if old else []
                if not old or json.loads(old["body"])["stage"] != body["stage"]:
                    history.append({"stage": body["stage"], "at": time.time(), "author": actor})
                body["timeline"] = history
            c.execute(
                "INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?,?)",
                (rid, p.kind, p.job, old["author"] if old else actor, p.version + 1, json.dumps(body), time.time()),
            )
            c.execute(
                "INSERT INTO revisions VALUES(?,?,?,?,?)", (rid, p.version + 1, actor, json.dumps(body), time.time())
            )
            audit(c, actor, "write", rid)
            result = unpack(c.execute("SELECT * FROM records WHERE id=?", (rid,)).fetchone())
            c.execute("INSERT INTO idem VALUES(?,?,?,?)", (actor, key, fingerprint, json.dumps(result)))
        return result

    @app.delete("/api/records/{rid}")
    def delete(rid: str, req: Request, version: int):
        owner(req)
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            r = c.execute("SELECT * FROM records WHERE id=?", (rid,)).fetchone()
            if not r:
                raise HTTPException(404)
            if r["version"] != version:
                raise HTTPException(409)
            for related in c.execute("SELECT body FROM records WHERE kind='job' AND id!=?", (rid,)):
                if json.loads(related["body"]).get("primary_id") == rid:
                    raise HTTPException(409, "Delete or relink alternative opportunities first")
            ids = [rid] + [r["id"] for r in c.execute("SELECT id FROM records WHERE job=?", (rid,))]
            for aid in c.execute("SELECT id FROM attachments WHERE job=?", (rid,)).fetchall():
                (uploads / aid["id"]).unlink(missing_ok=True)
            c.execute("DELETE FROM attachments WHERE job=?", (rid,))
            c.executemany("DELETE FROM records WHERE id=?", [(i,) for i in ids])
            c.executemany("DELETE FROM revisions WHERE id=?", [(i,) for i in ids])
            audit(c, "owner", "delete", rid)
        return {"ok": True}

    @app.get("/api/records/{rid}/revisions")
    def revisions(rid: str, req: Request):
        with db() as c:
            r = c.execute("SELECT * FROM records WHERE id=?", (rid,)).fetchone()
            if not r:
                principal(req)
                raise HTTPException(404)
            principal(req, "read", r["job"] or rid)
            return [
                {**dict(x), "body": json.loads(x["body"])}
                for x in c.execute("SELECT * FROM revisions WHERE id=? ORDER BY version DESC", (rid,))
            ]

    @app.get("/api/audit")
    def logs(req: Request):
        owner(req)
        with db() as c:
            return [dict(x) for x in c.execute("SELECT * FROM audit ORDER BY id DESC LIMIT 1000")]

    @app.post("/api/jobs/{job}/attachments")
    async def upload(job: str, req: Request, file: UploadFile):
        actor, _ = principal(req, "attachments:write", job)
        content = await file.read(5 * 1024 * 1024 + 1)
        name = Path((file.filename or "").replace("\\", "/")).name
        if any(ord(ch) < 32 or ord(ch) == 127 for ch in name):
            raise HTTPException(422, "Unsafe filename")
        key = req.headers.get("idempotency-key")
        if not key or len(key) > 200:
            raise HTTPException(400, "Idempotency-Key required for uploads")
        fingerprint = digest(job + name + hashlib.sha256(content).hexdigest())
        suffix = Path(name).suffix.lower()
        if len(content) > 5 * 1024 * 1024 or suffix not in (".pdf", ".txt", ".docx") or not name or len(name) > 180:
            raise HTTPException(422, "Use PDF, TXT or DOCX up to 5 MiB")
        if (suffix == ".pdf" and not content.startswith(b"%PDF-")) or (
            suffix == ".docx" and not content.startswith(b"PK")
        ):
            raise HTTPException(422, "Invalid file signature")
        aid = uuid.uuid4().hex
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            if not c.execute("SELECT id FROM records WHERE id=? AND kind='job'", (job,)).fetchone():
                raise HTTPException(404)
            cached = c.execute("SELECT * FROM idem WHERE actor=? AND key=?", (actor, key)).fetchone()
            if cached:
                if cached["digest"] != fingerprint:
                    raise HTTPException(409, "Idempotency key reused with different content")
                return json.loads(cached["result"])
            version = (
                c.execute("SELECT COUNT(*) FROM attachments WHERE job=? AND filename=?", (job, name)).fetchone()[0] + 1
            )
            (uploads / aid).write_bytes(content)
            c.execute(
                "INSERT INTO attachments VALUES(?,?,?,?,?,?,?)",
                (aid, job, actor, name, "application/octet-stream", version, time.time()),
            )
            audit(c, actor, "upload", aid)
            c.execute(
                "INSERT INTO idem VALUES(?,?,?,?)",
                (actor, key, fingerprint, json.dumps({"id": aid, "filename": name, "version": version})),
            )
        return {"id": aid, "filename": name, "version": version}

    @app.get("/api/jobs/{job}/attachments")
    def files(job: str, req: Request):
        principal(req, "attachments:read", job)
        with db() as c:
            return [dict(r) for r in c.execute("SELECT * FROM attachments WHERE job=? ORDER BY timestamp DESC", (job,))]

    @app.get("/api/attachments/{aid}")
    def download(aid: str, req: Request):
        with db() as c:
            f = c.execute("SELECT * FROM attachments WHERE id=?", (aid,)).fetchone()
        if not f:
            principal(req)
            raise HTTPException(404)
        principal(req, "attachments:read", f["job"])
        return FileResponse(uploads / f["id"], media_type="application/octet-stream", filename=f["filename"])

    @app.delete("/api/attachments/{aid}")
    def remove_attachment(aid: str, req: Request):
        owner(req)
        with db() as c:
            c.execute("DELETE FROM attachments WHERE id=?", (aid,))
            audit(c, "owner", "delete-attachment", aid)
        if len(aid) == 32 and all(x in "0123456789abcdef" for x in aid):
            (uploads / aid).unlink(missing_ok=True)
        return {"ok": True}

    class Credential(BaseModel):
        name: str = Field(pattern=r"^[A-Za-z][A-Za-z0-9_-]{0,39}$")
        scopes: list[str]
        jobs: list[str] = []
        days: int = Field(default=30, ge=1, le=90)

    @app.post("/api/agents")
    def issue(p: Credential, req: Request):
        owner(req)
        if p.name == "owner" or not set(p.scopes) <= {
            "read",
            "jobs:write",
            "contribute",
            "attachments:read",
            "attachments:write",
        }:
            raise HTTPException(422)
        if demo:
            raise HTTPException(403, "Credentials cannot be issued in demo")
        raw = secrets.token_urlsafe(32)
        with db() as c:
            if c.execute("SELECT name FROM tokens WHERE name=?", (p.name,)).fetchone():
                raise HTTPException(409, "Revoke and choose a new credential name")
            c.execute(
                "INSERT INTO tokens VALUES(?,?,?,?,?,0)",
                (digest(raw), p.name, json.dumps(p.scopes), json.dumps(p.jobs), time.time() + p.days * 86400),
            )
            audit(c, "owner", "issue-agent", p.name)
        return {"token": raw, "warning": "Shown once. Store in a secret manager; never in prompts or URLs."}

    @app.get("/api/agents")
    def agents(req: Request):
        owner(req)
        with db() as c:
            return [dict(r) for r in c.execute("SELECT name,scopes,jobs,expires,revoked FROM tokens")]

    @app.delete("/api/agents/{name}")
    def revoke(name: str, req: Request):
        owner(req)
        with db() as c:
            c.execute("UPDATE tokens SET revoked=1 WHERE name=?", (name,))
            audit(c, "owner", "revoke-agent", name)
        return {"ok": True}

    @app.get("/api/export")
    def export(req: Request):
        owner(req)
        with db() as c:
            payload = {
                "schema": 1,
                "records": [unpack(r) for r in c.execute("SELECT * FROM records")],
                "attachments": [dict(r) for r in c.execute("SELECT * FROM attachments")],
                "notice": "Attachment binaries require separate authenticated downloads. Export contains private data.",
            }

        return JSONResponse(
            payload, headers={"Content-Disposition": "attachment; filename=private-job-intel-export.json"}
        )

    @app.get("/api/policy")
    def policy(req: Request):
        principal(req)
        with db() as c:
            r = c.execute("SELECT * FROM records WHERE kind='filters' LIMIT 1").fetchone()
        return (
            unpack(r)
            if r
            else {
                "id": "search-policy",
                "version": 0,
                "kind": "filters",
                "body": {
                    "active_cap": 10,
                    "base_floor": 220000,
                    "lanes": [
                        "Principal / Staff AI technical IC",
                        "Engineering Manager",
                        "Senior+ mobile",
                        "Flexible strongest fit",
                    ],
                    "priorities": "Maximize base salary boost; give Engineering Manager roles serious weight. Unknown or spanning base ranges require qualification. Existing explicit exceptions may be grandfathered.",
                },
            }
        )

    @app.get("/api/schema")
    def schema(req: Request):
        principal(req)
        return app.openapi()

    app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")
    return app


app = create_app() if os.getenv("TRACKER_DEMO") != "1" else create_app(os.getenv("DEMO_DATA_DIR"), demo=True)
