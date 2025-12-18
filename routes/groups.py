# ============================================================================
# BashTower - Groups Routes
# ============================================================================
# API endpoints for managing host groups.
# ============================================================================

from flask import Blueprint, request, jsonify
from sqlalchemy.orm import joinedload
from extensions import db
from models import Host, HostGroup

groups_bp = Blueprint('groups', __name__)


@groups_bp.route('/api/groups', methods=['GET', 'POST'])
def handle_groups():
    if request.method == 'POST':
        data = request.json
        group_name = data.get('name')
        host_ids = data.get('host_ids', [])
        
        if not group_name:
            return jsonify({'error': 'Group name is required'}), 400

        # Check for duplicate name
        existing = HostGroup.query.filter_by(name=group_name).first()
        if existing:
            return jsonify({'error': 'A group with this name already exists'}), 400

        new_group = HostGroup(name=group_name)
        
        # Add hosts to the new group
        if host_ids:
            hosts = Host.query.filter(Host.id.in_(host_ids)).all()
            new_group.hosts.extend(hosts)
            
        db.session.add(new_group)
        db.session.commit()

        return jsonify({
            'id': new_group.id,
            'name': new_group.name,
            'host_ids': [h.id for h in new_group.hosts]
        }), 201

    # GET - Use subqueryload for better performance with collections
    groups = HostGroup.query.all()
    return jsonify([{
        'id': g.id,
        'name': g.name,
        'host_ids': [h.id for h in g.hosts]
    } for g in groups])


@groups_bp.route('/api/groups/<int:group_id>', methods=['PUT', 'DELETE'])
def handle_group_item(group_id):
    group = HostGroup.query.get_or_404(group_id)

    if request.method == 'PUT':
        data = request.json
        new_name = data.get('name', group.name)
        
        # Check for duplicate name (excluding current group)
        if new_name != group.name:
            existing = HostGroup.query.filter_by(name=new_name).first()
            if existing:
                return jsonify({'error': 'A group with this name already exists'}), 400
        
        group.name = new_name
        new_host_ids = set(data.get('host_ids', []))

        # Update host membership
        current_hosts = set(h.id for h in group.hosts)
        
        # Hosts to remove
        hosts_to_remove = current_hosts - new_host_ids
        for host_id in hosts_to_remove:
            host = Host.query.get(host_id)
            if host in group.hosts:
                group.hosts.remove(host)

        # Hosts to add
        hosts_to_add = new_host_ids - current_hosts
        if hosts_to_add:
            hosts = Host.query.filter(Host.id.in_(hosts_to_add)).all()
            group.hosts.extend(hosts)

        db.session.commit()
        return jsonify({
            'id': group.id,
            'name': group.name,
            'host_ids': [h.id for h in group.hosts]
        })

    if request.method == 'DELETE':
        db.session.delete(group)
        db.session.commit()
        return jsonify({'message': 'Deleted'}), 204
