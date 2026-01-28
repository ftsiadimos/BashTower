# ============================================================================
# BashTower - Git Sync Routes
# ============================================================================
# API endpoints for Git repository synchronization of templates.
# ============================================================================

import os
import json
import shutil
import tempfile
import subprocess
from datetime import datetime
from flask import Blueprint, request, jsonify
from extensions import db
from models import GitRepoConfig, Template, Host, HostGroup, SSHKey, CronJob, User, SatelliteConfig, AppSettings

git_sync_bp = Blueprint('git_sync', __name__)


def is_git_available():
    """Check if git command is available."""
    try:
        result = subprocess.run(
            ['git', '--version'],
            capture_output=True,
            text=True,
            timeout=10
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def get_git_config():
    """Get or create Git configuration."""
    config = GitRepoConfig.query.get(1)
    if not config:
        config = GitRepoConfig(id=1)
        db.session.add(config)
        db.session.commit()
    return config


def run_git_command(cmd, cwd=None, env=None):
    """Run a git command and return output."""
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            timeout=60
        )
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, '', 'Command timed out'
    except FileNotFoundError:
        return False, '', 'Git is not installed. Please install git on the server.'
    except Exception as e:
        return False, '', str(e)


def build_authenticated_url(repo_url, token):
    """Build an authenticated Git URL with token."""
    if not token:
        return repo_url
    
    # Handle HTTPS URLs
    if repo_url.startswith('https://'):
        # Insert token: https://token@github.com/...
        return repo_url.replace('https://', f'https://{token}@')
    
    # Handle HTTP URLs
    if repo_url.startswith('http://'):
        # Insert token: http://token@host/...
        return repo_url.replace('http://', f'http://{token}@')
    
    return repo_url


@git_sync_bp.route('/api/git/config', methods=['GET'])
def get_config():
    """Get current Git repository configuration."""
    config = get_git_config()
    
    # Mask token for security
    masked_token = ''
    if config.access_token:
        masked_token = '*' * 20 + config.access_token[-4:] if len(config.access_token) > 4 else '****'
    
    return jsonify({
        'repo_url': config.repo_url or '',
        'branch': config.branch or 'main',
        'access_token': masked_token,
        'last_sync': config.last_sync.isoformat() if config.last_sync else None,
        'sync_status': config.sync_status,
        'configured': bool(config.repo_url)
    })


@git_sync_bp.route('/api/git/config', methods=['POST'])
def save_config():
    """Save Git repository configuration."""
    data = request.json
    config = get_git_config()
    
    repo_url = data.get('repo_url', '').strip()
    branch = data.get('branch', 'main').strip() or 'main'
    access_token = data.get('access_token', '')
    
    # Validate repo URL
    if repo_url and not (repo_url.startswith('https://') or repo_url.startswith('http://') or repo_url.startswith('git@')):
        return jsonify({'error': 'Repository URL must start with https://, http://, or git@'}), 400
    
    config.repo_url = repo_url
    config.branch = branch
    
    # Only update token if not masked (i.e., user provided a new one)
    if access_token and not access_token.startswith('*'):
        config.access_token = access_token
    elif not access_token:
        config.access_token = None
    
    db.session.commit()
    
    return jsonify({
        'message': 'Git configuration saved',
        'configured': bool(config.repo_url)
    })


@git_sync_bp.route('/api/git/test', methods=['POST'])
def test_connection():
    """Test Git repository connection."""
    # Check if git is available
    if not is_git_available():
        return jsonify({'error': 'Git is not installed on the server. Please install git to use this feature.'}), 400
    
    config = get_git_config()
    
    if not config.repo_url:
        return jsonify({'error': 'No repository URL configured'}), 400
    
    # Create a temporary directory to test clone
    temp_dir = tempfile.mkdtemp(prefix='bashtower_git_test_')
    
    try:
        auth_url = build_authenticated_url(config.repo_url, config.access_token)
        
        # Test with ls-remote (doesn't clone the whole repo)
        success, stdout, stderr = run_git_command(
            ['git', 'ls-remote', '--heads', auth_url],
            cwd=temp_dir
        )
        
        if success:
            return jsonify({
                'message': 'Connection successful',
                'branches': [line.split('refs/heads/')[-1] for line in stdout.strip().split('\n') if 'refs/heads/' in line]
            })
        else:
            return jsonify({'error': f'Failed to connect: {stderr}'}), 400
            
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@git_sync_bp.route('/api/git/export', methods=['POST'])
def export_to_git():
    """Export all templates to the Git repository."""
    # Check if git is available
    if not is_git_available():
        return jsonify({'error': 'Git is not installed on the server. Please install git to use this feature.'}), 400
    
    config = get_git_config()
    
    if not config.repo_url:
        return jsonify({'error': 'No repository URL configured'}), 400
    
    templates = Template.query.all()
    if not templates:
        return jsonify({'error': 'No templates to export'}), 400
    
    temp_dir = tempfile.mkdtemp(prefix='bashtower_git_export_')
    
    try:
        auth_url = build_authenticated_url(config.repo_url, config.access_token)
        branch = config.branch or 'main'
        
        # Clone the repository
        success, _, stderr = run_git_command(
            ['git', 'clone', '--branch', branch, '--single-branch', auth_url, '.'],
            cwd=temp_dir
        )
        
        # If branch doesn't exist, clone default and create branch
        if not success:
            success, _, stderr = run_git_command(
                ['git', 'clone', auth_url, '.'],
                cwd=temp_dir
            )
            if not success:
                config.sync_status = 'error'
                db.session.commit()
                return jsonify({'error': f'Failed to clone repository: {stderr}'}), 400
            
            # Create and checkout the branch
            run_git_command(['git', 'checkout', '-b', branch], cwd=temp_dir)
        
        # Create scripts directory
        scripts_dir = os.path.join(temp_dir, 'scripts')
        os.makedirs(scripts_dir, exist_ok=True)
        
        # Export templates
        manifest = []
        for template in templates:
            # Determine file extension
            ext = '.py' if template.script_type == 'python' else '.sh'
            # Sanitize filename
            safe_name = "".join(c if c.isalnum() or c in '-_' else '_' for c in template.name)
            filename = f"{safe_name}{ext}"
            filepath = os.path.join(scripts_dir, filename)
            
            # Write script file
            with open(filepath, 'w') as f:
                f.write(template.content)
            
            manifest.append({
                'id': template.id,
                'name': template.name,
                'filename': filename,
                'script_type': template.script_type or 'bash',
                'arguments': template.arguments,
                'created_at': template.created_at.isoformat() if template.created_at else None
            })
        
        # Write manifest file
        manifest_path = os.path.join(temp_dir, 'templates_manifest.json')
        with open(manifest_path, 'w') as f:
            json.dump({
                'version': '1.0',
                'exported_at': datetime.utcnow().isoformat(),
                'templates': manifest
            }, f, indent=2)
        
        # Configure git user for commit
        run_git_command(['git', 'config', 'user.email', 'bashtower@local'], cwd=temp_dir)
        run_git_command(['git', 'config', 'user.name', 'BashTower'], cwd=temp_dir)
        
        # Add all files
        run_git_command(['git', 'add', '-A'], cwd=temp_dir)
        
        # Check if there are changes
        success, stdout, _ = run_git_command(['git', 'status', '--porcelain'], cwd=temp_dir)
        if not stdout.strip():
            config.sync_status = 'success'
            config.last_sync = datetime.utcnow()
            db.session.commit()
            return jsonify({'message': 'No changes to export', 'exported': 0})
        
        # Commit
        commit_msg = f"BashTower export: {len(templates)} templates"
        success, _, stderr = run_git_command(['git', 'commit', '-m', commit_msg], cwd=temp_dir)
        if not success:
            config.sync_status = 'error'
            db.session.commit()
            return jsonify({'error': f'Failed to commit: {stderr}'}), 400
        
        # Push
        success, _, stderr = run_git_command(['git', 'push', '-u', 'origin', branch], cwd=temp_dir)
        if not success:
            config.sync_status = 'error'
            db.session.commit()
            return jsonify({'error': f'Failed to push: {stderr}'}), 400
        
        # Update sync status
        config.sync_status = 'success'
        config.last_sync = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'message': f'Successfully exported {len(templates)} templates to Git',
            'exported': len(templates)
        })
        
    except Exception as e:
        config.sync_status = 'error'
        db.session.commit()
        return jsonify({'error': str(e)}), 500
        
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@git_sync_bp.route('/api/git/import', methods=['POST'])
def import_from_git():
    """Import templates from the Git repository."""
    # Check if git is available
    if not is_git_available():
        return jsonify({'error': 'Git is not installed on the server. Please install git to use this feature.'}), 400
    
    config = get_git_config()
    
    if not config.repo_url:
        return jsonify({'error': 'No repository URL configured'}), 400
    
    data = request.json or {}
    overwrite = data.get('overwrite', False)  # Whether to overwrite existing templates
    
    temp_dir = tempfile.mkdtemp(prefix='bashtower_git_import_')
    
    try:
        auth_url = build_authenticated_url(config.repo_url, config.access_token)
        branch = config.branch or 'main'
        
        # Clone the repository
        success, _, stderr = run_git_command(
            ['git', 'clone', '--branch', branch, '--single-branch', '--depth', '1', auth_url, '.'],
            cwd=temp_dir
        )
        
        if not success:
            config.sync_status = 'error'
            db.session.commit()
            return jsonify({'error': f'Failed to clone repository: {stderr}'}), 400
        
        # Check for manifest file
        manifest_path = os.path.join(temp_dir, 'templates_manifest.json')
        scripts_dir = os.path.join(temp_dir, 'scripts')
        
        imported = 0
        skipped = 0
        errors = []
        
        if os.path.exists(manifest_path):
            # Import using manifest
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
            
            for entry in manifest.get('templates', []):
                try:
                    filename = entry.get('filename')
                    name = entry.get('name')
                    script_type = entry.get('script_type', 'bash')
                    arguments = entry.get('arguments')
                    
                    filepath = os.path.join(scripts_dir, filename)
                    if not os.path.exists(filepath):
                        errors.append(f"File not found: {filename}")
                        continue
                    
                    with open(filepath, 'r') as f:
                        content = f.read()
                    
                    # Check if template with same name exists
                    existing = Template.query.filter_by(name=name).first()
                    
                    if existing:
                        if overwrite:
                            existing.content = content
                            existing.script_type = script_type
                            existing.arguments = arguments
                            imported += 1
                        else:
                            skipped += 1
                    else:
                        new_template = Template(
                            name=name,
                            content=content,
                            script_type=script_type,
                            arguments=arguments
                        )
                        db.session.add(new_template)
                        imported += 1
                        
                except Exception as e:
                    errors.append(f"Error importing {entry.get('name', 'unknown')}: {str(e)}")
        
        else:
            # No manifest - import all .sh and .py files from scripts directory
            if os.path.exists(scripts_dir):
                for filename in os.listdir(scripts_dir):
                    if filename.endswith('.sh') or filename.endswith('.py'):
                        try:
                            filepath = os.path.join(scripts_dir, filename)
                            with open(filepath, 'r') as f:
                                content = f.read()
                            
                            # Derive name from filename
                            name = os.path.splitext(filename)[0].replace('_', ' ').title()
                            script_type = 'python' if filename.endswith('.py') else 'bash'
                            
                            existing = Template.query.filter_by(name=name).first()
                            
                            if existing:
                                if overwrite:
                                    existing.content = content
                                    existing.script_type = script_type
                                    imported += 1
                                else:
                                    skipped += 1
                            else:
                                new_template = Template(
                                    name=name,
                                    content=content,
                                    script_type=script_type
                                )
                                db.session.add(new_template)
                                imported += 1
                                
                        except Exception as e:
                            errors.append(f"Error importing {filename}: {str(e)}")
            else:
                return jsonify({'error': 'No scripts directory found in repository'}), 400
        
        db.session.commit()
        
        # Update sync status
        config.sync_status = 'success'
        config.last_sync = datetime.utcnow()
        db.session.commit()
        
        result = {
            'message': f'Import complete: {imported} imported, {skipped} skipped',
            'imported': imported,
            'skipped': skipped
        }
        
        if errors:
            result['errors'] = errors
        
        return jsonify(result)
        
    except Exception as e:
        config.sync_status = 'error'
        db.session.commit()
        return jsonify({'error': str(e)}), 500
        
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@git_sync_bp.route('/api/git/preview', methods=['GET'])
def preview_import():
    """Preview what templates would be imported from Git."""
    # Check if git is available
    if not is_git_available():
        return jsonify({'error': 'Git is not installed on the server. Please install git to use this feature.'}), 400
    
    config = get_git_config()
    
    if not config.repo_url:
        return jsonify({'error': 'No repository URL configured'}), 400
    
    temp_dir = tempfile.mkdtemp(prefix='bashtower_git_preview_')
    
    try:
        auth_url = build_authenticated_url(config.repo_url, config.access_token)
        branch = config.branch or 'main'
        
        # Clone the repository
        success, _, stderr = run_git_command(
            ['git', 'clone', '--branch', branch, '--single-branch', '--depth', '1', auth_url, '.'],
            cwd=temp_dir
        )
        
        if not success:
            return jsonify({'error': f'Failed to clone repository: {stderr}'}), 400
        
        manifest_path = os.path.join(temp_dir, 'templates_manifest.json')
        scripts_dir = os.path.join(temp_dir, 'scripts')
        
        templates_preview = []
        
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
            
            for entry in manifest.get('templates', []):
                name = entry.get('name')
                existing = Template.query.filter_by(name=name).first()
                templates_preview.append({
                    'name': name,
                    'filename': entry.get('filename'),
                    'script_type': entry.get('script_type', 'bash'),
                    'exists': bool(existing),
                    'action': 'update' if existing else 'create'
                })
        
        elif os.path.exists(scripts_dir):
            for filename in os.listdir(scripts_dir):
                if filename.endswith('.sh') or filename.endswith('.py'):
                    name = os.path.splitext(filename)[0].replace('_', ' ').title()
                    script_type = 'python' if filename.endswith('.py') else 'bash'
                    existing = Template.query.filter_by(name=name).first()
                    templates_preview.append({
                        'name': name,
                        'filename': filename,
                        'script_type': script_type,
                        'exists': bool(existing),
                        'action': 'update' if existing else 'create'
                    })
        
        return jsonify({
            'templates': templates_preview,
            'total': len(templates_preview),
            'new': len([t for t in templates_preview if not t['exists']]),
            'existing': len([t for t in templates_preview if t['exists']])
        })
        
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@git_sync_bp.route('/api/git/backup', methods=['POST'])
def backup_to_git():
    """Full backup of everything to Git repository with name backup."""
    # Check if git is available
    if not is_git_available():
        return jsonify({'error': 'Git is not installed on the server. Please install git to use this feature.'}), 400
    
    config = get_git_config()
    
    if not config.repo_url:
        return jsonify({'error': 'No repository URL configured'}), 400
    
    data = request.json or {}
    include_sensitive = data.get('include_sensitive', False)
    
    temp_dir = tempfile.mkdtemp(prefix='bashtower_git_backup_')
    
    try:
        auth_url = build_authenticated_url(config.repo_url, config.access_token)
        branch = 'backup'
        
        # Clone the repository
        success, _, stderr = run_git_command(
            ['git', 'clone', '--branch', branch, '--single-branch', auth_url, '.'],
            cwd=temp_dir
        )
        
        # If branch doesn't exist, clone default and create branch
        if not success:
            success, _, stderr = run_git_command(
                ['git', 'clone', auth_url, '.'],
                cwd=temp_dir
            )
            if not success:
                config.sync_status = 'error'
                db.session.commit()
                return jsonify({'error': f'Failed to clone repository: {stderr}'}), 400
            
            # Create and checkout the backup branch
            run_git_command(['git', 'checkout', '-b', branch], cwd=temp_dir)
        
        # Create backup structure
        backup_data = {
            'version': '1.0',
            'backup_date': datetime.utcnow().isoformat(),
            'templates': [],
            'hosts': [],
            'host_groups': [],
            'ssh_keys': [],
            'cron_jobs': [],
            'users': [],
            'satellite_config': None,
            'app_settings': None
        }
        
        # Backup Templates
        templates = Template.query.all()
        scripts_dir = os.path.join(temp_dir, 'scripts')
        os.makedirs(scripts_dir, exist_ok=True)
        
        for template in templates:
            ext = '.py' if template.script_type == 'python' else '.sh'
            safe_name = "".join(c if c.isalnum() or c in '-_' else '_' for c in template.name)
            filename = f"{safe_name}{ext}"
            filepath = os.path.join(scripts_dir, filename)
            
            with open(filepath, 'w') as f:
                f.write(template.content)
            
            backup_data['templates'].append({
                'id': template.id,
                'name': template.name,
                'filename': filename,
                'script_type': template.script_type or 'bash',
                'arguments': template.arguments,
                'created_at': template.created_at.isoformat() if template.created_at else None
            })
        
        # Backup Hosts
        hosts = Host.query.all()
        for host in hosts:
            backup_data['hosts'].append({
                'id': host.id,
                'name': host.name,
                'hostname': host.hostname,
                'username': host.username,
                'port': host.port,
                'shell': host.shell,
                'group_ids': [g.id for g in host.groups]
            })
        
        # Backup Host Groups
        groups = HostGroup.query.all()
        for group in groups:
            backup_data['host_groups'].append({
                'id': group.id,
                'name': group.name
            })
        
        # Backup SSH Keys
        keys = SSHKey.query.all()
        for key in keys:
            key_data = {
                'id': key.id,
                'name': key.name
            }
            if include_sensitive:
                key_data['private_key'] = key.private_key
            else:
                key_data['note'] = 'Private key not included in backup for security reasons'
            backup_data['ssh_keys'].append(key_data)
        
        # Backup Cron Jobs
        cron_jobs = CronJob.query.all()
        for cron in cron_jobs:
            backup_data['cron_jobs'].append({
                'id': cron.id,
                'name': cron.name,
                'schedule': cron.schedule,
                'template_id': cron.template_id,
                'key_id': cron.key_id,
                'host_ids': cron.host_ids,
                'enabled': cron.enabled,
                'last_run': cron.last_run.isoformat() if cron.last_run else None,
                'next_run': cron.next_run.isoformat() if cron.next_run else None,
                'created_at': cron.created_at.isoformat() if cron.created_at else None
            })
        
        # Backup Users
        users = User.query.all()
        for user in users:
            user_data = {
                'id': user.id,
                'username': user.username,
                'email': user.email,
                'is_admin': user.is_admin
            }
            if include_sensitive:
                user_data['password_hash'] = user._password_hash
            else:
                user_data['note'] = 'Password not included in backup for security reasons'
            backup_data['users'].append(user_data)
        
        # Backup Satellite Config
        satellite_config = SatelliteConfig.query.get(1)
        if satellite_config:
            sat_data = {
                'url': satellite_config.url,
                'username': satellite_config.username,
                'ssh_username': satellite_config.ssh_username
            }
            if include_sensitive:
                sat_data['password'] = satellite_config.password
            else:
                sat_data['note'] = 'Password not included in backup for security reasons'
            backup_data['satellite_config'] = sat_data
        
        # Backup App Settings
        app_settings = AppSettings.query.get(1)
        if app_settings:
            settings_data = {
                'ai_provider': app_settings.ai_provider,
                'ai_model': app_settings.ai_model,
                'ai_endpoint': app_settings.ai_endpoint,
                'cron_history_limit': app_settings.cron_history_limit,
                'auth_disabled': app_settings.auth_disabled
            }
            if include_sensitive:
                settings_data['ai_api_key'] = app_settings.ai_api_key
            else:
                settings_data['note'] = 'API key not included in backup for security reasons'
            backup_data['app_settings'] = settings_data
        
        # Write backup manifest
        manifest_path = os.path.join(temp_dir, 'bashtower_backup.json')
        with open(manifest_path, 'w') as f:
            json.dump(backup_data, f, indent=2)
        
        # Create README
        readme_path = os.path.join(temp_dir, 'README.md')
        with open(readme_path, 'w') as f:
            f.write(f"""# BashTower Backup - {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC

This repository contains a full backup of your BashTower instance.

## Contents

- **bashtower_backup.json**: Complete backup manifest
- **scripts/**: All script templates

## Statistics

- Templates: {len(templates)}
- Hosts: {len(hosts)}
- Host Groups: {len(groups)}
- SSH Keys: {len(keys)} {'(including private keys)' if include_sensitive else '(private keys excluded)'}
- Cron Jobs: {len(cron_jobs)}
- Users: {len(users)} {'(including password hashes)' if include_sensitive else '(passwords excluded)'}

## Application Settings Backed Up

- AI Configuration: {app_settings.ai_provider if app_settings else 'None'} ({app_settings.ai_model if app_settings else 'N/A'})
- AI API Key: {'Included' if include_sensitive and app_settings and app_settings.ai_api_key else 'Excluded'}
- Disable Login: {'Enabled' if app_settings and app_settings.auth_disabled else 'Disabled'}
- Cron History Limit: {app_settings.cron_history_limit if app_settings else '0'} (0 = unlimited)
- Satellite/Foreman Config: {'Included' if satellite_config else 'Not configured'}
- Satellite Password: {'Included' if include_sensitive and satellite_config else 'Excluded'}

## Security Note

{'This backup INCLUDES sensitive data (SSH keys, passwords, API tokens). Keep this repository private!' if include_sensitive else '''For security reasons, the following sensitive data is NOT included in this backup:
- SSH private keys
- User passwords
- API keys and tokens
- Satellite/Foreman passwords

These must be reconfigured manually after restore.'''}

## Restore

To restore this backup, use the "Restore from Git" feature in BashTower's Git Sync interface.
""")
        
        # Configure git user for commit
        run_git_command(['git', 'config', 'user.email', 'bashtower@local'], cwd=temp_dir)
        run_git_command(['git', 'config', 'user.name', 'BashTower'], cwd=temp_dir)
        
        # Add all files
        run_git_command(['git', 'add', '-A'], cwd=temp_dir)
        
        # Check if there are changes
        success, stdout, _ = run_git_command(['git', 'status', '--porcelain'], cwd=temp_dir)
        if not stdout.strip():
            return jsonify({
                'message': 'No changes to backup',
                'stats': {
                    'templates': len(templates),
                    'hosts': len(hosts),
                    'groups': len(groups),
                    'cron_jobs': len(cron_jobs)
                }
            })
        
        # Commit
        commit_msg = f"BashTower Full Backup: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC"
        success, _, stderr = run_git_command(['git', 'commit', '-m', commit_msg], cwd=temp_dir)
        if not success:
            return jsonify({'error': f'Failed to commit: {stderr}'}), 400
        
        # Push
        success, _, stderr = run_git_command(['git', 'push', '-u', 'origin', branch], cwd=temp_dir)
        if not success:
            return jsonify({'error': f'Failed to push: {stderr}'}), 400
        
        return jsonify({
            'message': f'Full backup completed successfully',
            'branch': branch,
            'stats': {
                'templates': len(templates),
                'hosts': len(hosts),
                'groups': len(groups),
                'ssh_keys': len(keys),
                'cron_jobs': len(cron_jobs),
                'users': len(users),
                'app_settings_included': bool(app_settings),
                'satellite_config_included': bool(satellite_config),
                'sensitive_data_included': include_sensitive
            }
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500
        
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@git_sync_bp.route('/api/git/restore', methods=['POST'])
def restore_from_git():
    """Restore everything from Git repository backup branch."""
    # Check if git is available
    if not is_git_available():
        return jsonify({'error': 'Git is not installed on the server. Please install git to use this feature.'}), 400
    
    config = get_git_config()
    
    if not config.repo_url:
        return jsonify({'error': 'No repository URL configured'}), 400
    
    data = request.json or {}
    overwrite = data.get('overwrite', False)
    
    temp_dir = tempfile.mkdtemp(prefix='bashtower_git_restore_')
    
    try:
        auth_url = build_authenticated_url(config.repo_url, config.access_token)
        branch = 'backup'
        
        # Clone the backup branch
        success, _, stderr = run_git_command(
            ['git', 'clone', '--branch', branch, '--single-branch', '--depth', '1', auth_url, '.'],
            cwd=temp_dir
        )
        
        if not success:
            return jsonify({'error': f'Failed to clone backup branch: {stderr}. Make sure the backup branch exists.'}), 400
        
        # Check for backup manifest
        manifest_path = os.path.join(temp_dir, 'bashtower_backup.json')
        if not os.path.exists(manifest_path):
            return jsonify({'error': 'Backup manifest not found in repository'}), 400
        
        with open(manifest_path, 'r') as f:
            backup_data = json.load(f)
        
        stats = {
            'templates_restored': 0,
            'hosts_restored': 0,
            'groups_restored': 0,
            'ssh_keys_restored': 0,
            'cron_jobs_restored': 0,
            'users_restored': 0,
            'templates_skipped': 0,
            'hosts_skipped': 0,
            'errors': []
        }
        
        # Restore Host Groups first (needed for hosts)
        group_id_map = {}  # Map old IDs to new IDs
        for group_data in backup_data.get('host_groups', []):
            try:
                name = group_data['name']
                existing = HostGroup.query.filter_by(name=name).first()
                
                if existing:
                    if overwrite:
                        group_id_map[group_data['id']] = existing.id
                    else:
                        group_id_map[group_data['id']] = existing.id
                else:
                    new_group = HostGroup(name=name)
                    db.session.add(new_group)
                    db.session.flush()  # Get the ID
                    group_id_map[group_data['id']] = new_group.id
                    stats['groups_restored'] += 1
            except Exception as e:
                stats['errors'].append(f"Error restoring group {group_data.get('name')}: {str(e)}")
        
        # Restore Templates
        template_id_map = {}
        scripts_dir = os.path.join(temp_dir, 'scripts')
        for template_data in backup_data.get('templates', []):
            try:
                name = template_data['name']
                filename = template_data['filename']
                script_type = template_data.get('script_type', 'bash')
                arguments = template_data.get('arguments')
                
                filepath = os.path.join(scripts_dir, filename)
                if not os.path.exists(filepath):
                    stats['errors'].append(f"Template file not found: {filename}")
                    continue
                
                with open(filepath, 'r') as f:
                    content = f.read()
                
                existing = Template.query.filter_by(name=name).first()
                
                if existing:
                    if overwrite:
                        existing.content = content
                        existing.script_type = script_type
                        existing.arguments = arguments
                        template_id_map[template_data['id']] = existing.id
                        stats['templates_restored'] += 1
                    else:
                        template_id_map[template_data['id']] = existing.id
                        stats['templates_skipped'] += 1
                else:
                    new_template = Template(
                        name=name,
                        content=content,
                        script_type=script_type,
                        arguments=arguments
                    )
                    db.session.add(new_template)
                    db.session.flush()
                    template_id_map[template_data['id']] = new_template.id
                    stats['templates_restored'] += 1
                    
            except Exception as e:
                stats['errors'].append(f"Error restoring template {template_data.get('name')}: {str(e)}")
        
        # Restore Hosts
        host_id_map = {}
        for host_data in backup_data.get('hosts', []):
            try:
                name = host_data['name']
                hostname = host_data['hostname']
                username = host_data['username']
                port = host_data.get('port', 22)
                shell = host_data.get('shell', '/bin/bash')
                group_ids = host_data.get('group_ids', [])
                
                existing = Host.query.filter_by(name=name, hostname=hostname).first()
                
                if existing:
                    if overwrite:
                        existing.username = username
                        existing.port = port
                        existing.shell = shell
                        # Update groups
                        existing.groups = [HostGroup.query.get(group_id_map.get(gid)) 
                                         for gid in group_ids if group_id_map.get(gid)]
                        host_id_map[host_data['id']] = existing.id
                        stats['hosts_restored'] += 1
                    else:
                        host_id_map[host_data['id']] = existing.id
                        stats['hosts_skipped'] += 1
                else:
                    new_host = Host(
                        name=name,
                        hostname=hostname,
                        username=username,
                        port=port,
                        shell=shell
                    )
                    # Assign groups
                    new_host.groups = [HostGroup.query.get(group_id_map.get(gid)) 
                                      for gid in group_ids if group_id_map.get(gid)]
                    db.session.add(new_host)
                    db.session.flush()
                    host_id_map[host_data['id']] = new_host.id
                    stats['hosts_restored'] += 1
                    
            except Exception as e:
                stats['errors'].append(f"Error restoring host {host_data.get('name')}: {str(e)}")
        
        # Restore SSH Keys
        key_id_map = {}
        for key_data in backup_data.get('ssh_keys', []):
            try:
                name = key_data['name']
                private_key = key_data.get('private_key')
                
                if not private_key:
                    stats['errors'].append(f"SSH Key '{name}' has no private key data - skipped")
                    continue
                
                existing = SSHKey.query.filter_by(name=name).first()
                
                if existing:
                    if overwrite:
                        existing.private_key = private_key
                        key_id_map[key_data['id']] = existing.id
                        stats['ssh_keys_restored'] += 1
                    else:
                        key_id_map[key_data['id']] = existing.id
                else:
                    new_key = SSHKey(name=name, private_key=private_key)
                    db.session.add(new_key)
                    db.session.flush()
                    key_id_map[key_data['id']] = new_key.id
                    stats['ssh_keys_restored'] += 1
                    
            except Exception as e:
                stats['errors'].append(f"Error restoring SSH key {key_data.get('name')}: {str(e)}")
        
        # Restore Cron Jobs
        for cron_data in backup_data.get('cron_jobs', []):
            try:
                name = cron_data['name']
                schedule = cron_data['schedule']
                template_id = template_id_map.get(cron_data['template_id'])
                key_id = key_id_map.get(cron_data['key_id'])
                host_ids = cron_data['host_ids']
                enabled = cron_data.get('enabled', True)
                
                if not template_id:
                    stats['errors'].append(f"Cron job '{name}' references missing template - skipped")
                    continue
                
                if not key_id:
                    stats['errors'].append(f"Cron job '{name}' references missing SSH key - skipped")
                    continue
                
                existing = CronJob.query.filter_by(name=name).first()
                
                if existing:
                    if overwrite:
                        existing.schedule = schedule
                        existing.template_id = template_id
                        existing.key_id = key_id
                        existing.host_ids = host_ids
                        existing.enabled = enabled
                        stats['cron_jobs_restored'] += 1
                else:
                    new_cron = CronJob(
                        name=name,
                        schedule=schedule,
                        template_id=template_id,
                        key_id=key_id,
                        host_ids=host_ids,
                        enabled=enabled
                    )
                    db.session.add(new_cron)
                    stats['cron_jobs_restored'] += 1
                    
            except Exception as e:
                stats['errors'].append(f"Error restoring cron job {cron_data.get('name')}: {str(e)}")
        
        # Restore Users
        for user_data in backup_data.get('users', []):
            try:
                username = user_data['username']
                email = user_data.get('email')
                is_admin = user_data.get('is_admin', False)
                password_hash = user_data.get('password_hash')
                
                existing = User.query.filter_by(username=username).first()
                
                if existing:
                    if overwrite and password_hash:
                        existing.email = email
                        existing.is_admin = is_admin
                        existing._password_hash = password_hash
                        stats['users_restored'] += 1
                else:
                    if password_hash:
                        new_user = User(username=username, email=email, is_admin=is_admin)
                        new_user._password_hash = password_hash
                        db.session.add(new_user)
                        stats['users_restored'] += 1
                    else:
                        stats['errors'].append(f"User '{username}' has no password hash - skipped")
                    
            except Exception as e:
                stats['errors'].append(f"Error restoring user {user_data.get('username')}: {str(e)}")
        
        # Restore Satellite Config
        if backup_data.get('satellite_config'):
            try:
                sat_data = backup_data['satellite_config']
                config = SatelliteConfig.query.get(1)
                if not config:
                    config = SatelliteConfig(id=1)
                    db.session.add(config)
                
                config.url = sat_data.get('url')
                config.username = sat_data.get('username')
                config.ssh_username = sat_data.get('ssh_username')
                if sat_data.get('password'):
                    config.password = sat_data['password']
            except Exception as e:
                stats['errors'].append(f"Error restoring Satellite config: {str(e)}")
        
        # Restore App Settings
        if backup_data.get('app_settings'):
            try:
                settings_data = backup_data['app_settings']
                settings = AppSettings.query.get(1)
                if not settings:
                    settings = AppSettings(id=1)
                    db.session.add(settings)
                
                settings.ai_provider = settings_data.get('ai_provider', 'openai')
                settings.ai_model = settings_data.get('ai_model', 'gpt-3.5-turbo')
                settings.ai_endpoint = settings_data.get('ai_endpoint')
                settings.cron_history_limit = settings_data.get('cron_history_limit', 0)
                settings.auth_disabled = settings_data.get('auth_disabled', False)
                if settings_data.get('ai_api_key'):
                    settings.ai_api_key = settings_data['ai_api_key']
            except Exception as e:
                stats['errors'].append(f"Error restoring app settings: {str(e)}")
        
        db.session.commit()
        
        result = {
            'message': f"Restore complete: {stats['templates_restored']} templates, {stats['hosts_restored']} hosts, {stats['groups_restored']} groups, {stats['ssh_keys_restored']} SSH keys, {stats['cron_jobs_restored']} cron jobs, {stats['users_restored']} users restored",
            'stats': stats
        }
        
        return jsonify(result)
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500
        
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
