# Copyright (C) 2025 Fotios Tsiadimos
# SPDX-License-Identifier: GPL-3.0-only
#
# ============================================================================
# BashTower - Settings Routes
# ============================================================================
# API endpoints for application settings including AI configuration.
# ============================================================================

import requests # type: ignore
from flask import Blueprint, request, jsonify
from extensions import db
from models import AppSettings, CronJobLog

settings_bp = Blueprint('settings', __name__)


def cleanup_cron_history(limit):
    """Delete old cron history entries keeping only the most recent 'limit' rows."""
    if limit <= 0:
        return 0
    
    # Count total records
    total = CronJobLog.query.count()
    if total <= limit:
        return 0
    
    # Get IDs of records to keep (most recent)
    keep_ids = [log.id for log in CronJobLog.query.order_by(CronJobLog.created_at.desc()).limit(limit).all()]
    
    # Delete records not in keep list
    deleted = CronJobLog.query.filter(~CronJobLog.id.in_(keep_ids)).delete(synchronize_session=False)
    db.session.commit()
    
    return deleted


@settings_bp.route('/api/settings/cron-history', methods=['DELETE'])
def delete_cron_history():
    """Delete all cron history or apply limit."""
    data = request.json or {}
    delete_all = data.get('delete_all', False)
    
    if delete_all:
        # Delete all cron history
        deleted = CronJobLog.query.delete()
        db.session.commit()
        return jsonify({'message': f'Deleted {deleted} cron history entries', 'deleted': deleted})
    
    # Apply limit from settings
    settings = AppSettings.query.get(1)
    if settings and settings.cron_history_limit > 0:
        deleted = cleanup_cron_history(settings.cron_history_limit)
        return jsonify({'message': f'Cleaned up {deleted} old entries', 'deleted': deleted})
    
    return jsonify({'message': 'No cleanup performed', 'deleted': 0})


@settings_bp.route('/api/settings/cron-history/count', methods=['GET'])
def get_cron_history_count():
    """Get the count of cron history entries."""
    count = CronJobLog.query.count()
    return jsonify({'count': count})


@settings_bp.route('/api/settings', methods=['GET'])
def get_settings():
    """Get current application settings."""
    settings = AppSettings.query.get(1)
    if not settings:
        # Return defaults if no settings exist
        return jsonify({
            'ai_provider': 'openai',
            'ai_api_key': '',
            'ai_model': 'gpt-3.5-turbo',
            'ai_endpoint': '',
            'ai_configured': False,
            'cron_history_limit': 0,
            'auth_disabled': False,
            'theme': 'default'
        })
    
    # Mask API key for security (show only last 4 chars)
    masked_key = ''
    if settings.ai_api_key:
        masked_key = '*' * 20 + settings.ai_api_key[-4:] if len(settings.ai_api_key) > 4 else '****'
    
    # Ollama doesn't need API key, just endpoint
    ai_configured = bool(settings.ai_api_key) or (settings.ai_provider == 'ollama')
    
    return jsonify({
        'ai_provider': settings.ai_provider or 'openai',
        'ai_api_key': masked_key,
        'ai_model': settings.ai_model or 'gpt-3.5-turbo',
        'ai_endpoint': settings.ai_endpoint or '',
        'ai_configured': ai_configured,
        'cron_history_limit': settings.cron_history_limit or 0,
        'auth_disabled': settings.auth_disabled or False,
        'theme': settings.theme or 'default'
    })


@settings_bp.route('/api/settings', methods=['POST'])
def save_settings():
    """Save application settings."""
    data = request.json
    
    settings = AppSettings.query.get(1)
    if not settings:
        settings = AppSettings(id=1)
        db.session.add(settings)
    
    settings.ai_provider = data.get('ai_provider', 'openai')
    settings.ai_model = data.get('ai_model', 'gpt-3.5-turbo')
    settings.ai_endpoint = data.get('ai_endpoint', '')
    
    # Handle cron history limit
    cron_limit = data.get('cron_history_limit', 0)
    try:
        settings.cron_history_limit = int(cron_limit) if cron_limit else 0
    except ValueError:
        settings.cron_history_limit = 0
    
    # Handle auth_disabled setting
    settings.auth_disabled = data.get('auth_disabled', False)

    # Handle theme selection
    settings.theme = data.get('theme', 'default')
    
    # Only update API key if a new one is provided (not masked)
    new_key = data.get('ai_api_key', '')
    if new_key and not new_key.startswith('*'):
        settings.ai_api_key = new_key
    
    db.session.commit()
    
    # Apply cron history limit if set
    if settings.cron_history_limit > 0:
        cleanup_cron_history(settings.cron_history_limit)
    
    # Ollama doesn't need API key, just endpoint
    ai_configured = bool(settings.ai_api_key) or (settings.ai_provider == 'ollama')
    
    return jsonify({
        'message': 'Settings saved successfully',
        'ai_configured': ai_configured
    })


@settings_bp.route('/api/ollama/models', methods=['GET'])
def get_ollama_models():
    """Fetch available models from Ollama."""
    endpoint = request.args.get('endpoint', 'http://localhost:11434')
    
    try:
        response = requests.get(f'{endpoint}/api/tags', timeout=5)
        response.raise_for_status()
        
        data = response.json()
        models = []
        
        for model in data.get('models', []):
            name = model.get('name', '')
            # Extract just the model name without tag if it's :latest
            display_name = name.replace(':latest', '') if name.endswith(':latest') else name
            models.append({
                'name': name,
                'display': display_name,
                'size': model.get('size', 0),
                'modified': model.get('modified_at', '')
            })
        
        return jsonify({'models': models})
        
    except requests.exceptions.ConnectionError:
        return jsonify({
            'error': 'connection_failed',
            'message': f'Cannot connect to Ollama at {endpoint}. Make sure Ollama is running.'
        }), 503
    except requests.exceptions.Timeout:
        return jsonify({
            'error': 'timeout',
            'message': 'Connection to Ollama timed out.'
        }), 504
    except Exception as e:
        return jsonify({
            'error': 'unknown',
            'message': str(e)
        }), 500


@settings_bp.route('/api/ai/analyze', methods=['POST'])
def analyze_error():
    """Call AI to analyze an error."""
    settings = AppSettings.query.get(1)
    
    if not settings:
        return jsonify({
            'error': 'AI not configured',
            'message': 'Please go to Settings and configure your AI provider.'
        }), 400
    
    # Ollama doesn't need API key, other providers do
    if settings.ai_provider != 'ollama' and not settings.ai_api_key:
        return jsonify({
            'error': 'AI not configured',
            'message': 'Please go to Settings and configure your AI API key.'
        }), 400
    
    data = request.json
    prompt = data.get('prompt', '')
    
    if not prompt:
        return jsonify({'error': 'No prompt provided'}), 400
    
    try:
        if settings.ai_provider == 'openai':
            result = call_openai(settings, prompt)
        elif settings.ai_provider == 'gemini':
            result = call_gemini(settings, prompt)
        elif settings.ai_provider == 'ollama':
            result = call_ollama(settings, prompt)
        else:
            return jsonify({'error': f'Unknown AI provider: {settings.ai_provider}'}), 400
        
        return jsonify({'analysis': result})
        
    except Exception as e:
        return jsonify({
            'error': 'AI request failed',
            'message': str(e)
        }), 500


def call_openai(settings, prompt):
    """Call OpenAI API."""
    headers = {
        'Authorization': f'Bearer {settings.ai_api_key}',
        'Content-Type': 'application/json'
    }
    
    payload = {
        'model': settings.ai_model or 'gpt-3.5-turbo',
        'messages': [
            {
                'role': 'system',
                'content': 'You are an expert Linux system administrator and DevOps engineer. Analyze errors and provide clear, actionable solutions in markdown format.'
            },
            {
                'role': 'user',
                'content': prompt
            }
        ],
        'max_tokens': 1000,
        'temperature': 0.7
    }
    
    response = requests.post(
        'https://api.openai.com/v1/chat/completions',
        headers=headers,
        json=payload,
        timeout=30
    )
    response.raise_for_status()
    
    result = response.json()
    return result['choices'][0]['message']['content']


def call_gemini(settings, prompt):
    """Call Google Gemini API."""
    url = f'https://generativelanguage.googleapis.com/v1beta/models/{settings.ai_model or "gemini-pro"}:generateContent?key={settings.ai_api_key}'
    
    payload = {
        'contents': [{
            'parts': [{
                'text': f'You are an expert Linux system administrator and DevOps engineer. Analyze the following error and provide clear, actionable solutions in markdown format.\n\n{prompt}'
            }]
        }],
        'generationConfig': {
            'temperature': 0.7,
            'maxOutputTokens': 1000
        }
    }
    
    response = requests.post(url, json=payload, timeout=30)
    response.raise_for_status()
    
    result = response.json()
    return result['candidates'][0]['content']['parts'][0]['text']


def call_ollama(settings, prompt):
    """Call Ollama API (local LLM)."""
    endpoint = settings.ai_endpoint or 'http://localhost:11434'
    url = f'{endpoint}/api/generate'
    
    payload = {
        'model': settings.ai_model or 'llama2',
        'prompt': f'You are an expert Linux system administrator and DevOps engineer. Analyze the following error and provide clear, actionable solutions in markdown format.\n\n{prompt}',
        'stream': False
    }
    
    # Ollama can be slow, especially for larger models - use longer timeout
    response = requests.post(url, json=payload, timeout=120)
    response.raise_for_status()
    
    result = response.json()
    return result.get('response', 'No response from Ollama')
