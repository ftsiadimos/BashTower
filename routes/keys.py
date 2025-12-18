# ============================================================================
# BashTower - SSH Keys Routes
# ============================================================================
# API endpoints for managing SSH keys.
# ============================================================================

from flask import Blueprint, request, jsonify
from extensions import db
from models import SSHKey

keys_bp = Blueprint('keys', __name__)


@keys_bp.route('/api/keys', methods=['GET', 'POST'])
def handle_keys():
    if request.method == 'POST':
        data = request.json
        name = data.get('name', '').strip()
        private_key = data.get('private_key', '')
        
        if not name:
            return jsonify({'error': 'Key name is required'}), 400
        
        if not private_key:
            return jsonify({'error': 'Private key is required'}), 400
        
        # Check for duplicate name
        existing = SSHKey.query.filter_by(name=name).first()
        if existing:
            return jsonify({'error': f'An SSH key with the name "{name}" already exists'}), 400
        
        new_key = SSHKey(name=name, private_key=private_key)
        db.session.add(new_key)
        db.session.commit()
        return jsonify({'id': new_key.id, 'name': new_key.name}), 201
    
    keys = SSHKey.query.all()
    return jsonify([{'id': k.id, 'name': k.name} for k in keys])


@keys_bp.route('/api/keys/<int:id>', methods=['DELETE'])
def delete_key(id):
    key = SSHKey.query.get_or_404(id)
    db.session.delete(key)
    db.session.commit()
    return jsonify({'message': 'Deleted'}), 204
