"""Database models and connection setup using SQLAlchemy + SQLite."""

import os
from datetime import datetime, timezone
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, Float, Boolean,
    DateTime, ForeignKey, UniqueConstraint, Index
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "leads.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PATH}", echo=False,
                       connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Lead(Base):
    __tablename__ = "leads"

    id = Column(Integer, primary_key=True, autoincrement=True)
    business_name = Column(String(500), nullable=False)
    phone = Column(String(100))
    email = Column(String(300))
    website = Column(String(1000))
    has_website = Column(Boolean, default=False)
    address = Column(Text)
    area = Column(String(300))
    city = Column(String(200))
    state = Column(String(200))
    country = Column(String(200))
    gmb_link = Column(String(1000))
    category = Column(String(300))
    rating = Column(Float)
    review_count = Column(Integer)
    owner_name = Column(String(300))
    owner_linkedin = Column(String(500))
    owner_social = Column(Text)  # JSON string of social links

    # SEO / Audit fields
    seo_score = Column(Float, default=0)
    gmb_score = Column(Float, default=0)
    overall_score = Column(Float, default=0)
    has_old_website = Column(Boolean, default=False)
    is_seo_optimized = Column(Boolean, default=False)
    is_gmb_optimized = Column(Boolean, default=False)
    audit_report = Column(Text)  # JSON string

    # Lead management
    lead_type = Column(String(50), default="new")  # new, warm, hot, cold
    approach_status = Column(String(50), default="not_contacted")
    # not_contacted, emailed, called, messaged, follow_up, converted, lost
    notes = Column(Text)

    # Scrape metadata
    niche = Column(String(300))
    scrape_session_id = Column(Integer, ForeignKey("scrape_sessions.id"))
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    scrape_session = relationship("ScrapeSession", back_populates="leads")
    activities = relationship("LeadActivity", back_populates="lead",
                              order_by="LeadActivity.created_at.desc()")

    __table_args__ = (
        UniqueConstraint("business_name", "gmb_link", name="uq_business_gmb"),
        Index("ix_leads_niche_area", "niche", "area"),
    )


class ScrapeSession(Base):
    __tablename__ = "scrape_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    niche = Column(String(300), nullable=False)
    area = Column(String(500), nullable=False)
    module = Column(String(50), nullable=False)  # no_website, all_businesses
    status = Column(String(50), default="running")  # running, completed, failed
    total_found = Column(Integer, default=0)
    total_scraped = Column(Integer, default=0)
    total_skipped = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow)
    completed_at = Column(DateTime)

    leads = relationship("Lead", back_populates="scrape_session")


class LeadActivity(Base):
    __tablename__ = "lead_activities"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lead_id = Column(Integer, ForeignKey("leads.id"), nullable=False)
    activity_type = Column(String(50), nullable=False)
    # status_change, note, email_sent, call_made, message_sent
    description = Column(Text)
    old_value = Column(String(200))
    new_value = Column(String(200))
    created_at = Column(DateTime, default=utcnow)

    lead = relationship("Lead", back_populates="activities")


def init_db():
    Base.metadata.create_all(engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
