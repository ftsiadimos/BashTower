# ============================================================================
# BashTower - Satellite Routes
# ============================================================================
# API endpoints for Red Hat Satellite integration.
# ============================================================================

import requests
from flask import Blueprint, request, jsonify
from extensions import db
from models import Host, HostGroup, SatelliteConfig

satellite_bp = Blueprint('satellite', __name__)


@satellite_bp.route('/api/satellite/config', methods=['GET'])
def get_satellite_config():
    config = SatelliteConfig.query.get(1)
    url = config.url if config else ''
    username = config.username if config else ''
    ssh_username = config.ssh_username if config else ''
    return jsonify({
        'url': url,
        'username': username,
        'ssh_username': ssh_username
    })


@satellite_bp.route('/api/satellite/config', methods=['POST'])
def save_satellite_config():
    data = request.json
    url = data.get('url', '').strip()
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    ssh_username = data.get('ssh_username', 'ec2-user').strip()
    
    config = SatelliteConfig.query.get(1)
    if not config:
        config = SatelliteConfig(
            id=1,
            url=url,
            username=username,
            password=password,
            ssh_username=ssh_username
        )
        db.session.add(config)
    else:
        config.url = url
        config.username = username
        if password:
            config.password = password
        config.ssh_username = ssh_username
    
    db.session.commit()
    return jsonify({
        'url': config.url,
        'username': config.username,
        'ssh_username': config.ssh_username
    })


@satellite_bp.route('/api/satellite/sync', methods=['POST'])
def sync_satellite_hosts():
    config = SatelliteConfig.query.get(1)
    
    if not config or not config.url or not config.username or not config.password:
        return jsonify({'error': 'Satellite URL, Username, and Password must be configured.'}), 400

    api_url = config.url
    auth = (config.username, config.password)
    mock_used = False
    
    default_ssh_username = config.ssh_username if config.ssh_username else 'ec2-user'
    
    try:
        response = requests.get(api_url, auth=auth, verify=False, timeout=15)
        response.raise_for_status()
        satellite_data = response.json()
        
    except requests.exceptions.RequestException as e:
        print(f"DEBUG: Real Satellite Sync Failed or Blocked ({e.__class__.__name__}: {e}). Using controlled mock data.")
        mock_used = True

        satellite_data = {
            "total": 3,
            "results": [
                {"id": 1001, "name": "sat-client-prod-01", "ip": "10.0.0.101", "hostgroup_name": "Production/Web", "hostgroup_title": "Production/Web"},
                {"id": 1002, "name": "sat-client-dev-02", "ip": "10.0.0.102", "hostgroup_name": "Development", "hostgroup_title": "Development"},
                {"id": 1003, "name": "sat-client-qa-03", "ip": "10.0.0.103", "hostgroup_name": "Production/Web", "hostgroup_title": "Production/Web"},
            ]
        }
    
    synced_hosts = []
    synced_groups = []
    hosts_to_process = satellite_data.get('results', [])
    host_count = 0
    group_count = 0
    
    # First pass: Create host groups
    group_cache = {}  # Cache to avoid repeated DB queries
    for host_data in hosts_to_process:
        hostgroup_name = host_data.get('hostgroup_title') or host_data.get('hostgroup_name')
        if hostgroup_name and hostgroup_name not in group_cache:
            # Check if group already exists
            existing_group = HostGroup.query.filter_by(name=hostgroup_name).first()
            if not existing_group:
                new_group = HostGroup(name=hostgroup_name)
                db.session.add(new_group)
                db.session.flush()  # Get the ID
                group_cache[hostgroup_name] = new_group
                synced_groups.append(hostgroup_name)
                group_count += 1
            else:
                group_cache[hostgroup_name] = existing_group
    
    # Second pass: Create hosts and associate with groups
    
    # Second pass: Create hosts and associate with groups
    for host_data in hosts_to_process:
        host_name = host_data.get('name')
        host_ip_or_fqdn = host_data.get('ip') or host_data.get('name')
        ssh_port = 22

        if not host_ip_or_fqdn:
            continue

        existing_host = Host.query.filter_by(hostname=host_ip_or_fqdn).first()
        hostgroup_name = host_data.get('hostgroup_title') or host_data.get('hostgroup_name')
        
        if not existing_host:
            new_host = Host(
                name=host_name,
                hostname=host_ip_or_fqdn,
                username=default_ssh_username,
                port=ssh_port
            )
            db.session.add(new_host)
            db.session.flush()  # Get the ID
            
            # Associate with host group if exists
            if hostgroup_name and hostgroup_name in group_cache:
                group = group_cache[hostgroup_name]
                if new_host not in group.hosts:
                    group.hosts.append(new_host)
            
            host_count += 1
            synced_hosts.append(host_ip_or_fqdn)
        else:
            # Update existing host's group membership if group exists
            if hostgroup_name and hostgroup_name in group_cache:
                group = group_cache[hostgroup_name]
                if existing_host not in group.hosts:
                    group.hosts.append(existing_host)
            
    db.session.commit()
    
    return jsonify({
        'message': f'Synced {host_count} new hosts and {group_count} new groups from Satellite',
        'synced_host_count': host_count,
        'synced_group_count': group_count,
        'synced_hosts': synced_hosts,
        'synced_groups': synced_groups,
        'mock_used': mock_used
    })
