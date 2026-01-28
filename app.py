# Copyright (C) 2025 Fotios Tsiadimos
# SPDX-License-Identifier: GPL-3.0-only
#
# ============================================================================
# BashTower - Main Application Entry Point
# ============================================================================
# This file initializes the Flask application and registers all blueprints.
# The actual route handlers are organized in the /routes directory.
# ===========================================================================

import os
import atexit
import logging
from datetime import timedelta
from flask import Flask, render_template, redirect, url_for, session
from extensions import db, migrate, scheduler
from services.cron_service import load_cron_jobs_into_scheduler


def setup_logging(app):
    """Configure application logging."""
    log_level = os.environ.get('BASHTOWER_LOG_LEVEL', 'INFO').upper()
    log_format = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    
    # Configure root logger
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format=log_format
    )
    
    # Set Flask app logger
    app.logger.setLevel(getattr(logging, log_level, logging.INFO))
    
    # Reduce noise from some libraries
    logging.getLogger('apscheduler').setLevel(logging.WARNING)
    logging.getLogger('paramiko').setLevel(logging.WARNING)
    
    app.logger.info(f"Logging configured at {log_level} level")


def create_app():
    """Application factory for creating the Flask app."""
    app = Flask(__name__)
    # Use Flask permanent sessions when requested (e.g., 'Remember me')
    app.permanent_session_lifetime = timedelta(days=30)
    
    # Configuration from environment variables with defaults
    app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
        'BASHTOWER_DATABASE_URI', 
        'sqlite:///bashtower.db'
    )
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['SECRET_KEY'] = os.environ.get(
        'BASHTOWER_SECRET_KEY', 
        'dev-secret-key-change-in-production'
    )
    
    # Setup logging
    setup_logging(app)
    
    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    
    # Register blueprints
    from routes.templates import templates_bp
    from routes.hosts import hosts_bp
    from routes.groups import groups_bp
    from routes.keys import keys_bp
    from routes.jobs import jobs_bp
    from routes.satellite import satellite_bp
    from routes.cronjobs import cronjobs_bp
    from routes.cronhistory import cronhistory_bp
    from routes.settings import settings_bp
    from routes.auth import auth_bp
    from routes.users import users_bp
    from routes.git_sync import git_sync_bp
    
    app.register_blueprint(templates_bp)
    app.register_blueprint(hosts_bp)
    app.register_blueprint(groups_bp)
    app.register_blueprint(keys_bp)
    app.register_blueprint(jobs_bp)
    app.register_blueprint(satellite_bp)
    app.register_blueprint(cronjobs_bp)
    app.register_blueprint(cronhistory_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(users_bp)
    app.register_blueprint(git_sync_bp)
    
    # Login route
    @app.route('/login')
    def login_page():
        from routes.auth import is_auth_disabled
        # If auth is disabled, skip login and go to main app
        if is_auth_disabled():
            return redirect(url_for('index'))
        if 'user_id' in session:
            return redirect(url_for('index'))
        return render_template('login.html')
    
    # Main route - requires authentication (unless disabled)
    @app.route('/')
    def index():
        from routes.auth import is_auth_disabled
        if not is_auth_disabled() and 'user_id' not in session:
            return redirect(url_for('login_page'))
        return render_template('index.html')
    
    # Create database tables and default admin user
    with app.app_context():
        db.create_all()
        
        # Create default admin user if no users exist
        from models import User
        if User.query.count() == 0:
            default_admin = User(
                username='admin',
                email='admin@localhost',
                is_admin=True
            )
            default_admin.set_password('admin')
            db.session.add(default_admin)
            db.session.commit()
            app.logger.info("Created default admin user (username: admin, password: admin)")
    
    app.logger.info("BashTower application initialized successfully")
    
    return app


# Create the application instance
app = create_app()

# Start the scheduler
scheduler.start()
app.logger.info("Background scheduler started")

# Load cron jobs into scheduler
load_cron_jobs_into_scheduler(app)

# Shut down the scheduler when exiting the app
atexit.register(lambda: scheduler.shutdown())


if __name__ == '__main__':
    app.run(debug=True, port=5000)
