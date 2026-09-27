"""FastAPI application: the JSON API plus the built React UI."""

from __future__ import annotations

import re
from collections.abc import Iterator
from importlib import resources
from pathlib import Path
from typing import Annotated, Any
from urllib.parse import quote, urlparse

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__, dice, game, rules, schemas, srd, transfer
from .db import Database
from .repo import KINDS, SCHEMAS, SINGULAR, NotFound, Repo, title_of

MAX_BODY = 20 * 1024 * 1024
WEB_DIR = Path(str(resources.files("pocket_dm").joinpath("web")))


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower() or "export"


def _attachment(filename: str) -> dict[str, str]:
    return {"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"}


def get_repo(request: Request) -> Iterator[Repo]:
    with request.app.state.db.session() as s:
        yield Repo(s)


RepoDep = Annotated[Repo, Depends(get_repo)]


# --------------------------------------------------------------------------- tools and reference


tools = APIRouter(tags=["tools"])


@tools.get("/meta")
def meta(request: Request) -> dict:
    db: Database = request.app.state.db
    return {
        "version": __version__,
        "data_dir": str(db.data_dir or ""),
        "database": str(db.path or ""),
        "srd": srd.meta(),
        "abilities": rules.ABILITY_NAMES,
        "skills": rules.SKILLS,
        "conditions": rules.CONDITIONS,
        "hit_dice": rules.HIT_DICE,
        "xp_by_level": rules.XP_BY_LEVEL,
        "cr_xp": rules.CR_XP,
        "spell_slots": rules.SPELL_SLOTS,
        "point_buy": {"cost": rules.POINT_BUY_COST, "budget": rules.POINT_BUY_BUDGET},
        "standard_array": rules.STANDARD_ARRAY,
    }


def _roll(expr: str, times: int) -> dict:
    if not expr.strip():
        raise ValueError("missing expression")
    results = [dice.roll(expr).to_dict() for _ in range(times)]
    return results[0] if times == 1 else {"results": results}


@tools.get("/roll")
def roll_get(expr: str, times: Annotated[int, Query(ge=1, le=100)] = 1) -> dict:
    return _roll(expr, times)


@tools.post("/roll")
def roll_post(body: schemas.Expression, times: Annotated[int, Query(ge=1, le=100)] = 1) -> dict:
    return _roll(body.expression, times)


@tools.post("/stats")
def stats() -> dict:
    return {"results": [r.to_dict() for r in dice.roll_stats()]}


@tools.post("/derive")
def derive(body: schemas.Character) -> dict:
    return rules.derive(body.model_dump())


@tools.post("/slots")
def slots(body: schemas.ClassesIn) -> dict:
    return {"slots": rules.spell_slots_for([c.model_dump() for c in body.classes])}


@tools.get("/srd/categories")
def srd_categories() -> dict:
    return {"categories": srd.categories(), "meta": srd.meta()}


@tools.get("/srd/search")
def srd_search(
    request: Request,
    q: str = "",
    category: str = "",
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    # Any other query parameter filters on the entry's structured data (level=3, cr_label=1/4, ...).
    filters = {k: v for k, v in request.query_params.items() if k not in ("q", "category", "limit", "offset")}
    return srd.search(q, category, limit=limit, offset=offset, **filters)


@tools.get("/srd/entry")
def srd_entry(id: str) -> dict:
    entry = srd.get(id)
    if not entry:
        raise NotFound("entry not found")
    return entry


# --------------------------------------------------------------------------- import / export


transfers = APIRouter(tags=["import/export"])


@transfers.get("/export")
def export_bundle(repo: RepoDep, campaign_id: str = "") -> JSONResponse:
    bundle = transfer.export_bundle(repo, campaign_id or None)
    name = repo.get("campaigns", campaign_id)["name"] if campaign_id else "pocket-dm-backup"
    return JSONResponse(bundle, headers=_attachment(f"{_slug(name)}.pocketdm.json"))


@transfers.get("/export/{kind}/{doc_id}")
def export_one(repo: RepoDep, kind: str, doc_id: str, format: str = "json") -> Response:
    if kind not in KINDS:
        raise NotFound("unknown kind")
    doc = repo.get(kind, doc_id)
    title = _slug(title_of(kind, doc))
    if format != "md":
        return JSONResponse(
            transfer.export_one(repo, kind, doc_id), headers=_attachment(f"{title}.{SINGULAR[kind]}.json")
        )
    if kind == "characters":
        text = transfer.character_markdown(doc)
    elif kind == "sessions":
        cid = doc["campaign_id"]
        text = transfer.session_markdown(doc, repo.get("campaigns", cid)["name"] if cid else "")
    elif kind == "handbook":
        text = f"# {doc['title']}\n\n{doc['body']}\n"
    else:
        raise ValueError("Markdown export is available for characters, sessions and handbook entries")
    return Response(text, media_type="text/markdown; charset=utf-8", headers=_attachment(f"{title}.md"))


@transfers.post("/import")
def import_data(repo: RepoDep, payload: Annotated[Any, Body()], mode: str = "overwrite") -> dict:
    return transfer.import_data(repo, payload, mode)


@transfers.post("/import/markdown")
def import_markdown(repo: RepoDep, body: schemas.MarkdownImport) -> dict:
    created = []
    for f in body.files:
        entry = transfer.markdown_to_handbook(f.text, f.filename)
        entry["campaign_id"] = body.campaign_id
        created.append(repo.create("handbook", entry))
    return {"created": created}


# --------------------------------------------------------------------------- records


def records_router(kind: str) -> APIRouter:
    """List/create/read/update/delete for one kind of record."""
    schema = SCHEMAS[kind]
    router = APIRouter(prefix=f"/{kind}", tags=[kind])

    @router.get("", response_model=dict[str, list[schema]])
    def list_(repo: RepoDep, campaign_id: str = ""):
        return {kind: repo.list(kind, campaign_id=campaign_id or None)}

    @router.post("", status_code=201, response_model=schema)
    def create(repo: RepoDep, body: Annotated[dict[str, Any] | None, Body()] = None):
        return repo.create(kind, body)

    @router.get("/{doc_id}", response_model=schema)
    def read(repo: RepoDep, doc_id: str):
        return repo.get(kind, doc_id)

    @router.put("/{doc_id}", response_model=schema)
    def update(repo: RepoDep, doc_id: str, body: Annotated[dict[str, Any], Body()]):
        return repo.update(kind, doc_id, body)

    @router.delete("/{doc_id}")
    def delete(repo: RepoDep, doc_id: str) -> dict:
        repo.delete(kind, doc_id)
        return {"deleted": doc_id}

    return router


sessions = APIRouter(prefix="/sessions", tags=["sessions"])


@sessions.post("/{doc_id}/encounter")
def encounter(repo: RepoDep, doc_id: str, body: schemas.EncounterAction) -> schemas.Session:
    return game.encounter_action(repo, doc_id, body)


@sessions.post("/{doc_id}/award")
def award(repo: RepoDep, doc_id: str, body: schemas.Award) -> schemas.Session:
    return game.award(repo, doc_id, body)


@sessions.post("/{doc_id}/log")
def log(repo: RepoDep, doc_id: str, body: schemas.LogIn) -> schemas.Session:
    return game.add_log(repo, doc_id, body)


characters = APIRouter(prefix="/characters", tags=["characters"])


@characters.post("/{doc_id}/rest")
def rest(repo: RepoDep, doc_id: str, body: schemas.RestIn) -> schemas.Character:
    return game.rest(repo, doc_id, body.type)


# --------------------------------------------------------------------------- app


def create_app(db: Database, web_dir: Path | None = WEB_DIR) -> FastAPI:
    app = FastAPI(title="Pocket DM", version=__version__)
    app.state.db = db

    api = APIRouter(prefix="/api")
    for router in (tools, transfers, sessions, characters, *(records_router(k) for k in KINDS)):
        api.include_router(router)
    app.include_router(api)

    @app.middleware("http")
    async def guard_writes(request: Request, call_next):
        if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
            # Block cross-site writes from other pages open in the browser.
            origin = request.headers.get("origin")
            if origin and urlparse(origin).netloc != request.headers.get("host"):
                return JSONResponse({"detail": "cross-origin request refused"}, 403)
            if int(request.headers.get("content-length") or 0) > MAX_BODY:
                return JSONResponse({"detail": "request too large"}, 413)
        return await call_next(request)

    def error(status: int):
        return lambda _request, exc: JSONResponse({"detail": str(exc.args[0] if exc.args else exc)}, status)

    app.add_exception_handler(NotFound, error(404))
    app.add_exception_handler(ValueError, error(400))  # includes dice, transfer and validation errors

    _mount_ui(app, web_dir)
    return app


def _mount_ui(app: FastAPI, web_dir: Path | None) -> None:
    index = web_dir / "index.html" if web_dir else None
    if not index or not index.is_file():

        @app.get("/", include_in_schema=False)
        def not_built() -> HTMLResponse:
            return HTMLResponse(
                "<h1>Pocket DM</h1><p>The UI hasn't been built yet. Run <code>npm run build</code> "
                "in <code>frontend/</code>, or use the Vite dev server (<code>npm run dev</code>).</p>"
                '<p>The API is up: see <a href="/docs">/docs</a>.</p>'
            )

        return

    app.mount("/assets", StaticFiles(directory=web_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        f = (web_dir / path).resolve()
        if path and f.is_file() and f.is_relative_to(web_dir.resolve()):
            return FileResponse(f)
        return FileResponse(index)  # client-side routes
