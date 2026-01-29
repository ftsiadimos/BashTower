# Copyright (C) 2025 Fotios Tsiadimos
# SPDX-License-Identifier: GPL-3.0-only
#
# ============================================================================
# BashTower - Cron Jobs Routes
# ============================================================================
# API endpoints for managing scheduled cron jobs.
# ============================================================================

from flask import Blueprint, request, jsonify, current_app
from croniter import croniter
from extensions import db
from models import CronJob, CronJobLog, Host, host_group_membership
from services.cron_service import schedule_cron_job

cronjobs_bp = Blueprint('cronjobs', __name__)


def validate_cron_expression(expression):
    """Validate a cron expression format."""
    if not expression or not expression.strip():
        return False, "Cron expression is required"
    try:
        croniter(expression.strip())
        return True, None
    except (ValueError, KeyError) as e:
        return False, f"Invalid cron expression: {str(e)}"


@cronjobs_bp.route('/api/cronjobs', methods=['GET', 'POST'])
def handle_cronjobs():
    if request.method == 'POST':
        data = request.json
        name = data.get('name', '').strip()
        
        if not name:
            return jsonify({'error': 'Cron job name is required'}), 400
        
        # Check for duplicate name
        existing = CronJob.query.filter_by(name=name).first()
        if existing:
            return jsonify({'error': f'A cron job with the name "{name}" already exists'}), 400
        
        # Validate cron expression
        schedule = data.get('schedule', '').strip()
        is_valid, error_msg = validate_cron_expression(schedule)
        if not is_valid:
            return jsonify({'error': error_msg}), 400
        
        # Resolve host IDs based on selection type
        host_ids_list = []
        if data.get('host_ids'):
            host_ids_list = data['host_ids']
        elif data.get('group_ids'):
            group_ids = data['group_ids']
            hosts_in_groups = Host.query.join(
                host_group_membership, Host.id == host_group_membership.c.host_id
            ).filter(host_group_membership.c.host_group_id.in_(group_ids)).all()
            host_ids_list = [h.id for h in hosts_in_groups]

        new_cron_job = CronJob(
            name=name,
            schedule=schedule,
            template_id=data['template_id'],
            key_id=data['key_id'],
            host_ids=','.join(map(str, host_ids_list)) if host_ids_list else '',
            enabled=data.get('enabled', True)
        )
        db.session.add(new_cron_job)
        db.session.commit()
        
        # Schedule the newly created cron job
        app = current_app._get_current_object()
        schedule_cron_job(app, new_cron_job)
        
        return jsonify(new_cron_job.id), 201
    else:
        cron_jobs = CronJob.query.all()
        return jsonify([
            {
                'id': c.id,
                'name': c.name,
                'schedule': c.schedule,
                'template_id': c.template_id,
                'key_id': c.key_id,
                'host_ids': [int(x) for x in c.host_ids.split(',')] if c.host_ids else [],
                'enabled': c.enabled,
                'last_run': c.last_run.isoformat() + 'Z' if c.last_run else None,
                'next_run': c.next_run.isoformat() + 'Z' if c.next_run else None,
                'created_at': c.created_at.isoformat() + 'Z'
            } for c in cron_jobs
        ])


@cronjobs_bp.route('/api/cronjobs/<int:cron_job_id>', methods=['PUT', 'DELETE'])
def handle_cron_job_item(cron_job_id):
    cron_job = CronJob.query.get_or_404(cron_job_id)

    if request.method == 'PUT':
        data = request.json
        new_name = data.get('name', '').strip()
        
        if not new_name:
            return jsonify({'error': 'Cron job name is required'}), 400
        
        # Check for duplicate name (excluding current cron job)
        if new_name != cron_job.name:
            existing = CronJob.query.filter_by(name=new_name).first()
            if existing:
                return jsonify({'error': f'A cron job with the name "{new_name}" already exists'}), 400
        
        # Validate cron expression
        schedule = data.get('schedule', '').strip()
        is_valid, error_msg = validate_cron_expression(schedule)
        if not is_valid:
            return jsonify({'error': error_msg}), 400
        
        # Resolve host IDs from either host_ids or group_ids
        host_ids_list = []
        if data.get('host_ids'):
            host_ids_list = data['host_ids']
        elif data.get('group_ids'):
            group_ids = data['group_ids']
            hosts_in_groups = Host.query.join(
                host_group_membership, Host.id == host_group_membership.c.host_id
            ).filter(host_group_membership.c.host_group_id.in_(group_ids)).all()
            host_ids_list = [h.id for h in hosts_in_groups]

        cron_job.name = new_name
        cron_job.schedule = schedule
        cron_job.template_id = data['template_id']
        cron_job.key_id = data['key_id']
        cron_job.host_ids = ','.join(map(str, host_ids_list)) if host_ids_list else ''
        cron_job.enabled = data.get('enabled', True)
        db.session.commit()
        
        # Re-schedule the updated cron job
        app = current_app._get_current_object()
        schedule_cron_job(app, cron_job)
        
        return jsonify({'message': 'Cron job updated'})
    else:
        db.session.delete(cron_job)
        db.session.commit()
        return jsonify({'message': 'Cron job deleted'})


@cronjobs_bp.route('/api/cronjobs/<int:cron_job_id>/logs', methods=['GET'])
def get_cron_job_logs(cron_job_id):
    """Retrieves execution logs for a specific cron job."""
    cron_job = CronJob.query.get_or_404(cron_job_id)
    logs = CronJobLog.query.filter_by(cron_job_id=cron_job.id).order_by(CronJobLog.created_at.desc()).all()

    return jsonify([
        {
            'id': log.id,
            'hostname': log.hostname,
            'stdout': log.stdout,
            'stderr': log.stderr,
            'status': log.status,
            'created_at': log.created_at.isoformat() + 'Z'
        } for log in logs
    ])
