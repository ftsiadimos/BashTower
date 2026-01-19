# ============================================================================
# BashTower - Flask Extensions
# ============================================================================
# Shared Flask extensions (db, scheduler) are initialized here.
# ============================================================================

from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from apscheduler.schedulers.background import BackgroundScheduler

# Database instance
db = SQLAlchemy()

# Migration instance
migrate = Migrate()

# Scheduler instance
scheduler = BackgroundScheduler()
