# Copyright (C) 2025 Fotios Tsiadimos
# SPDX-License-Identifier: GPL-3.0-only
#
# ============================================================================
# BashTower - Flask Extensions
# ============================================================================
# Shared Flask extensions (db, scheduler) are initialized here.
# ===========================================================================

from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from apscheduler.schedulers.background import BackgroundScheduler

# Database instance
db = SQLAlchemy()

# Migration instance
migrate = Migrate()

# Scheduler instance
# Configure with max_instances=1 to avoid duplicate overlapping job executions
scheduler = BackgroundScheduler(job_defaults={'max_instances': 1})

# Flask app instance reference (set by app.py after creation)
# Used by scheduler jobs to access app context
app_context = None

