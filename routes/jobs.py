# ============================================================================
# BashTower - Jobs Routes
# ============================================================================
# API endpoints for job execution and history.
# ============================================================================

import threading
from flask import Blueprint, request, jsonify, current_app
from extensions import db
from models import Job, Template, Host, HostGroup, SSHKey
from services.ssh_service import run_job_thread

jobs_bp = Blueprint('jobs', __name__)


@jobs_bp.route('/api/run', methods=['POST'])
def run_template():
    data = request.json
    template_id = data.get('template_id')
    
    # Accept both single host IDs and group IDs
    single_host_ids = data.get('host_ids', [])
    group_ids = data.get('host_group_ids', [])
    key_id = data.get('key_id')

    if not template_id or not key_id:
        return jsonify({'error': 'Missing template or key'}), 400

    template = Template.query.get(template_id)
    
    # Resolve all host IDs, starting with manually selected ones
    unique_host_ids = set()
    
    # Add single host IDs
    if single_host_ids:
        try:
            for host_id in single_host_ids:
                unique_host_ids.add(int(host_id))
        except ValueError:
            return jsonify({'error': 'Invalid host ID provided.'}), 400

    # Resolve group hosts and add them (set handles duplicates)
    groups = HostGroup.query.filter(HostGroup.id.in_(group_ids)).all()
    
    for group in groups:
        for host in group.hosts:
            unique_host_ids.add(host.id)
            
    resolved_host_ids = list(unique_host_ids)
    
    if not resolved_host_ids:
        return jsonify({'error': 'No hosts or host groups selected for execution.'}), 400

    # Create Job
    job = Job(template_name=template.name)
    db.session.add(job)
    db.session.commit()

    # Start execution with the resolved host IDs
    app = current_app._get_current_object()
    script_type = template.script_type or 'bash'
    t = threading.Thread(
        target=run_job_thread,
        args=(app, job.id, template_id, resolved_host_ids, key_id, script_type)
    )
    t.start()

    return jsonify({'message': 'Job started', 'id': job.id})


@jobs_bp.route('/api/jobs', methods=['GET'])
def get_jobs():
    jobs = Job.query.order_by(Job.created_at.desc()).limit(20).all()
    return jsonify([{
        'id': j.id,
        'template_name': j.template_name,
        'status': j.status,
        'created_at': str(j.created_at)
    } for j in jobs])


@jobs_bp.route('/api/jobs/<int:job_id>', methods=['GET'])
def get_job_details(job_id):
    job = Job.query.get_or_404(job_id)
    logs = [{
        'hostname': l.hostname,
        'stdout': l.stdout,
        'stderr': l.stderr,
        'status': l.status
    } for l in job.logs]
  
    return jsonify({
        'id': job.id,
        'template_name': job.template_name,
        'status': job.status,
        'created_at': str(job.created_at),
        'logs': logs
    })
