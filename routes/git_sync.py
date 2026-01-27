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
from models import GitRepoConfig, Template

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
