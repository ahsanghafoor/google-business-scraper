#!/usr/bin/env python3
"""Entry point for LeadScraper Pro."""

import sys
import asyncio

# On Windows, Playwright requires ProactorEventLoop for subprocess support.
# This must be set before uvicorn starts.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
