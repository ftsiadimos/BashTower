# ============================================================================
# BashTower - Cron History Routes
# ============================================================================
# API endpoints for viewing cron job execution history.
# ============================================================================

from flask import Blueprint, request, jsonify
from extensions import db
from models import CronJob, CronJobLog, Template, Host

cronhistory_bp = Blueprint('cronhistory', __name__)


@cronhistory_bp.route('/api/cronhistory', methods=['GET'])
def get_cron_history():
    """Return a list of cron job execution logs with related job and template info."""
    
    # Get search parameter
    search = request.args.get('search', '').strip().lower()
    
    # Join CronJobLog with CronJob and Template to gather the needed fields
    logs = (
        db.session.query(CronJobLog)
        .outerjoin(CronJob, CronJobLog.cron_job_id == CronJob.id)
        .outerjoin(Template, CronJob.template_id == Template.id)
        .order_by(CronJobLog.created_at.desc())
        .all()
    )

    # Build a lookup dict for hostname -> host name
    all_hosts = Host.query.all()
    hostname_to_name = {h.hostname: h.name for h in all_hosts}

    result = []
    for log in logs:
        cron_job_name = getattr(log.cron_job, 'name', None) or ''
        template_name = None
        script_type = 'bash'  # Default
        if getattr(log, 'cron_job', None):
            template_obj = getattr(log.cron_job, 'template', None)
            if template_obj:
                template_name = template_obj.name
                script_type = template_obj.script_type or 'bash'
        
        # Get host name from lookup, fallback to hostname (IP/FQDN)
        host_display_name = hostname_to_name.get(log.hostname)
        
        # Apply search filter
        if search:
            searchable = f"{cron_job_name} {template_name or ''} {log.hostname or ''} {host_display_name or ''} {log.status or ''}".lower()
            if search not in searchable:
                continue
        
        result.append({
            'id': log.id,
            'cron_job_name': cron_job_name,
            'template_name': template_name,
            'script_type': script_type,
            'hostname': log.hostname,
            'host_name': host_display_name,  # Display name if available
            'created_at': log.created_at.isoformat() if log.created_at else None,
            'status': log.status,
            'stdout': log.stdout,
            'stderr': log.stderr,
        })

    # Pagination parameters (default page 1, 20 items per page)
    try:
        page = int(request.args.get('page', 1))
        per_page = int(request.args.get('per_page', 20))
    except ValueError:
        page = 1
        per_page = 20

    # Calculate pagination
    total = len(result)
    offset = (page - 1) * per_page
    paginated = result[offset:offset + per_page]

    return jsonify({
        'logs': paginated,
        'page': page,
        'per_page': per_page,
        'total': total
    })


@cronhistory_bp.route('/api/cronhistory/clean', methods=['DELETE'])
def clean_cron_history():
    """Delete all rows from the CronJobLog table."""
    deleted = db.session.query(CronJobLog).delete(synchronize_session=False)
    db.session.commit()
    return jsonify({'message': f'Cron logs cleaned, {deleted} rows removed.'})
