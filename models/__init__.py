# ============================================================================
# BashTower - Database Models
# ============================================================================
# All SQLAlchemy models are defined here.
# ============================================================================

import os
import base64
from datetime import datetime
from cryptography.fernet import Fernet
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db

# --- Encryption Helper ---
# Default key for development - MUST be overridden in production via BASHTOWER_SECRET_KEY
_DEFAULT_KEY = b'rjxrZecZdS2xsSOcrY8EYTi8xK-VocOrrMd6fAlqReA='

def get_encryption_key():
    """Get encryption key from environment or use default."""
    key = os.environ.get('BASHTOWER_SECRET_KEY')
    if key:
        return key.encode() if isinstance(key, str) else key
    return _DEFAULT_KEY

def encrypt_value(value):
    """Encrypt a string value."""
    if not value:
        return value
    try:
        f = Fernet(get_encryption_key())
        return f.encrypt(value.encode()).decode()
    except Exception as e:
        print(f"Encryption error: {e}")
        return value  # Return as-is if encryption fails

def decrypt_value(value):
    """Decrypt an encrypted string value."""
    if not value:
        return value
    try:
        f = Fernet(get_encryption_key())
        return f.decrypt(value.encode()).decode()
    except Exception:
        return value  # Return as-is if decryption fails (might be plain text)


# --- Association Table for Host <-> HostGroup (Many-to-Many) ---
host_group_membership = db.Table('host_group_membership',
    db.Column('host_id', db.Integer, db.ForeignKey('host.id'), primary_key=True),
    db.Column('host_group_id', db.Integer, db.ForeignKey('host_group.id'), primary_key=True)
)


class HostGroup(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)


class Template(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    content = db.Column(db.Text, nullable=False)  # The script content
    script_type = db.Column(db.String(20), default='bash')  # 'bash' or 'python'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Host(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    hostname = db.Column(db.String(200), nullable=False)  # IP or FQDN
    username = db.Column(db.String(100), nullable=False)
    port = db.Column(db.Integer, default=22)
    # Link Host to Groups
    groups = db.relationship('HostGroup', secondary=host_group_membership, 
                            backref=db.backref('hosts', lazy='dynamic'))


class SSHKey(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    # Private key stored encrypted
    _private_key = db.Column('private_key', db.Text, nullable=False)
    
    @property
    def private_key(self):
        """Decrypt and return private key."""
        return decrypt_value(self._private_key)
    
    @private_key.setter
    def private_key(self, value):
        """Encrypt and store private key."""
        self._private_key = encrypt_value(value)


class Job(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    template_name = db.Column(db.String(100))
    status = db.Column(db.String(20), default='running', index=True)  # running, completed, failed
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    logs = db.relationship('JobLog', backref='job', lazy='dynamic', cascade='all, delete-orphan')


class JobLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('job.id'), nullable=False, index=True)
    hostname = db.Column(db.String(200))
    stdout = db.Column(db.Text)
    stderr = db.Column(db.Text)
    status = db.Column(db.String(20), index=True)  # success, error, connection_failed


class SatelliteConfig(db.Model):
    __tablename__ = 'satellite_config'
    id = db.Column(db.Integer, primary_key=True, default=1)
    url = db.Column(db.String(255), nullable=True)
    username = db.Column(db.String(100), nullable=True)
    _password = db.Column('password', db.String(255), nullable=True)
    ssh_username = db.Column(db.String(100), default='ec2-user', nullable=True)
    
    @property
    def password(self):
        """Decrypt and return password."""
        return decrypt_value(self._password)
    
    @password.setter
    def password(self, value):
        """Encrypt and store password."""
        self._password = encrypt_value(value)


class CronJob(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    schedule = db.Column(db.String(100), nullable=False)  # Cron string, e.g., "0 0 * * *"
    template_id = db.Column(db.Integer, db.ForeignKey('template.id'), nullable=False, index=True)
    template = db.relationship('Template', backref='cron_jobs')
    key_id = db.Column(db.Integer, db.ForeignKey('ssh_key.id'), nullable=False)
    ssh_key = db.relationship('SSHKey', backref='cron_jobs')
    host_ids = db.Column(db.Text, nullable=False)  # Store as comma-separated string of host IDs
    enabled = db.Column(db.Boolean, default=True, index=True)
    last_run = db.Column(db.DateTime, nullable=True)
    next_run = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)


class CronJobLog(db.Model):
    __tablename__ = 'cron_job_log'
    id = db.Column(db.Integer, primary_key=True)
    cron_job_id = db.Column(db.Integer, db.ForeignKey('cron_job.id'), nullable=True, index=True)
    hostname = db.Column(db.String(200))
    stdout = db.Column(db.Text)
    stderr = db.Column(db.Text)
    status = db.Column(db.String(20), index=True)  # success, error, connection_failed
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    # Relationship back to CronJob
    cron_job = db.relationship('CronJob', backref=db.backref('logs', lazy='dynamic', cascade='all, delete-orphan'))


class AppSettings(db.Model):
    """Application settings including AI configuration."""
    __tablename__ = 'app_settings'
    id = db.Column(db.Integer, primary_key=True, default=1)
    # AI Provider settings
    ai_provider = db.Column(db.String(50), default='openai')  # openai, gemini, ollama
    _ai_api_key = db.Column('ai_api_key', db.String(500), nullable=True)
    ai_model = db.Column(db.String(100), default='gpt-3.5-turbo')
    ai_endpoint = db.Column(db.String(255), nullable=True)  # For custom endpoints like Ollama
    # Cron history settings
    cron_history_limit = db.Column(db.Integer, default=0)  # 0 = unlimited, otherwise max rows to keep
    
    @property
    def ai_api_key(self):
        """Decrypt and return API key."""
        return decrypt_value(self._ai_api_key)
    
    @ai_api_key.setter
    def ai_api_key(self, value):
        """Encrypt and store API key."""
        self._ai_api_key = encrypt_value(value)


class User(db.Model):
    """User model for authentication."""
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), nullable=True)
    _password_hash = db.Column('password_hash', db.String(256), nullable=False)
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, nullable=True)
    
    def set_password(self, password):
        """Hash and set password."""
        self._password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        """Check password against hash."""
        return check_password_hash(self._password_hash, password)
    
    def to_dict(self):
        return {
            'id': self.id,
            'username': self.username,
            'email': self.email,
            'is_admin': self.is_admin,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_login': self.last_login.isoformat() if self.last_login else None
        }
