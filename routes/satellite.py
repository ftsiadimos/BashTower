# Copyright (C) 2025 Fotios Tsiadimos
# SPDX-License-Identifier: GPL-3.0-only
#
# ============================================================================
# BashTower - Satellite Routes
# ============================================================================
# API endpoints for Red Hat Satellite integration.
# ============================================================================

import logging
import requests # type: ignore
from datetime import datetime
from flask import Blueprint, jsonify, request

from extensions import db
from models import Host, HostGroup, SatelliteConfig

satellite_bp = Blueprint('satellite', __name__)


@satellite_bp.route('/api/satellite/config', methods=['GET'])
def get_satellite_config():
    config = SatelliteConfig.query.get(1)
    url = config.url if config else ''
    username = config.username if config else ''
    ssh_username = config.ssh_username if config else ''
    auto_sync_enabled = config.auto_sync_enabled if config else False
    auto_sync_interval = config.auto_sync_interval if config else 60
    last_sync_time = config.last_sync_time.isoformat() if config and config.last_sync_time else None
    last_sync_status = config.last_sync_status if config else None
    last_sync_host_count = config.last_sync_host_count if config else 0
    last_sync_group_count = config.last_sync_group_count if config else 0
    
    return jsonify({
        'url': url, 
        'username': username, 
        'ssh_username': ssh_username,
        'auto_sync_enabled': auto_sync_enabled,
        'auto_sync_interval': auto_sync_interval,
        'last_sync_time': last_sync_time,
        'last_sync_status': last_sync_status,
        'last_sync_host_count': last_sync_host_count,
        'last_sync_group_count': last_sync_group_count,
    })


@satellite_bp.route('/api/satellite/config', methods=['POST'])
def save_satellite_config():
    data = request.json
    url = data.get('url', '').strip()
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    ssh_username = data.get('ssh_username', 'ec2-user').strip()
    auto_sync_enabled = data.get('auto_sync_enabled', False)
    auto_sync_interval = data.get('auto_sync_interval', 60)

    config = SatelliteConfig.query.get(1)
    if not config:
        config = SatelliteConfig(
            id=1,
            url=url,
            username=username,
            password=password,
            ssh_username=ssh_username,
            auto_sync_enabled=auto_sync_enabled,
            auto_sync_interval=auto_sync_interval,
        )
        db.session.add(config)
    else:
        config.url = url
        config.username = username
        if password:
            config.password = password
        config.ssh_username = ssh_username
        config.auto_sync_enabled = auto_sync_enabled
        config.auto_sync_interval = auto_sync_interval

    db.session.commit()
    
    # Update the auto-sync scheduler based on new configuration
    from flask import current_app
    from services.cron_service import update_satellite_auto_sync_schedule
    try:
        update_satellite_auto_sync_schedule(current_app)
    except Exception as e:
        logger = logging.getLogger(__name__)
        logger.exception("Failed to update satellite auto-sync schedule: %s", e)
    
    return jsonify(
        {
            'url': config.url,
            'username': config.username,
            'ssh_username': config.ssh_username,
            'auto_sync_enabled': config.auto_sync_enabled,
            'auto_sync_interval': config.auto_sync_interval,
        }
    )


def _sync_satellite_hosts_logic(config, sync_hosts=True):
    """
    Internal helper function to sync hosts from Satellite.
    
    Args:
        config: SatelliteConfig instance
        sync_hosts: If False, skips host syncing (only validates connection)
    
    Returns:
        Tuple of (success: bool, message: str, details: dict)
    """
    if not config or not config.url or not config.username or not config.password:
        return False, 'Satellite URL, Username, and Password must be configured.', {}

    api_url = config.url
    auth = (config.username, config.password)
    logger = logging.getLogger(__name__)

    try:
        response = requests.get(api_url, auth=auth, verify=False, timeout=15)
        response.raise_for_status()
        satellite_data = response.json()

    except requests.exceptions.RequestException as e:
        logger.exception("Failed fetching Satellite API: %s", e)
        return False, 'Failed to fetch Satellite data from configured API', {'error': str(e)}

    if not sync_hosts:
        return True, 'Connection to Satellite validated successfully', {}

    synced_hosts = []
    synced_groups = []
    hosts_to_process = satellite_data.get('results', [])
    host_count = 0
    group_count = 0

    # First pass: Create host groups
    group_cache = {}  # Cache to avoid repeated DB queries
    for host_data in hosts_to_process:
        hostgroup_name = host_data.get('hostgroup_title') or host_data.get(
            'hostgroup_name'
        )
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
    default_ssh_username = config.ssh_username if config.ssh_username else 'ec2-user'
    for host_data in hosts_to_process:
        host_name = host_data.get('name')
        host_ip_or_fqdn = host_data.get('ip') or host_data.get('name')
        ssh_port = 22

        if not host_ip_or_fqdn:
            continue

        hostgroup_name = host_data.get('hostgroup_title') or host_data.get(
            'hostgroup_name'
        )

        # Look up by name first; fall back to hostname (IP/FQDN) match
        existing_host = Host.query.filter_by(name=host_name).first()
        if not existing_host:
            existing_host = Host.query.filter_by(hostname=host_ip_or_fqdn).first()

        if not existing_host:
            new_host = Host(
                name=host_name,
                hostname=host_ip_or_fqdn,
                username=default_ssh_username,
                port=ssh_port,
                shell='/bin/bash',
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
            # Update IP if it has changed
            if existing_host.hostname != host_ip_or_fqdn:
                existing_host.hostname = host_ip_or_fqdn

            # Update group membership if group exists
            if hostgroup_name and hostgroup_name in group_cache:
                group = group_cache[hostgroup_name]
                if existing_host not in group.hosts:
                    group.hosts.append(existing_host)

    db.session.commit()

    message = f'Synced {host_count} new hosts and {group_count} new groups from Satellite'
    details = {
        'synced_host_count': host_count,
        'synced_group_count': group_count,
        'synced_hosts': synced_hosts,
        'synced_groups': synced_groups,
    }
    return True, message, details


@satellite_bp.route('/api/satellite/sync', methods=['POST'])
def sync_satellite_hosts():
    config = SatelliteConfig.query.get(1)
    success, message, details = _sync_satellite_hosts_logic(config, sync_hosts=True)
    
    if success:
        # Update sync tracking info
        if config:
            config.last_sync_time = datetime.utcnow()
            config.last_sync_status = message
            config.last_sync_host_count = details.get('synced_host_count', 0)
            config.last_sync_group_count = details.get('synced_group_count', 0)
            db.session.commit()
        
        return jsonify({
            'message': message,
            **details,
            'mock_used': False,
        })
    else:
        return jsonify({'error': message, 'details': details}), 400
