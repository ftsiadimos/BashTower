# Copyright (C) 2025 Fotios Tsiadimos
# SPDX-License-Identifier: GPL-3.0-only
#
# ============================================================================
# BashTower - User Management Routes
# ============================================================================
# API endpoints for managing users (admin only).
# ============================================================================

from flask import Blueprint, request, jsonify
from extensions import db
from models import User
from routes.auth import admin_required, login_required

users_bp = Blueprint('users', __name__)


@users_bp.route('/api/users', methods=['GET'])
@login_required
def get_users():
    """Get all users (admin sees all, regular users see limited info)."""
    from flask import session
    users = User.query.order_by(User.created_at.desc()).all()
    current_user_id = session.get('user_id')
    result = []
    for u in users:
        user_dict = u.to_dict()
        user_dict['is_current'] = (u.id == current_user_id)
        result.append(user_dict)
    return jsonify(result)


@users_bp.route('/api/users', methods=['POST'])
@admin_required
def create_user():
    """Create a new user (admin only)."""
    data = request.json
    username = data.get('username', '').strip()
    email = (data.get('email') or '').strip() or None
    password = data.get('password', '')
    is_admin = data.get('is_admin', False)
    
    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400
    
    if len(username) < 3:
        return jsonify({'error': 'Username must be at least 3 characters'}), 400
    
    if len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters'}), 400
    
    # Check for duplicate username
    existing = User.query.filter_by(username=username).first()
    if existing:
        return jsonify({'error': f'Username "{username}" already exists'}), 400
    
    user = User(username=username, email=email, is_admin=is_admin)
    user.set_password(password)
    
    db.session.add(user)
    db.session.commit()
    
    return jsonify(user.to_dict()), 201


@users_bp.route('/api/users/<int:user_id>', methods=['PUT'])
@admin_required
def update_user(user_id):
    """Update a user (admin only)."""
    from flask import session
    
    user = User.query.get_or_404(user_id)
    data = request.json
    
    # Update username if provided
    new_username = data.get('username', '').strip()
    if new_username and new_username != user.username:
        existing = User.query.filter_by(username=new_username).first()
        if existing:
            return jsonify({'error': f'Username "{new_username}" already exists'}), 400
        user.username = new_username
    
    # Update email
    if 'email' in data:
        user.email = (data.get('email') or '').strip() or None
    
    # Update password if provided
    new_password = data.get('password', '')
    if new_password:
        if len(new_password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        user.set_password(new_password)
    
    # Update admin status (can't remove own admin)
    if 'is_admin' in data:
        if user.id == session.get('user_id') and not data['is_admin']:
            return jsonify({'error': 'Cannot remove your own admin privileges'}), 400
        user.is_admin = data['is_admin']
    
    db.session.commit()
    return jsonify(user.to_dict())


@users_bp.route('/api/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    """Delete a user (admin only, can't delete self)."""
    from flask import session
    
    if user_id == session.get('user_id'):
        return jsonify({'error': 'Cannot delete your own account'}), 400
    
    user = User.query.get_or_404(user_id)
    db.session.delete(user)
    db.session.commit()
    
    return jsonify({'message': 'User deleted'}), 200
