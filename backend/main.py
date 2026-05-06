"""FastAPI application for Google Business Scraper & Lead Management."""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_

from .database import get_db, init_db, Lead, ScrapeSession, LeadActivity, utcnow
from .scraper import GoogleMapsScraper, WebsiteAnalyzer, OwnerFinder

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Google Business Scraper & Lead Manager")

# Mount static files
import os
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

# Global scraper state
scraper_tasks: dict[str, asyncio.Task] = {}
scraper_progress: dict[str, dict] = {}


@app.on_event("startup")
async def startup():
    init_db()


@app.get("/", response_class=HTMLResponse)
async def root():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


# ─── Pydantic Models ───────────────────────────────────────────

class ScrapeRequest(BaseModel):
    niche: str
    area: str
    module: str = "all_businesses"  # no_website | all_businesses
    max_results: int = 100
    find_owners: bool = False

class GmbLinkRequest(BaseModel):
    gmb_link: str

class LeadUpdate(BaseModel):
    approach_status: Optional[str] = None
    lead_type: Optional[str] = None
    notes: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    owner_name: Optional[str] = None

class ActivityCreate(BaseModel):
    activity_type: str
    description: str


# ─── Scraper Endpoints ─────────────────────────────────────────

@app.post("/api/scrape/start")
async def start_scrape(req: ScrapeRequest, db: Session = Depends(get_db)):
    """Start a new scrape session."""
    # Create session record
    session = ScrapeSession(
        niche=req.niche,
        area=req.area,
        module=req.module,
        status="running",
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    session_id = session.id

    # Get existing GMB links for dedup
    existing = db.query(Lead.gmb_link).filter(
        Lead.niche == req.niche,
        Lead.area == req.area,
        Lead.gmb_link.isnot(None),
    ).all()
    existing_links = {e[0] for e in existing if e[0]}

    # Also dedup by business name in same area
    existing_names = db.query(Lead.business_name).filter(
        Lead.area == req.area,
    ).all()
    existing_name_set = {e[0].lower() for e in existing_names if e[0]}

    scraper_progress[str(session_id)] = {
        "stage": "starting",
        "total": 0,
        "scraped": 0,
        "skipped": 0,
    }

    async def run_scrape():
        scraper = GoogleMapsScraper()
        db_local = next(get_db())
        try:
            await scraper.start()

            async def progress_cb(data):
                scraper_progress[str(session_id)] = data

            businesses = await scraper.scrape_businesses(
                niche=req.niche,
                area=req.area,
                module=req.module,
                existing_gmb_links=existing_links,
                progress_callback=progress_cb,
                max_results=req.max_results,
            )

            scraper_progress[str(session_id)]["stage"] = "analyzing"

            saved_count = 0
            skipped_count = 0

            for i, biz in enumerate(businesses):
                # Skip duplicates by name
                biz_name_lower = (biz.get("business_name") or "").lower()
                if biz_name_lower in existing_name_set:
                    skipped_count += 1
                    continue

                # Analyze website if present
                seo_data = {}
                if biz.get("website") and req.module == "all_businesses":
                    try:
                        seo_data = await WebsiteAnalyzer.analyze(biz["website"])
                    except Exception as e:
                        logger.warning(f"SEO analysis error for {biz['website']}: {e}")
                        seo_data = {"seo_score": 0, "issues": ["Could not analyze website"], "recommendations": []}

                # Analyze GMB
                gmb_data = WebsiteAnalyzer.analyze_gmb(biz)

                # Find owner if requested
                owner_data = {}
                if req.find_owners and (biz.get("website") or biz.get("business_name")):
                    try:
                        page = await scraper.context.new_page()
                        owner_data = await OwnerFinder.find_owner(
                            biz.get("business_name", ""),
                            biz.get("website", ""),
                            page,
                        )
                        await page.close()
                    except Exception as e:
                        logger.warning(f"Owner find error: {e}")

                # Calculate overall score
                seo_score = seo_data.get("seo_score", 0)
                gmb_score = gmb_data.get("gmb_score", 0)
                overall = (seo_score * 0.5 + gmb_score * 0.5) if biz.get("website") else gmb_score

                # Determine lead type based on score
                if overall >= 70:
                    lead_type = "cold"  # Well optimized, harder to pitch
                elif overall >= 40:
                    lead_type = "warm"  # Some issues, good pitch opportunity
                else:
                    lead_type = "hot"  # Many issues, easy pitch

                # Build audit report
                audit = {
                    "seo": {
                        "score": seo_score,
                        "issues": seo_data.get("issues", []),
                        "recommendations": seo_data.get("recommendations", []),
                    },
                    "gmb": {
                        "score": gmb_score,
                        "issues": gmb_data.get("gmb_issues", []),
                        "recommendations": gmb_data.get("gmb_recommendations", []),
                    },
                }

                # Parse area into components
                area_parts = req.area.split(",")
                city = area_parts[0].strip() if len(area_parts) >= 1 else ""
                state = area_parts[1].strip() if len(area_parts) >= 2 else ""
                country = area_parts[2].strip() if len(area_parts) >= 3 else ""

                lead = Lead(
                    business_name=biz.get("business_name", ""),
                    phone=biz.get("phone", "") or owner_data.get("phone", ""),
                    email=seo_data.get("email", ""),
                    website=biz.get("website", ""),
                    has_website=biz.get("has_website", False),
                    address=biz.get("address", ""),
                    area=req.area,
                    city=city,
                    state=state,
                    country=country,
                    gmb_link=biz.get("gmb_link", ""),
                    category=biz.get("category", ""),
                    rating=biz.get("rating"),
                    review_count=biz.get("review_count"),
                    owner_name=owner_data.get("owner_name", ""),
                    owner_linkedin=owner_data.get("owner_linkedin", ""),
                    owner_social=owner_data.get("owner_social", ""),
                    seo_score=seo_score,
                    gmb_score=gmb_score,
                    overall_score=overall,
                    has_old_website=seo_data.get("has_old_website", False),
                    is_seo_optimized=seo_data.get("is_seo_optimized", False),
                    is_gmb_optimized=gmb_data.get("is_gmb_optimized", False),
                    audit_report=json.dumps(audit),
                    lead_type=lead_type,
                    niche=req.niche,
                    scrape_session_id=session_id,
                )

                try:
                    db_local.add(lead)
                    db_local.commit()
                    saved_count += 1
                    existing_name_set.add(biz_name_lower)
                except Exception:
                    db_local.rollback()
                    skipped_count += 1

                scraper_progress[str(session_id)] = {
                    "stage": "analyzing",
                    "current": i + 1,
                    "total": len(businesses),
                    "scraped": saved_count,
                    "skipped": skipped_count,
                }

            # Update session
            sess = db_local.query(ScrapeSession).get(session_id)
            if sess:
                sess.status = "completed"
                sess.total_found = len(businesses)
                sess.total_scraped = saved_count
                sess.total_skipped = skipped_count
                sess.completed_at = utcnow()
                db_local.commit()

            scraper_progress[str(session_id)] = {
                "stage": "completed",
                "total": len(businesses),
                "scraped": saved_count,
                "skipped": skipped_count,
            }

        except Exception as e:
            logger.error(f"Scrape task error: {e}")
            sess = db_local.query(ScrapeSession).get(session_id)
            if sess:
                sess.status = "failed"
                db_local.commit()
            scraper_progress[str(session_id)] = {
                "stage": "failed",
                "error": str(e),
            }
        finally:
            await scraper.stop()
            db_local.close()

    task = asyncio.create_task(run_scrape())
    scraper_tasks[str(session_id)] = task

    return {"session_id": session_id, "status": "started"}


@app.get("/api/scrape/progress/{session_id}")
async def get_progress(session_id: str):
    """Get scraping progress for a session."""
    progress = scraper_progress.get(session_id, {"stage": "unknown"})
    return progress


@app.get("/api/scrape/sessions")
async def list_sessions(db: Session = Depends(get_db)):
    """List all scrape sessions."""
    sessions = db.query(ScrapeSession).order_by(
        ScrapeSession.created_at.desc()
    ).limit(50).all()
    return [{
        "id": s.id,
        "niche": s.niche,
        "area": s.area,
        "module": s.module,
        "status": s.status,
        "total_found": s.total_found,
        "total_scraped": s.total_scraped,
        "total_skipped": s.total_skipped,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "completed_at": s.completed_at.isoformat() if s.completed_at else None,
    } for s in sessions]


@app.post("/api/scrape/gmb-link")
async def scrape_gmb_link(req: GmbLinkRequest, db: Session = Depends(get_db)):
    """Manually add a lead from a GMB link."""
    # Check for duplicate
    existing = db.query(Lead).filter(Lead.gmb_link == req.gmb_link).first()
    if existing:
        raise HTTPException(400, "This GMB link already exists as a lead")

    scraper = GoogleMapsScraper()
    try:
        await scraper.start()
        biz = await scraper.scrape_gmb_link(req.gmb_link)
        if not biz:
            raise HTTPException(400, "Could not extract business data from this link")

        # Analyze if has website
        seo_data = {}
        if biz.get("website"):
            seo_data = await WebsiteAnalyzer.analyze(biz["website"])

        gmb_data = WebsiteAnalyzer.analyze_gmb(biz)

        seo_score = seo_data.get("seo_score", 0)
        gmb_score = gmb_data.get("gmb_score", 0)
        overall = (seo_score * 0.5 + gmb_score * 0.5) if biz.get("website") else gmb_score

        lead_type = "hot" if overall < 40 else ("warm" if overall < 70 else "cold")

        audit = {
            "seo": {
                "score": seo_score,
                "issues": seo_data.get("issues", []),
                "recommendations": seo_data.get("recommendations", []),
            },
            "gmb": {
                "score": gmb_score,
                "issues": gmb_data.get("gmb_issues", []),
                "recommendations": gmb_data.get("gmb_recommendations", []),
            },
        }

        lead = Lead(
            business_name=biz.get("business_name", ""),
            phone=biz.get("phone", ""),
            email=seo_data.get("email", ""),
            website=biz.get("website", ""),
            has_website=biz.get("has_website", False),
            address=biz.get("address", ""),
            gmb_link=req.gmb_link,
            category=biz.get("category", ""),
            rating=biz.get("rating"),
            review_count=biz.get("review_count"),
            seo_score=seo_score,
            gmb_score=gmb_score,
            overall_score=overall,
            has_old_website=seo_data.get("has_old_website", False),
            is_seo_optimized=seo_data.get("is_seo_optimized", False),
            is_gmb_optimized=gmb_data.get("is_gmb_optimized", False),
            audit_report=json.dumps(audit),
            lead_type=lead_type,
        )

        db.add(lead)
        db.commit()
        db.refresh(lead)

        return {"message": "Lead added successfully", "lead_id": lead.id}

    finally:
        await scraper.stop()


# ─── Lead Management Endpoints ─────────────────────────────────

@app.get("/api/leads")
async def list_leads(
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    niche: Optional[str] = None,
    area: Optional[str] = None,
    lead_type: Optional[str] = None,
    approach_status: Optional[str] = None,
    has_website: Optional[bool] = None,
    search: Optional[str] = None,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    db: Session = Depends(get_db),
):
    """List leads with filters, pagination, and sorting."""
    query = db.query(Lead)

    if niche:
        query = query.filter(Lead.niche == niche)
    if area:
        query = query.filter(Lead.area == area)
    if lead_type:
        query = query.filter(Lead.lead_type == lead_type)
    if approach_status:
        query = query.filter(Lead.approach_status == approach_status)
    if has_website is not None:
        query = query.filter(Lead.has_website == has_website)
    if search:
        query = query.filter(
            or_(
                Lead.business_name.ilike(f"%{search}%"),
                Lead.phone.ilike(f"%{search}%"),
                Lead.email.ilike(f"%{search}%"),
                Lead.category.ilike(f"%{search}%"),
            )
        )

    total = query.count()

    # Sorting
    sort_col = getattr(Lead, sort_by, Lead.created_at)
    if sort_order == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    leads = query.offset((page - 1) * per_page).limit(per_page).all()

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "pages": (total + per_page - 1) // per_page,
        "leads": [_lead_to_dict(l) for l in leads],
    }


@app.get("/api/leads/{lead_id}")
async def get_lead(lead_id: int, db: Session = Depends(get_db)):
    """Get detailed lead info including audit report."""
    lead = db.query(Lead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    d = _lead_to_dict(lead)
    # Include activities
    d["activities"] = [{
        "id": a.id,
        "activity_type": a.activity_type,
        "description": a.description,
        "old_value": a.old_value,
        "new_value": a.new_value,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    } for a in lead.activities]
    return d


@app.put("/api/leads/{lead_id}")
async def update_lead(lead_id: int, update: LeadUpdate, db: Session = Depends(get_db)):
    """Update lead status, notes, or contact info."""
    lead = db.query(Lead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")

    if update.approach_status and update.approach_status != lead.approach_status:
        activity = LeadActivity(
            lead_id=lead_id,
            activity_type="status_change",
            description=f"Status changed from {lead.approach_status} to {update.approach_status}",
            old_value=lead.approach_status,
            new_value=update.approach_status,
        )
        db.add(activity)
        lead.approach_status = update.approach_status

    if update.lead_type and update.lead_type != lead.lead_type:
        activity = LeadActivity(
            lead_id=lead_id,
            activity_type="status_change",
            description=f"Lead type changed from {lead.lead_type} to {update.lead_type}",
            old_value=lead.lead_type,
            new_value=update.lead_type,
        )
        db.add(activity)
        lead.lead_type = update.lead_type

    if update.notes is not None:
        lead.notes = update.notes
    if update.phone is not None:
        lead.phone = update.phone
    if update.email is not None:
        lead.email = update.email
    if update.owner_name is not None:
        lead.owner_name = update.owner_name

    lead.updated_at = utcnow()
    db.commit()
    return {"message": "Lead updated"}


@app.delete("/api/leads/{lead_id}")
async def delete_lead(lead_id: int, db: Session = Depends(get_db)):
    """Delete a lead."""
    lead = db.query(Lead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    db.query(LeadActivity).filter(LeadActivity.lead_id == lead_id).delete()
    db.delete(lead)
    db.commit()
    return {"message": "Lead deleted"}


@app.post("/api/leads/{lead_id}/activity")
async def add_activity(lead_id: int, act: ActivityCreate, db: Session = Depends(get_db)):
    """Add an activity note to a lead."""
    lead = db.query(Lead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")

    activity = LeadActivity(
        lead_id=lead_id,
        activity_type=act.activity_type,
        description=act.description,
    )
    db.add(activity)
    db.commit()
    return {"message": "Activity added"}


@app.get("/api/leads/{lead_id}/audit")
async def get_audit(lead_id: int, db: Session = Depends(get_db)):
    """Get the full audit report for a lead."""
    lead = db.query(Lead).get(lead_id)
    if not lead:
        raise HTTPException(404, "Lead not found")
    audit = json.loads(lead.audit_report) if lead.audit_report else {}
    return {
        "business_name": lead.business_name,
        "website": lead.website,
        "seo_score": lead.seo_score,
        "gmb_score": lead.gmb_score,
        "overall_score": lead.overall_score,
        "is_seo_optimized": lead.is_seo_optimized,
        "is_gmb_optimized": lead.is_gmb_optimized,
        "has_old_website": lead.has_old_website,
        "lead_type": lead.lead_type,
        "audit": audit,
    }


# ─── Dashboard / Stats ────────────────────────────────────────

@app.get("/api/stats")
async def get_stats(db: Session = Depends(get_db)):
    """Get dashboard statistics."""
    total = db.query(func.count(Lead.id)).scalar() or 0
    with_website = db.query(func.count(Lead.id)).filter(Lead.has_website == True).scalar() or 0
    without_website = total - with_website
    hot = db.query(func.count(Lead.id)).filter(Lead.lead_type == "hot").scalar() or 0
    warm = db.query(func.count(Lead.id)).filter(Lead.lead_type == "warm").scalar() or 0
    cold = db.query(func.count(Lead.id)).filter(Lead.lead_type == "cold").scalar() or 0

    contacted = db.query(func.count(Lead.id)).filter(
        Lead.approach_status != "not_contacted"
    ).scalar() or 0

    converted = db.query(func.count(Lead.id)).filter(
        Lead.approach_status == "converted"
    ).scalar() or 0

    avg_seo = db.query(func.avg(Lead.seo_score)).filter(
        Lead.has_website == True
    ).scalar() or 0

    avg_gmb = db.query(func.avg(Lead.gmb_score)).scalar() or 0

    # Niches breakdown
    niches = db.query(
        Lead.niche, func.count(Lead.id)
    ).group_by(Lead.niche).all()

    # Status breakdown
    statuses = db.query(
        Lead.approach_status, func.count(Lead.id)
    ).group_by(Lead.approach_status).all()

    return {
        "total_leads": total,
        "with_website": with_website,
        "without_website": without_website,
        "hot_leads": hot,
        "warm_leads": warm,
        "cold_leads": cold,
        "contacted": contacted,
        "converted": converted,
        "avg_seo_score": round(float(avg_seo), 1),
        "avg_gmb_score": round(float(avg_gmb), 1),
        "niches": {n: c for n, c in niches if n},
        "statuses": {s: c for s, c in statuses},
    }


@app.get("/api/filters")
async def get_filters(db: Session = Depends(get_db)):
    """Get available filter options."""
    niches = db.query(Lead.niche).distinct().filter(Lead.niche.isnot(None)).all()
    areas = db.query(Lead.area).distinct().filter(Lead.area.isnot(None)).all()
    return {
        "niches": [n[0] for n in niches if n[0]],
        "areas": [a[0] for a in areas if a[0]],
        "lead_types": ["hot", "warm", "cold", "new"],
        "approach_statuses": [
            "not_contacted", "emailed", "called", "messaged",
            "follow_up", "converted", "lost",
        ],
    }


# ─── Export ────────────────────────────────────────────────────

@app.get("/api/leads/export/csv")
async def export_csv(
    niche: Optional[str] = None,
    area: Optional[str] = None,
    lead_type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Export leads as CSV."""
    import csv
    import io

    query = db.query(Lead)
    if niche:
        query = query.filter(Lead.niche == niche)
    if area:
        query = query.filter(Lead.area == area)
    if lead_type:
        query = query.filter(Lead.lead_type == lead_type)

    leads = query.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Business Name", "Phone", "Email", "Website", "Address", "Area",
        "Category", "Rating", "Reviews", "GMB Link", "Owner", "LinkedIn",
        "SEO Score", "GMB Score", "Overall Score", "Lead Type", "Status",
    ])

    for l in leads:
        writer.writerow([
            l.business_name, l.phone, l.email, l.website, l.address, l.area,
            l.category, l.rating, l.review_count, l.gmb_link, l.owner_name,
            l.owner_linkedin, l.seo_score, l.gmb_score, l.overall_score,
            l.lead_type, l.approach_status,
        ])

    return JSONResponse(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leads_export.csv"},
    )


def _lead_to_dict(lead: Lead) -> dict:
    return {
        "id": lead.id,
        "business_name": lead.business_name,
        "phone": lead.phone,
        "email": lead.email,
        "website": lead.website,
        "has_website": lead.has_website,
        "address": lead.address,
        "area": lead.area,
        "city": lead.city,
        "state": lead.state,
        "country": lead.country,
        "gmb_link": lead.gmb_link,
        "category": lead.category,
        "rating": lead.rating,
        "review_count": lead.review_count,
        "owner_name": lead.owner_name,
        "owner_linkedin": lead.owner_linkedin,
        "owner_social": lead.owner_social,
        "seo_score": lead.seo_score,
        "gmb_score": lead.gmb_score,
        "overall_score": lead.overall_score,
        "has_old_website": lead.has_old_website,
        "is_seo_optimized": lead.is_seo_optimized,
        "is_gmb_optimized": lead.is_gmb_optimized,
        "audit_report": lead.audit_report,
        "lead_type": lead.lead_type,
        "approach_status": lead.approach_status,
        "notes": lead.notes,
        "niche": lead.niche,
        "created_at": lead.created_at.isoformat() if lead.created_at else None,
        "updated_at": lead.updated_at.isoformat() if lead.updated_at else None,
    }
