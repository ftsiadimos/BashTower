# ============================================================================
# BashTower - Authentication Routes
# ============================================================================
# API endpoints for user authentication (login, logout, session check).
# ============================================================================

from datetime import datetime
from functools import wraps
from flask import Blueprint, request, jsonify, session, redirect, url_for

from extensions import db
from models import User

auth_bp = Blueprint('auth', __name__)


def login_required(f):
    """Decorator to require authentication for routes."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            # For API calls, return JSON error
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({'error': 'Authentication required'}), 401
            # For page requests, redirect to login
            return redirect(url_for('auth.login_page'))
        return f(*args, **kwargs)
    return decorated_function


def admin_required(f):
    """Decorator to require admin privileges."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': 'Authentication required'}), 401
        user = User.query.get(session['user_id'])
        if not user or not user.is_admin:
            return jsonify({'error': 'Admin privileges required'}), 403
        return f(*args, **kwargs)
    return decorated_function


@auth_bp.route('/login')
def login_page():
    """Serve the login page."""
    from flask import render_template
    # If already logged in, redirect to main app
    if 'user_id' in session:
        return redirect(url_for('index'))
    return render_template('login.html')


@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    """Authenticate user and create session."""
    data = request.json
    username = data.get('username', '').strip()
    password = data.get('password', '')
    
    if not username or not password:
        return jsonify({'error': 'Username and password are required'}), 400
    
    user = User.query.filter_by(username=username).first()
    
    if not user or not user.check_password(password):
        return jsonify({'error': 'Invalid username or password'}), 401
    
    # Update last login
    user.last_login = datetime.utcnow()
    db.session.commit()
    
    # Create session
    session['user_id'] = user.id
    session['username'] = user.username
    session['is_admin'] = user.is_admin
    
    return jsonify({
        'message': 'Login successful',
        'user': user.to_dict()
    })


@auth_bp.route('/api/auth/logout', methods=['POST'])
def logout():
    """Clear user session."""
    session.clear()
    return jsonify({'message': 'Logged out successfully'})


@auth_bp.route('/api/auth/check', methods=['GET'])
def check_auth():
    """Check if user is authenticated."""
    if 'user_id' in session:
        user = User.query.get(session['user_id'])
        if user:
            return jsonify({
                'authenticated': True,
                'user': user.to_dict()
            })
    return jsonify({'authenticated': False}), 401


@auth_bp.route('/api/auth/change-password', methods=['POST'])
@login_required
def change_password():
    """Allow user to change their own password."""
    data = request.json
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')
    
    if not current_password or not new_password:
        return jsonify({'error': 'Current and new password are required'}), 400
    
    if len(new_password) < 6:
        return jsonify({'error': 'New password must be at least 6 characters'}), 400
    
    user = User.query.get(session['user_id'])
    
    if not user.check_password(current_password):
        return jsonify({'error': 'Current password is incorrect'}), 401
    
    user.set_password(new_password)
    db.session.commit()
    
    return jsonify({'message': 'Password changed successfully'})
