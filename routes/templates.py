# Copyright (C) 2025 Fotios Tsiadimos
# SPDX-License-Identifier: GPL-3.0-only
#
# ============================================================================
# BashTower - Templates Routes
# ============================================================================
# API endpoints for managing script templates.
# ============================================================================

from flask import Blueprint, request, jsonify
from extensions import db
from models import Template, CronJob

templates_bp = Blueprint('templates', __name__)


@templates_bp.route('/api/templates', methods=['GET', 'POST'])
def handle_templates():
    if request.method == 'POST':
        data = request.json
        name = data.get('name', '').strip()
        script = data.get('script', '')
        script_type = data.get('script_type', 'bash')  # Default to bash
        arguments = data.get('arguments')  # JSON string of argument definitions
        
        if not name:
            return jsonify({'error': 'Template name is required'}), 400
        
        if not script:
            return jsonify({'error': 'Template script is required'}), 400
        
        # Validate script_type
        if script_type not in ['bash', 'python']:
            script_type = 'bash'
        
        # Check for duplicate name
        existing = Template.query.filter_by(name=name).first()
        if existing:
            return jsonify({'error': f'A template with the name "{name}" already exists'}), 400
        
        new_template = Template(name=name, content=script, script_type=script_type, arguments=arguments)
        db.session.add(new_template)
        db.session.commit()
        return jsonify({
            'id': new_template.id, 
            'name': new_template.name, 
            'script': new_template.content,
            'script_type': new_template.script_type,
            'arguments': new_template.arguments
        }), 201

    templates = Template.query.all()
    return jsonify([{
        'id': t.id, 
        'name': t.name, 
        'script': t.content,
        'script_type': t.script_type or 'bash',
        'arguments': t.arguments
    } for t in templates])


@templates_bp.route('/api/templates/<int:id>', methods=['GET', 'PUT', 'DELETE'])
def handle_template_item(id):
    template = Template.query.get_or_404(id)

    if request.method == 'PUT':
        data = request.json
        new_name = data.get('name', template.name).strip()
        script_type = data.get('script_type', template.script_type or 'bash')
        
        # Validate script_type
        if script_type not in ['bash', 'python']:
            script_type = 'bash'
        
        # Check for duplicate name (excluding current template)
        if new_name != template.name:
            existing = Template.query.filter_by(name=new_name).first()
            if existing:
                return jsonify({'error': f'A template with the name "{new_name}" already exists'}), 400
        
        template.name = new_name
        template.content = data.get('script', template.content)
        template.script_type = script_type
        template.arguments = data.get('arguments', template.arguments)
        db.session.commit()
        return jsonify({
            'id': template.id,
            'name': template.name,
            'script': template.content,
            'script_type': template.script_type,
            'arguments': template.arguments
        })

    if request.method == 'DELETE':
        # Check if template is used by any cron jobs
        cron_jobs_using_template = CronJob.query.filter_by(template_id=template.id).all()
        if cron_jobs_using_template:
            cron_job_names = [cj.name for cj in cron_jobs_using_template]
            return jsonify({
                'error': 'Template is in use',
                'message': f'Cannot delete template. It is used by the following cron jobs: {", ".join(cron_job_names)}',
                'cron_jobs': cron_job_names
            }), 400
        db.session.delete(template)
        db.session.commit()
        return jsonify({'message': 'Deleted'}), 204
    
    return jsonify({
        'id': template.id, 
        'name': template.name, 
        'script': template.content,
        'script_type': template.script_type or 'bash',
        'arguments': template.arguments
    })
