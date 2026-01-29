# Copyright (C) 2025 Fotios Tsiadimos
# SPDX-License-Identifier: GPL-3.0-only
#
# ============================================================================
# BashTower - Cron Scheduler Service
# ============================================================================
# Functions for executing and scheduling cron jobs.
# ============================================================================

import logging
import threading
from datetime import datetime
from apscheduler.triggers.cron import CronTrigger
from extensions import db, scheduler
from models import CronJob, CronJobLog, Host, AppSettings
from services.ssh_service import execute_ssh_command

# Configure logger for this module
logger = logging.getLogger(__name__)

# Runtime locks to prevent overlapping executions in the same process
_cron_locks = {}
_lock_registry_lock = threading.Lock()


def cleanup_old_cron_history():
    """Clean up old cron history entries based on settings limit."""
    settings = AppSettings.query.get(1)
    if not settings or not settings.cron_history_limit or settings.cron_history_limit <= 0:
        return 0
    
    limit = settings.cron_history_limit
    total = CronJobLog.query.count()
    
    if total <= limit:
        return 0
    
    # Get IDs of records to keep (most recent)
    keep_ids = [log.id for log in CronJobLog.query.order_by(CronJobLog.created_at.desc()).limit(limit).all()]
    
    # Delete records not in keep list
    deleted = CronJobLog.query.filter(~CronJobLog.id.in_(keep_ids)).delete(synchronize_session=False)
    db.session.commit()
    
    if deleted > 0:
        logger.info(f"Auto-cleaned {deleted} old cron history entries (keeping {limit})")
    
    return deleted


def execute_cron_job(app, cron_job_id):
    """Execute a CronJob by ID.
    This runs the associated template on all hosts defined in the CronJob and
    records per-host output in the CronJobLog table.
    """
    with app.app_context():
        cron = CronJob.query.get(cron_job_id)
        if not cron or not cron.enabled:
            logger.warning(f"Cron job {cron_job_id} not found or disabled, skipping execution")
            return

        # Prevent overlapping executions in this process using a per-cron lock
        with _lock_registry_lock:
            if cron_job_id not in _cron_locks:
                _cron_locks[cron_job_id] = threading.Lock()
            cron_lock = _cron_locks[cron_job_id]

        acquired = cron_lock.acquire(blocking=False)
        if not acquired:
            logger.warning(f"Cron job '{cron.name}' (ID: {cron_job_id}) skipped because a previous run is still in progress")
            return


        # Resolve hosts
        host_ids = [int(x) for x in cron.host_ids.split(',')] if cron.host_ids else []
        hosts = Host.query.filter(Host.id.in_(host_ids)).all()
        template = cron.template
        key = cron.ssh_key

        if not hosts:
            logger.warning(f"Cron job {cron_job_id} has no valid hosts")
            return

        logger.info(f"Executing cron job '{cron.name}' (ID: {cron_job_id}) on {len(hosts)} hosts")

        # Get the script type from template
        script_type = template.script_type or 'bash'

        # Execute on all hosts in parallel
        threads = []
        for host in hosts:
            t = threading.Thread(
                target=execute_ssh_command,
                args=(app, host, key, template.content, cron.id, CronJobLog, script_type)
            )
            threads.append(t)
            t.start()
        
        # Wait for all threads to complete
        for t in threads:
            t.join()

        try:
            # Update last_run timestamp
            cron.last_run = datetime.utcnow()
            db.session.commit()

            # Auto-cleanup old history entries based on settings
            cleanup_old_cron_history()

            logger.info(f"Cron job '{cron.name}' (ID: {cron_job_id}) execution completed")
        finally:
            # Release the lock so future runs can proceed
            try:
                cron_lock.release()
            except Exception:
                pass


def load_cron_jobs_into_scheduler(app):
    """Load all enabled CronJob entries into the APScheduler instance."""
    with app.app_context():
        enabled_jobs = CronJob.query.filter_by(enabled=True).all()
        logger.info(f"Loading {len(enabled_jobs)} enabled cron jobs into scheduler")
        
        for cron in enabled_jobs:
            try:
                trigger = CronTrigger.from_crontab(cron.schedule)
                # If a job with the same ID already exists and is active, replacing it avoids duplicates
                existing = scheduler.get_job(str(cron.id))
                if existing:
                    logger.debug(f"Cron job with ID {cron.id} already scheduled; replacing existing job")
                scheduler.add_job(
                    func=execute_cron_job,
                    trigger=trigger,
                    args=[app, cron.id],
                    id=str(cron.id),
                    replace_existing=True,
                )
                logger.debug(f"Scheduled cron job '{cron.name}' (ID: {cron.id}) with schedule: {cron.schedule}")
            except Exception as e:
                logger.error(f"Failed to schedule cron job {cron.id}: {e}")


def schedule_cron_job(app, cron_job):
    """Schedule a single cron job."""
    try:
        trigger = CronTrigger.from_crontab(cron_job.schedule)
        existing = scheduler.get_job(str(cron_job.id))
        if existing:
            logger.debug(f"Cron job with ID {cron_job.id} already scheduled; replacing existing job")
        scheduler.add_job(
            func=execute_cron_job,
            trigger=trigger,
            args=[app, cron_job.id],
            id=str(cron_job.id),
            replace_existing=True,
        )
        logger.info(f"Scheduled cron job '{cron_job.name}' (ID: {cron_job.id})")
    except Exception as e:
        logger.error(f"Failed to schedule cron job {cron_job.id}: {e}")
