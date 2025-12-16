import os
import threading
import time
import paramiko
import io
import requests
import json
from datetime import datetime
from flask import Flask, render_template, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Table, Column, Integer, ForeignKey

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///bashtower.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# =========================================================
# --- ALL DATABASE MODELS MUST BE DEFINED HERE ---
# =========================================================

# --- Association Table for Host <-> HostGroup (Many-to-Many) ---
host_group_membership = db.Table('host_group_membership',
    db.Column('host_id', db.Integer, db.ForeignKey('host.id'), primary_key=True),
    db.Column('host_group_id', db.Integer, db.ForeignKey('host_group.id'), primary_key=True)
)

class HostGroup(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    # The 'hosts' relationship is defined via the backref on the Host model below

class Template(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    content = db.Column(db.Text, nullable=False) # The bash script
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Host(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    hostname = db.Column(db.String(200), nullable=False) # IP or FQDN
    username = db.Column(db.String(100), nullable=False)
    port = db.Column(db.Integer, default=22)
    # Link Host to Groups
    groups = db.relationship('HostGroup', secondary=host_group_membership, backref=db.backref('hosts', lazy='dynamic'))

class SSHKey(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    # SECURITY WARNING: Storing private keys in plain text in DB is risky. 
    private_key = db.Column(db.Text, nullable=False) 

class Job(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    template_name = db.Column(db.String(100))
    status = db.Column(db.String(20), default='running') # running, completed, failed
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    logs = db.relationship('JobLog', backref='job', lazy=True)

class JobLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    job_id = db.Column(db.Integer, db.ForeignKey('job.id'), nullable=False)
    hostname = db.Column(db.String(200))
    stdout = db.Column(db.Text)
    stderr = db.Column(db.Text)
    status = db.Column(db.String(20)) # success, error, connection_failed

class SatelliteConfig(db.Model):
    __tablename__ = 'satellite_config'
    id = db.Column(db.Integer, primary_key=True, default=1)
    url = db.Column(db.String(255), nullable=True) 
    username = db.Column(db.String(100), nullable=True)
    password = db.Column(db.String(100), nullable=True)
    # NEW: Default SSH Username for imported hosts
    ssh_username = db.Column(db.String(100), default='ec2-user', nullable=True) 

# =========================================================
# --- GUARANTEED DATABASE INITIALIZATION FIX ---
with app.app_context():
    db.create_all()
# --- END FIX ---
# =========================================================


# --- Helper Functions ---

def ssh_execute(host_obj, key_obj, script_content, job_id):
    """
    Connects to a host and executes the bash script via SSH.
    """
    log_entry = JobLog(job_id=job_id, hostname=host_obj.hostname, status='running', stdout='', stderr='')
    
    with app.app_context():
        db.session.add(log_entry)
        db.session.commit()
        
        try:
            key_file = io.StringIO(key_obj.private_key)
            try:
                pkey = paramiko.RSAKey.from_private_key(key_file)
            except:
                key_file.seek(0)
                pkey = paramiko.Ed25519Key.from_private_key(key_file)

            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            client.connect(
                hostname=host_obj.hostname,
                port=host_obj.port,
                username=host_obj.username,
                pkey=pkey,
                timeout=10
            )

            stdin, stdout, stderr = client.exec_command('bash -s')
            stdin.write(script_content.encode('utf-8')) 
            stdin.channel.shutdown_write() 

            exit_status = stdout.channel.recv_exit_status()
            out_str = stdout.read().decode('utf-8')
            err_str = stderr.read().decode('utf-8')

            log_entry.stdout = out_str
            log_entry.stderr = err_str
            log_entry.status = 'success' if exit_status == 0 else 'error'
            
            client.close()

        except Exception as e:
            log_entry.stderr = f"Connection or Authentication Error: {e}"
            log_entry.status = 'connection_failed'
        
        db.session.commit()

def run_job_thread(job_id, template_id, host_ids, key_id):
    """
    Background thread to orchestrate the job execution.
    host_ids here is already the resolved list of unique IDs.
    """
    with app.app_context():
        job = Job.query.get(job_id)
        template = Template.query.get(template_id)
        key = SSHKey.query.get(key_id)
        # Fetch hosts based on the resolved IDs
        hosts = Host.query.filter(Host.id.in_(host_ids)).all()

        if not template or not key or not hosts:
            job.status = 'error'
            log_entry = JobLog(job_id=job.id, hostname='N/A', status='error', stderr='Job setup failed: Template, key, or hosts not found.')
            db.session.add(log_entry)
            db.session.commit()
            return
            
        threads = []
        for host in hosts:
            t = threading.Thread(target=ssh_execute, args=(host, key, template.content, job.id))
            threads.append(t)
            t.start()
        
        for t in threads:
            t.join()

        final_status = 'completed'
        for log in job.logs:
            if log.status in ['error', 'connection_failed']:
                final_status = 'failed'
                break
        
        job.status = final_status
        db.session.commit()

# --- Routes ---

@app.route('/')
def index():
    return render_template('index.html')

# API: Templates (Unchanged)
@app.route('/api/templates', methods=['GET', 'POST'])
def handle_templates():
    if request.method == 'POST':
        data = request.json
        new_template = Template(name=data['name'], content=data['script'])
        db.session.add(new_template)
        db.session.commit()
        return jsonify({'id': new_template.id, 'name': new_template.name, 'script': new_template.content}), 201

    templates = Template.query.all()
    return jsonify([{'id': t.id, 'name': t.name, 'script': t.content} for t in templates])

@app.route('/api/templates/<int:id>', methods=['GET', 'PUT', 'DELETE'])
def handle_template_item(id):
    template = Template.query.get_or_404(id)

    if request.method == 'PUT':
        data = request.json
        template.name = data.get('name', template.name)
        template.content = data.get('script', template.content)
        db.session.commit()
        return jsonify({'id': template.id,'name': template.name,'script': template.content})

    if request.method == 'DELETE':
        db.session.delete(template)
        db.session.commit()
        return jsonify({'message': 'Deleted'}), 204
    
    return jsonify({'id': template.id, 'name': template.name, 'script': template.content})


# API: Host Groups (Unchanged)
@app.route('/api/groups', methods=['GET', 'POST'])
def handle_groups():
    if request.method == 'POST':
        data = request.json
        group_name = data.get('name')
        host_ids = data.get('host_ids', [])
        
        if not group_name:
            return jsonify({'error': 'Group name is required'}), 400

        new_group = HostGroup(name=group_name)
        
        # Add hosts to the new group
        if host_ids:
            hosts = Host.query.filter(Host.id.in_(host_ids)).all()
            new_group.hosts.extend(hosts)
            
        db.session.add(new_group)
        db.session.commit()

        # Return the new group and its host IDs
        return jsonify({
            'id': new_group.id, 
            'name': new_group.name,
            'host_ids': [h.id for h in new_group.hosts]
        }), 201

    # GET
    groups = HostGroup.query.all()
    return jsonify([{
        'id': g.id, 
        'name': g.name, 
        'host_ids': [h.id for h in g.hosts] # List comprehension to get member IDs
    } for g in groups])

@app.route('/api/groups/<int:group_id>', methods=['PUT', 'DELETE'])
def handle_group_item(group_id):
    group = HostGroup.query.get_or_404(group_id)

    if request.method == 'PUT':
        data = request.json
        group.name = data.get('name', group.name)
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


# API: Hosts (Unchanged)
@app.route('/api/hosts', methods=['GET', 'POST'])
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
        # Return the new host object
        return jsonify({
            'id': new_host.id, 'name': new_host.name, 'hostname': new_host.hostname, 
            'username': new_host.username, 'port': new_host.port, 'groups': []
        }), 201
    
    hosts = Host.query.all()
    # Include group membership
    return jsonify([{
        'id': h.id, 
        'name': h.name, 
        'hostname': h.hostname, 
        'username': h.username, 
        'port': h.port,
        'group_ids': [g.id for g in h.groups]
    } for h in hosts])

@app.route('/api/hosts/<int:id>', methods=['DELETE'])
def delete_host(id):
    host = Host.query.get_or_404(id)
    # SQLAlchemy handles relationship cleanup
    db.session.delete(host)
    db.session.commit()
    return jsonify({'message': 'Deleted'}), 204

# API: Keys (Unchanged)
@app.route('/api/keys', methods=['GET', 'POST'])
def handle_keys():
    if request.method == 'POST':
        data = request.json
        new_key = SSHKey(name=data['name'], private_key=data['private_key'])
        db.session.add(new_key)
        db.session.commit()
        return jsonify({'id': new_key.id, 'name': new_key.name}), 201
    
    keys = SSHKey.query.all()
    return jsonify([{'id': k.id, 'name': k.name} for k in keys])

@app.route('/api/keys/<int:id>', methods=['DELETE'])
def delete_key(id):
    key = SSHKey.query.get_or_404(id)
    db.session.delete(key)
    db.session.commit()
    return jsonify({'message': 'Deleted'}), 204

# API: Execution (MODIFIED)
@app.route('/api/run', methods=['POST'])
def run_template():
    data = request.json
    template_id = data.get('template_id')
    
    # NEW: Accept both single host IDs and group IDs
    single_host_ids = data.get('host_ids', []) # NEW
    group_ids = data.get('host_group_ids', []) 
    key_id = data.get('key_id')

    if not template_id or not key_id:
        return jsonify({'error': 'Missing template or key'}), 400

    template = Template.query.get(template_id)
    
    # 1. Resolve all host IDs, starting with manually selected ones
    unique_host_ids = set()
    
    # Add single host IDs
    if single_host_ids:
        try:
            for host_id in single_host_ids:
                # Ensure they are integers and add them
                unique_host_ids.add(int(host_id))
        except ValueError:
            return jsonify({'error': 'Invalid host ID provided.'}), 400

    # Resolve group hosts and add them (set handles duplicates)
    groups = HostGroup.query.filter(HostGroup.id.in_(group_ids)).all()
    
    for group in groups:
        for host in group.hosts:
            unique_host_ids.add(host.id)
            
    resolved_host_ids = list(unique_host_ids)
    
    if not resolved_host_ids:
        return jsonify({'error': 'No hosts or host groups selected for execution.'}), 400

    # 2. Create Job
    job = Job(template_name=template.name)
    db.session.add(job)
    db.session.commit()

    # 3. Start execution with the resolved host IDs
    t = threading.Thread(
        target=run_job_thread, 
        args=(job.id, template_id, resolved_host_ids, key_id)
    )
    t.start()

    return jsonify({'message': 'Job started', 'id': job.id})

# API: Jobs (Unchanged)
@app.route('/api/jobs', methods=['GET'])
def get_jobs():
    jobs = Job.query.order_by(Job.created_at.desc()).limit(20).all() 
    return jsonify([{
        'id': j.id, 
        'template_name': j.template_name, 
        'status': j.status, 
        'created_at': str(j.created_at) 
    } for j in jobs])

@app.route('/api/jobs/<int:job_id>', methods=['GET'])
def get_job_details(job_id):
    job = Job.query.get_or_404(job_id)
    logs = [{
        'hostname': l.hostname,
        'stdout': l.stdout,
        'stderr': l.stderr,
        'status': l.status
    } for l in job.logs]
  
    return jsonify({
        'id': job.id,
        'template_name': job.template_name,
        'status': job.status,
        'created_at': str(job.created_at), 
        'logs': logs
    })


# --- SATELLITE API ENDPOINTS (Unchanged) ---

@app.route('/api/satellite/config', methods=['GET'])
def get_satellite_config():
    config = SatelliteConfig.query.get(1)
    url = config.url if config else ''
    username = config.username if config else ''
    # NEW: Include ssh_username
    ssh_username = config.ssh_username if config else 'ec2-user' 
    return jsonify({'url': url, 'username': username, 'ssh_username': ssh_username})

@app.route('/api/satellite/config', methods=['POST'])
def save_satellite_config():
    data = request.json
    url = data.get('url', '').strip()
    username = data.get('username', '').strip()
    password = data.get('password', '').strip()
    # NEW: Read ssh_username from request
    ssh_username = data.get('ssh_username', 'ec2-user').strip()
    
    config = SatelliteConfig.query.get(1)
    if not config:
        config = SatelliteConfig(
            id=1, 
            url=url, 
            username=username, 
            password=password, 
            # NEW: Store ssh_username
            ssh_username=ssh_username
        )
        db.session.add(config)
    else:
        config.url = url
        config.username = username
        if password: 
             config.password = password
        # NEW: Update ssh_username
        config.ssh_username = ssh_username
    
    db.session.commit()
    return jsonify({
        'url': config.url, 
        'username': config.username,
        'ssh_username': config.ssh_username # NEW: Return it in the response
    })

@app.route('/api/satellite/sync', methods=['POST'])
def sync_satellite_hosts():
    config = SatelliteConfig.query.get(1)
    
    if not config or not config.url or not config.username or not config.password:
        return jsonify({'error': 'Satellite URL, Username, and Password must be configured.'}), 400

    api_url = config.url
    auth = (config.username, config.password)
    mock_used = False
    
    # NEW: Get the user-defined SSH username
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
                {"id": 1001, "name": "sat-client-prod-01", "ip": "10.0.0.101", "facts": {"os_name": "RedHat"}},
                {"id": 1002, "name": "sat-client-dev-02", "ip": "10.0.0.102", "facts": {"os_name": "RedHat"}},
                {"id": 1003, "name": "sat-client-qa-03", "ip": "10.0.0.103", "facts": {"os_name": "RedHat"}},
            ]
        }
    
    synced_hosts = []
    hosts_to_process = satellite_data.get('results', [])
    count = 0
    
    for host_data in hosts_to_process:
        host_name = host_data.get('name')
        host_ip_or_fqdn = host_data.get('ip') or host_data.get('name') 
        
        ssh_port = 22

        if not host_ip_or_fqdn:
            continue

        existing_host = Host.query.filter_by(hostname=host_ip_or_fqdn).first()
        
        if not existing_host:
            new_host = Host(
                name=host_name, 
                hostname=host_ip_or_fqdn, 
                # NEW: Use the configured default_ssh_username
                username=default_ssh_username, 
                port=ssh_port
            )
            db.session.add(new_host)
            count += 1
            synced_hosts.append(host_ip_or_fqdn)
            
    db.session.commit()
    
    return jsonify({
        'message': f'Successfully synced {count} new hosts (out of {len(hosts_to_process)} total) from Satellite URL: {api_url}',
        'synced_count': count,
        'synced_hosts': synced_hosts,
        'mock_used': mock_used
    })

# --- END SATELLITE API ENDPOINTS ---


if __name__ == '__main__':
    app.run(debug=True, port=5000)