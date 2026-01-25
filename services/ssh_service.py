# ============================================================================
# BashTower - SSH Execution Service
# ============================================================================
# Functions for executing commands on remote hosts via SSH.
# ============================================================================

import io
import logging
import threading
import paramiko
from extensions import db
from models import Job, JobLog, Host, Template, SSHKey

# Configure logger for this module
logger = logging.getLogger(__name__)


def parse_private_key(key_content):
    """
    Parse a private key string and return a paramiko key object.
    Supports RSA, Ed25519, and ECDSA keys.
    Note: DSA/DSS keys are no longer supported in Paramiko 4.0+
    """
    key_file = io.StringIO(key_content)
    
    # Try different key types (DSA removed in Paramiko 4.0)
    key_types = [
        (paramiko.RSAKey, "RSA"),
        (paramiko.Ed25519Key, "Ed25519"),
        (paramiko.ECDSAKey, "ECDSA"),
    ]
    
    for key_class, key_name in key_types:
        try:
            key_file.seek(0)
            return key_class.from_private_key(key_file)
        except Exception:
            continue
    
    raise ValueError("Unable to parse private key. Supported types: RSA, Ed25519, ECDSA")


def execute_ssh_command(app, host_obj, key_obj, script_content, job_id, log_model=JobLog, script_type='bash'):
    """
    Unified SSH execution function.
    Connects to a host and executes the script via SSH.
    
    Args:
        app: Flask application instance (for app context)
        host_obj: Host model instance
        key_obj: SSHKey model instance
        script_content: Script to execute
        job_id: Job or CronJob ID
        log_model: Log model class (JobLog or CronJobLog)
        script_type: Type of script ('bash' or 'python')
    """
    # Determine the correct foreign key field name
    fk_field = 'job_id' if log_model.__name__ == 'JobLog' else 'cron_job_id'
    
    with app.app_context():
        # Create log entry
        log_kwargs = {
            fk_field: job_id,
            'hostname': host_obj.hostname,
            'status': 'running',
            'stdout': '',
            'stderr': ''
        }
        log_entry = log_model(**log_kwargs)
        db.session.add(log_entry)
        db.session.commit()
        
        client = None
        try:
            # Parse the private key
            pkey = parse_private_key(key_obj.private_key)
            
            # Create SSH client
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            logger.info(f"Connecting to {host_obj.hostname}:{host_obj.port} as {host_obj.username}")
            
            client.connect(
                hostname=host_obj.hostname,
                port=host_obj.port,
                username=host_obj.username,
                pkey=pkey,
                timeout=15,
                banner_timeout=15
            )

            # Execute the script with the appropriate interpreter
            interpreter = 'python3 -' if script_type == 'python' else host_obj.shell
            stdin, stdout, stderr = client.exec_command(interpreter, timeout=300)
            stdin.write(script_content.encode('utf-8'))
            stdin.channel.shutdown_write()

            # Get results
            exit_status = stdout.channel.recv_exit_status()
            out_str = stdout.read().decode('utf-8')
            err_str = stderr.read().decode('utf-8')

            log_entry.stdout = out_str
            log_entry.stderr = err_str
            log_entry.status = 'success' if exit_status == 0 else 'error'
            
            logger.info(f"Command on {host_obj.hostname} completed with status: {log_entry.status}")

        except paramiko.AuthenticationException as e:
            logger.error(f"Authentication failed for {host_obj.hostname}: {e}")
            log_entry.stderr = f"Authentication Error: {e}"
            log_entry.status = 'connection_failed'
            
        except paramiko.SSHException as e:
            logger.error(f"SSH error for {host_obj.hostname}: {e}")
            log_entry.stderr = f"SSH Error: {e}"
            log_entry.status = 'connection_failed'
            
        except TimeoutError as e:
            logger.error(f"Connection timeout for {host_obj.hostname}: {e}")
            log_entry.stderr = f"Connection Timeout: {e}"
            log_entry.status = 'connection_failed'
            
        except Exception as e:
            logger.exception(f"Unexpected error for {host_obj.hostname}: {e}")
            log_entry.stderr = f"Error: {e}"
            log_entry.status = 'connection_failed'
            
        finally:
            if client:
                client.close()
            db.session.commit()
        
        return log_entry


def run_job_thread(app, job_id, template_id, host_ids, key_id, script_type='bash'):
    """
    Background thread to orchestrate job execution.
    host_ids is the resolved list of unique host IDs.
    script_type: Type of script ('bash' or 'python')
    """
    with app.app_context():
        job = Job.query.get(job_id)
        template = Template.query.get(template_id)
        key = SSHKey.query.get(key_id)
        hosts = Host.query.filter(Host.id.in_(host_ids)).all()

        if not template or not key or not hosts:
            logger.error(f"Job {job_id} setup failed: Missing template, key, or hosts")
            job.status = 'error'
            log_entry = JobLog(
                job_id=job.id, 
                hostname='N/A', 
                status='error', 
                stderr='Job setup failed: Template, key, or hosts not found.'
            )
            db.session.add(log_entry)
            db.session.commit()
            return
        
        logger.info(f"Starting job {job_id} with template '{template.name}' on {len(hosts)} hosts")
        
        # Execute on all hosts in parallel
        threads = []
        for host in hosts:
            t = threading.Thread(
                target=execute_ssh_command,
                args=(app, host, key, template.content, job.id, JobLog, script_type)
            )
            threads.append(t)
            t.start()
        
        # Wait for all threads to complete
        for t in threads:
            t.join()

        # Determine final job status
        db.session.refresh(job)
        final_status = 'completed'
        for log in job.logs:
            if log.status in ['error', 'connection_failed']:
                final_status = 'failed'
                break
        
        job.status = final_status
        db.session.commit()
        
        logger.info(f"Job {job_id} finished with status: {final_status}")
