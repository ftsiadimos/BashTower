# ============================================================================
# BashTower - Flask Extensions
# ============================================================================
# Shared Flask extensions (db, scheduler) are initialized here.
# ============================================================================

from flask_sqlalchemy import SQLAlchemy
from apscheduler.schedulers.background import BackgroundScheduler

# Database instance
db = SQLAlchemy()

# Scheduler instance
scheduler = BackgroundScheduler()
