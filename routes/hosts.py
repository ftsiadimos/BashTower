# ============================================================================
# BashTower - Hosts Routes
# ============================================================================
# API endpoints for managing remote hosts.
# ============================================================================

from flask import Blueprint, request, jsonify
from sqlalchemy.orm import joinedload
from extensions import db
from models import Host

hosts_bp = Blueprint('hosts', __name__)


@hosts_bp.route('/api/hosts', methods=['GET', 'POST'])
def handle_hosts():
    if request.method == 'POST':
        data = request.json
        new_host = Host(
            name=data.get('name', data['hostname']),
            hostname=data['hostname'],
            username=data['username'],
            port=int(data.get('port', 22))
        )
        db.session.add(new_host)
        db.session.commit()
        return jsonify({
            'id': new_host.id,
            'name': new_host.name,
            'hostname': new_host.hostname,
            'username': new_host.username,
            'port': new_host.port,
            'groups': []
        }), 201
    
    # Use joinedload to eagerly load groups in a single query
    hosts = Host.query.options(joinedload(Host.groups)).all()
    return jsonify([{
        'id': h.id,
        'name': h.name,
        'hostname': h.hostname,
        'username': h.username,
        'port': h.port,
        'group_ids': [g.id for g in h.groups]
    } for h in hosts])


@hosts_bp.route('/api/hosts/<int:id>', methods=['PUT'])
def update_host(id):
    host = Host.query.get_or_404(id)
    data = request.json
    
    host.name = data.get('name', host.name)
    host.hostname = data.get('hostname', host.hostname)
    host.username = data.get('username', host.username)
    host.port = int(data.get('port', host.port or 22))
    
    db.session.commit()
    return jsonify({
        'id': host.id,
        'name': host.name,
        'hostname': host.hostname,
        'username': host.username,
        'port': host.port,
        'group_ids': [g.id for g in host.groups]
    })


@hosts_bp.route('/api/hosts/<int:id>', methods=['DELETE'])
def delete_host(id):
    host = Host.query.get_or_404(id)
    db.session.delete(host)
    db.session.commit()
    return jsonify({'message': 'Deleted'}), 204
