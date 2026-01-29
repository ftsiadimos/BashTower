// Copyright (C) 2025 Fotios Tsiadimos
// SPDX-License-Identifier: GPL-3.0-only
//
// Template Management Module
// Methods and reactive state for managing script templates

// Data fields related to templates
const TemplatesData = () => ({
    templates: [],
    editingTemplate: false,
    templateForm: { id: null, name: '', script: '', script_type: 'bash', arguments: [] },
    templateSearchQuery: '',
    templateDropdownOpen: false,
    templateDropdownSearch: '',

    // Preview modal for easier reading of scripts
    previewTemplate: null,
    previewOpen: false,

    // AI Script Assistant state
    scriptAIPrompt: '',
    scriptAIResponse: '',
    scriptAILoading: false,
    aiConfigured: false,

    // Editor/UI expand states
    templateEditorExpanded: false,
    scriptAIExpanded: false,
    // Fullscreen pop-out editor (Ace)
    fullEditorOpen: false,
    // Full editor cursor position display
    fullEditorCursor: 'Ln 1, Col 1',

    // Git Sync state
    gitSyncModalOpen: false,
    gitSyncTab: 'config',
    gitConfig: {
        repo_url: '',
        branch: 'main',
        access_token: '',
        configured: false,
        last_sync: null,
        sync_status: null
    },
    showGitToken: false,
    gitSyncLoading: false,
    gitTestLoading: false,
    gitExportLoading: false,
    gitImportLoading: false,
    gitPreviewLoading: false,
    gitBackupLoading: false,
    gitRestoreLoading: false,
    gitSyncMessage: '',
    gitImportOverwrite: false,
    gitRestoreOverwrite: false,
    gitBackupIncludeSensitive: false,
    gitImportPreview: null,
    backupStats: null,
    showRefreshButton: false
});

// Computed properties related to templates
const TemplatesComputed = {
    // Page templates list (uses page search only)
    filteredTemplates() {
        const query = (this.templateSearchQuery || '').trim().toLowerCase();
        if (!query) return this.templates;
        return this.templates.filter(t => t.name.toLowerCase().includes(query));
    },

    // Dropdown templates list (uses dropdown search only, independent of page search)
    filteredTemplatesDropdown() {
        const query = (this.templateDropdownSearch || '').trim().toLowerCase();
        if (!query) return this.templates;
        return this.templates.filter(t => t.name.toLowerCase().includes(query));
    }
};

const TemplatesMethods = {
    // Fetch all templates from API
    async fetchTemplates() {
        const response = await fetch(API.TEMPLATES);
        this.templates = await response.json();
        if (this.templates.length > 0 && !this.runForm.template_id) {
            this.runForm.template_id = this.templates[0].id;
        }
    },

    // Start creating a new template
    startNewTemplate() {
        this.templateForm = { id: null, name: '', script: '', script_type: 'bash', arguments: [] };
        this.editingTemplate = true;
    },

    // Edit an existing template
    editTemplate(template) {
        // Parse arguments if they exist
        let templateArguments = [];
        if (template.arguments) {
            try {
                templateArguments = JSON.parse(template.arguments);
            } catch (e) {
                console.warn('Failed to parse template arguments:', e);
                templateArguments = [];
            }
        }
        
        this.templateForm = { 
            ...template, 
            script: template.script, 
            script_type: template.script_type || 'bash',
            arguments: templateArguments
        };
        this.editingTemplate = true;
    },

    // Cancel template editing
    cancelEdit() {
        this.editingTemplate = false;
    },

    // Save template (create or update)
    async saveTemplate() {
        if (!this.templateForm.name || !this.templateForm.script) {
            alert('Please provide both a template name and script.');
            return;
        }

        const method = this.templateForm.id ? 'PUT' : 'POST';
        const url = this.templateForm.id ? `${API.TEMPLATES}/${this.templateForm.id}` : API.TEMPLATES;

        const payload = {
            name: this.templateForm.name,
            script: this.templateForm.script,
            script_type: this.templateForm.script_type || 'bash',
            arguments: JSON.stringify(this.templateForm.arguments || [])
        };

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) {
            this.editingTemplate = false;
            this.fetchTemplates();
        } else {
            const error = await response.json();
            alert(error.error || 'Failed to save template');
        }
    },

    // Delete a template
    async deleteTemplate(id) {
        if (confirm('Are you sure you want to delete this template?')) {
            const response = await fetch(`${API.TEMPLATES}/${id}`, { method: 'DELETE' });
            
            if (!response.ok) {
                const error = await response.json();
                if (error.cron_jobs) {
                    alert(`Cannot delete template!\n\nIt is used by the following cron jobs:\n• ${error.cron_jobs.join('\n• ')}`);
                } else {
                    alert(error.message || 'Failed to delete template.');
                }
                return;
            }
            
            this.fetchTemplates();
        }
    },

    // Get template name by ID (helper)
    getTemplateNameById(templateId) {
        const template = this.templates.find(t => t.id === templateId);
        return template ? template.name : 'Unknown Template';
    },

    // Open a read-only preview modal for the given template (easier reading)
    openPreview(template) {
        this.previewTemplate = template;
        this.previewOpen = true;
        // wait for DOM update then highlight
        this.$nextTick(() => {
            const codeEl = document.querySelector('#template-preview code');
            if (codeEl && window.hljs) {
                codeEl.removeAttribute('data-highlighted');
                window.hljs.highlightElement(codeEl);
            }
        });
    },

    closePreview() {
        this.previewOpen = false;
        this.previewTemplate = null;
    },

    // Copy script to clipboard from preview
    async copyScriptFromPreview() {
        if (!this.previewTemplate || !this.previewTemplate.script) {
            alert('No script to copy');
            return;
        }
        
        const text = this.previewTemplate.script;
        
        // Try modern clipboard API first, fallback to older method
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                // Fallback for non-HTTPS or older browsers
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            
            const fb = document.createElement('div');
            fb.textContent = 'Script copied to clipboard';
            fb.className = 'fixed bottom-4 right-4 bg-green-600 text-white text-xs px-3 py-2 rounded shadow z-50';
            document.body.appendChild(fb);
            setTimeout(() => fb.remove(), 1500);
        } catch (e) {
            console.error('copy failed:', e);
            alert('Failed to copy script: ' + e.message);
        }
    },

    // Toggle the dropdown open/closed; clear dropdown search when closing
    toggleTemplateDropdown() {
        this.templateDropdownOpen = !this.templateDropdownOpen;
        if (!this.templateDropdownOpen) {
            this.templateDropdownSearch = '';
        }
    },

    // Close dropdown and clear the search
    closeTemplateDropdown() {
        this.templateDropdownOpen = false;
        this.templateDropdownSearch = '';
    },

    // Select a template from the dropdown and close it (clears search)
    selectTemplateFromDropdown(id) {
        this.runForm.template_id = id;
        this.templateDropdownOpen = false;
        this.templateDropdownSearch = '';
        
        // Clear any existing arguments when template changes
        this.runForm.arguments = {};
        
        // Pre-populate with default values if template has arguments
        const selectedTemplate = this.templates.find(t => t.id === id);
        if (selectedTemplate && selectedTemplate.arguments) {
            try {
                const templateArgs = JSON.parse(selectedTemplate.arguments);
                templateArgs.forEach(arg => {
                    if (arg.default_value) {
                        this.runForm.arguments[arg.name] = arg.default_value;
                    }
                });
            } catch (e) {
                console.warn('Failed to parse template arguments:', e);
            }
        }
    },

    // AI Script Assistant - Generate or improve bash script
    async askScriptAI() {
        if (this.scriptAILoading) return;
        
        if (!this.scriptAIPrompt.trim()) {
            alert('Please describe what you want the script to do.');
            return;
        }

        // Check if AI is configured
        if (!this.aiConfigured) {
            alert('AI is not configured. Please go to Settings and configure your AI provider.');
            return;
        }

        this.scriptAILoading = true;
        this.scriptAIResponse = '';

        const existingScript = this.templateForm.script || '';
        const scriptType = this.templateForm.script_type || 'bash';
        let prompt;

        // Always instruct the AI to be an expert in both Bash and Python scripting
        if (existingScript.trim()) {
            prompt = `You are an expert in both Bash and Python scripting. The user has an existing ${scriptType} script and wants to modify or improve it.

    Existing Script:
    \`\`\`${scriptType}
    ${existingScript}
    \`\`\`

    User Request: ${this.scriptAIPrompt}

    Provide the complete updated ${scriptType} script. Include helpful comments. Only output the script code, no explanations before or after.`;
        } else {
            prompt = `You are an expert in both Bash and Python scripting. Create a ${scriptType} script based on the following requirements:

    ${this.scriptAIPrompt}

    Provide a complete, production-ready ${scriptType} script with:
    - Proper error handling
    - Helpful comments
    - Best practices for ${scriptType} scripting

    Only output the script code, no explanations before or after.`;
        }

        try {
            const response = await fetch('/api/ai/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: prompt })
            });

            const result = await response.json();

            if (response.ok && result.analysis) {
                // Extract script from response (remove markdown code blocks if present)
                let script = result.analysis;
                script = script.replace(/^```bash\n?/gm, '').replace(/^```\n?/gm, '').replace(/```$/gm, '').trim();
                this.scriptAIResponse = script;
            } else {
                this.scriptAIResponse = `Error: ${result.message || result.error || 'Could not generate script.'}`;
            }
        } catch (error) {
            this.scriptAIResponse = `Network error: ${error.message}`;
        } finally {
            this.scriptAILoading = false;
        }
    },

    // Apply AI generated script to the template form
    applyAIScript() {
        if (this.scriptAIResponse && !this.scriptAIResponse.startsWith('Error:') && !this.scriptAIResponse.startsWith('Network error:')) {
            this.templateForm.script = this.scriptAIResponse;
            this.scriptAIResponse = '';
            this.scriptAIPrompt = '';
        }
    },

    // Clear AI response
    clearAIResponse() {
        this.scriptAIResponse = '';
    },

    // Add a new argument to the template
    addArgument() {
        if (!this.templateForm.arguments) {
            this.templateForm.arguments = [];
        }
        this.templateForm.arguments.push({
            name: '',
            label: '',
            type: 'text',
            required: true,
            default_value: '',
            description: ''
        });
    },

    // Remove an argument from the template
    removeArgument(index) {
        this.templateForm.arguments.splice(index, 1);
    },

    // Get argument placeholder text for use in scripts
    getArgumentPlaceholder(arg) {
        return `{{${arg.name}}}`;
    },

    // Toggle the template editor expand/collapse state
    toggleTemplateEditorExpand() {
        this.templateEditorExpanded = !this.templateEditorExpanded;
        // focus textarea after expanding for convenience
        this.$nextTick(() => {
            const ta = document.querySelector('textarea[v-model="templateForm.script"]') || document.querySelector('textarea[ v-model="templateForm.script"]');
            if (ta) ta.focus();
        });
    },

    // Open full-screen Ace editor (pop-out)
    openFullEditor() {
        this.fullEditorOpen = true;
        this.$nextTick(() => {
            const el = document.getElementById('full-template-editor');
            if (!el) return;

            // Destroy previous instance if any
            try { if (this._fullEditorInstance) { this._fullEditorInstance.destroy(); delete this._fullEditorInstance; } } catch(e){}

            if (window.ace && typeof window.ace.edit === 'function') {
                this._fullEditorInstance = window.ace.edit(el);
                const theme = 'ace/theme/monokai';
                this._fullEditorInstance.setTheme(theme);
                const mode = this.templateForm.script_type === 'python' ? 'ace/mode/python' : 'ace/mode/sh';
                this._fullEditorInstance.session.setMode(mode);
                this._fullEditorInstance.session.setValue(this.templateForm.script || '');



                // Editor options
                this._fullEditorInstance.setOptions({fontSize: '13pt', wrap: false, showLineNumbers: true, showGutter: true});

                // Enable basic search on Ctrl-F (open the SearchBox extension)
                try {
                    const SearchBox = window.ace.require && window.ace.require('ace/ext/searchbox');
                    if (SearchBox) {
                        this._fullEditorInstance.commands.addCommand({
                            name: 'find',
                            bindKey: {win: 'Ctrl-F', mac: 'Command-F'},
                            exec: function(editor) { SearchBox.Search(editor, true); }
                        });
                    }
                } catch (e) { /* ignore */ }

                // Save keybinding
                this._fullEditorInstance.commands.addCommand({
                    name: 'save',
                    bindKey: {win: 'Ctrl-S', mac: 'Command-S'},
                    exec: () => this.applyFullEditor()
                });

                // Focus and store state
                this._fullEditorInstance.focus();

                // Keep mode up to date if script type changes
                try {
                    if (this._aceModeUnwatch) this._aceModeUnwatch();
                    this._aceModeUnwatch = this.$watch('templateForm.script_type', (newType) => {
                        try {
                            const mode = newType === 'python' ? 'ace/mode/python' : 'ace/mode/sh';
                            this._fullEditorInstance.session.setMode(mode);
                        } catch(e){}
                    });
                } catch(e){}

                // Live sync and change handler
                try {
                    if (this._fullEditorChangeHandler) {
                        try { this._fullEditorInstance.getSession().off('change', this._fullEditorChangeHandler); } catch(e){}
                        this._fullEditorChangeHandler = null;
                    }
                    this._fullEditorChangeHandler = () => {
                        try { this.templateForm.script = this._fullEditorInstance.getValue(); } catch(e){}
                    };
                    this._fullEditorInstance.getSession().on('change', this._fullEditorChangeHandler);

                    // Cursor position handler for status display
                    if (this._aceCursorHandler) {
                        try { this._fullEditorInstance.selection.off('changeCursor', this._aceCursorHandler); } catch(e){}
                        this._aceCursorHandler = null;
                    }
                    this._aceCursorHandler = () => {
                        try {
                            const p = this._fullEditorInstance.getCursorPosition();
                            this.fullEditorCursor = `Ln ${p.row+1}, Col ${p.column+1}`;
                        } catch (e) { }
                    };
                    this._fullEditorInstance.selection.on('changeCursor', this._aceCursorHandler);
                } catch (e) { console.warn('Could not attach change handler to Ace:', e); }
            } else {
                alert('Full editor library not loaded.');
            }
        });
    },

    // Apply changes from full editor back to the form and close
    applyFullEditor() {
        if (this._fullEditorInstance) {
            try {
                this.templateForm.script = this._fullEditorInstance.getValue();
            } catch (e) { console.warn('applyFullEditor read error', e); }
        }

        // Clean-up editor resources
        try {
            if (this._fullEditorChangeHandler && this._fullEditorInstance) {
                try { this._fullEditorInstance.getSession().off('change', this._fullEditorChangeHandler); } catch(e){}
                this._fullEditorChangeHandler = null;
            }
            if (this._aceCursorHandler && this._fullEditorInstance) {
                try { this._fullEditorInstance.selection.off('changeCursor', this._aceCursorHandler); } catch(e){}
                this._aceCursorHandler = null;
            }
            if (this._aceModeUnwatch) { try { this._aceModeUnwatch(); } catch(e){}; this._aceModeUnwatch = null; }
        } catch(e) { console.warn('cleanup error', e); }

        this.fullEditorOpen = false;
        this.$nextTick(() => {
            try { if (this._fullEditorInstance) { this._fullEditorInstance.destroy(); delete this._fullEditorInstance; } } catch(e){}
        });
    },

    // Close full editor without applying changes
    closeFullEditor() {
        try {
            if (this._fullEditorChangeHandler && this._fullEditorInstance) {
                try { this._fullEditorInstance.getSession().off('change', this._fullEditorChangeHandler); } catch(e){}
                this._fullEditorChangeHandler = null;
            }
            if (this._aceCursorHandler && this._fullEditorInstance) {
                try { this._fullEditorInstance.selection.off('changeCursor', this._aceCursorHandler); } catch(e){}
                this._aceCursorHandler = null;
            }
            if (this._aceModeUnwatch) { try { this._aceModeUnwatch(); } catch(e){}; this._aceModeUnwatch = null; }
        } catch(e) { console.warn('cleanup error', e); }

        this.fullEditorOpen = false;
        this.$nextTick(() => {
            try { if (this._fullEditorInstance) { this._fullEditorInstance.destroy(); delete this._fullEditorInstance; } } catch(e){}
        });
    },

    // Toggle AI response expanded state
    toggleScriptAIExpand() {
        this.scriptAIExpanded = !this.scriptAIExpanded;
        this.$nextTick(() => {
            const pre = document.querySelector('.script-ai-response');
            if (pre && window.hljs) try { window.hljs.highlightElement(pre.querySelector('code') || pre); } catch(e){}
        });
    },

    // Open Ace search box (or trigger editor find)
    openEditorSearch() {
        if (!this._fullEditorInstance) return;
        try {
            const SearchBox = window.ace.require && window.ace.require('ace/ext/searchbox');
            if (SearchBox) {
                SearchBox.Search(this._fullEditorInstance, true);
            } else {
                // fallback: open builtin find
                this._fullEditorInstance.execCommand('find');
            }
        } catch (e) {
            console.warn('Search extension not available', e);
            try { this._fullEditorInstance.execCommand('find'); } catch(e){}
        }
    },









    // ========================================================================
    // Git Sync Methods
    // ========================================================================

    // Open Git Sync modal and fetch current configuration
    async openGitSyncModal() {
        this.gitSyncModalOpen = true;
        this.gitSyncMessage = '';
        this.gitImportPreview = null;
        this.showRefreshButton = false;
        await this.fetchGitConfig();
        await this.fetchBackupStats();
    },

    // Close Git Sync modal
    closeGitSyncModal() {
        this.gitSyncModalOpen = false;
        this.gitSyncMessage = '';
        this.gitImportPreview = null;
    },

    // Fetch Git configuration from server
    async fetchGitConfig() {
        try {
            const response = await fetch('/api/git/config');
            const data = await response.json();
            
            this.gitConfig.repo_url = data.repo_url || '';
            this.gitConfig.branch = data.branch || 'main';
            this.gitConfig.access_token = data.access_token || '';
            this.gitConfig.configured = data.configured || false;
            this.gitConfig.last_sync = data.last_sync;
            this.gitConfig.sync_status = data.sync_status;
        } catch (error) {
            console.error('Error fetching Git config:', error);
            this.gitSyncMessage = 'Error: Failed to load Git configuration';
        }
    },

    // Fetch backup statistics (hosts and groups count)
    async fetchBackupStats() {
        try {
            // Fetch hosts count
            const hostsResponse = await fetch(API.HOSTS);
            const hosts = await hostsResponse.json();
            
            // Fetch groups count
            const groupsResponse = await fetch(API.GROUPS);
            const groups = await groupsResponse.json();
            
            this.backupStats = {
                hosts: hosts.length || 0,
                groups: groups.length || 0
            };
        } catch (error) {
            console.error('Error fetching backup stats:', error);
            this.backupStats = { hosts: 0, groups: 0 };
        }
    },

    // Save Git configuration
    async saveGitConfig() {
        this.gitSyncLoading = true;
        this.gitSyncMessage = '';
        
        try {
            const response = await fetch('/api/git/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    repo_url: this.gitConfig.repo_url,
                    branch: this.gitConfig.branch,
                    access_token: this.gitConfig.access_token
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.gitSyncMessage = 'Configuration saved successfully!';
                this.gitConfig.configured = data.configured;
                await this.fetchGitConfig();
            } else {
                this.gitSyncMessage = 'Error: ' + (data.error || 'Failed to save configuration');
            }
        } catch (error) {
            this.gitSyncMessage = 'Error: ' + error.message;
        } finally {
            this.gitSyncLoading = false;
        }
    },

    // Test Git repository connection
    async testGitConnection() {
        this.gitTestLoading = true;
        this.gitSyncMessage = '';
        
        try {
            const response = await fetch('/api/git/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.gitSyncMessage = 'Connection successful! Available branches: ' + (data.branches || []).join(', ');
            } else {
                this.gitSyncMessage = 'Error: ' + (data.error || 'Connection test failed');
            }
        } catch (error) {
            this.gitSyncMessage = 'Error: ' + error.message;
        } finally {
            this.gitTestLoading = false;
        }
    },

    // Export templates to Git
    async exportToGit() {
        if (!confirm('This will push all templates to the Git repository. Continue?')) {
            return;
        }
        
        this.gitExportLoading = true;
        this.gitSyncMessage = '';
        
        try {
            const response = await fetch('/api/git/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.gitSyncMessage = data.message;
                await this.fetchGitConfig(); // Refresh to get updated last_sync
            } else {
                this.gitSyncMessage = 'Error: ' + (data.error || 'Export failed');
            }
        } catch (error) {
            this.gitSyncMessage = 'Error: ' + error.message;
        } finally {
            this.gitExportLoading = false;
        }
    },

    // Preview import from Git
    async previewGitImport() {
        this.gitPreviewLoading = true;
        this.gitSyncMessage = '';
        
        try {
            const response = await fetch('/api/git/preview');
            const data = await response.json();
            
            if (response.ok) {
                this.gitImportPreview = data;
                if (data.total === 0) {
                    this.gitSyncMessage = 'No templates found in repository';
                }
            } else {
                this.gitSyncMessage = 'Error: ' + (data.error || 'Preview failed');
                this.gitImportPreview = null;
            }
        } catch (error) {
            this.gitSyncMessage = 'Error: ' + error.message;
            this.gitImportPreview = null;
        } finally {
            this.gitPreviewLoading = false;
        }
    },

    // Import templates from Git
    async importFromGit() {
        const confirmMsg = this.gitImportOverwrite 
            ? 'This will import templates and overwrite any existing ones with the same name. Continue?'
            : 'This will import new templates from Git. Existing templates will be skipped. Continue?';
        
        if (!confirm(confirmMsg)) {
            return;
        }
        
        this.gitImportLoading = true;
        this.gitSyncMessage = '';
        
        try {
            const response = await fetch('/api/git/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    overwrite: this.gitImportOverwrite
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.gitSyncMessage = data.message;
                if (data.errors && data.errors.length > 0) {
                    this.gitSyncMessage += '\nWarnings: ' + data.errors.join(', ');
                }
                await this.fetchGitConfig(); // Refresh to get updated last_sync
                await this.fetchTemplates(); // Refresh templates list
                this.gitImportPreview = null;
            } else {
                this.gitSyncMessage = 'Error: ' + (data.error || 'Import failed');
            }
        } catch (error) {
            this.gitSyncMessage = 'Error: ' + error.message;
        } finally {
            this.gitImportLoading = false;
        }
    },

    // Backup everything to Git
    async backupToGit() {
        const confirmMsg = this.gitBackupIncludeSensitive
            ? 'This will create a full backup INCLUDING SENSITIVE DATA (SSH keys, passwords, API tokens) to the backup branch. Make sure your repository is private! Continue?'
            : 'This will create a full backup of all templates, hosts, groups, and configuration (excluding sensitive data) to the backup branch. Continue?';
        
        if (!confirm(confirmMsg)) {
            return;
        }
        
        this.gitBackupLoading = true;
        this.gitSyncMessage = '';
        
        try {
            const response = await fetch('/api/git/backup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    include_sensitive: this.gitBackupIncludeSensitive
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.gitSyncMessage = data.message;
                if (data.stats) {
                    this.gitSyncMessage += `\n\nBacked up: ${data.stats.templates} templates, ${data.stats.hosts} hosts, ${data.stats.groups} groups, ${data.stats.ssh_keys} SSH keys, ${data.stats.cron_jobs} cron jobs, ${data.stats.users} users`;
                    if (data.stats.app_settings_included) {
                        this.gitSyncMessage += '\n✓ App Settings: AI config, Login settings, Cron history limit';
                    }
                    if (data.stats.satellite_config_included) {
                        this.gitSyncMessage += '\n✓ Satellite/Foreman configuration';
                    }
                    if (data.stats.sensitive_data_included) {
                        this.gitSyncMessage += '\n⚠️ Sensitive data INCLUDED (SSH keys, passwords, API tokens)';
                    }
                }
                this.backupStats = data.stats;
            } else {
                this.gitSyncMessage = 'Error: ' + (data.error || 'Backup failed');
            }
        } catch (error) {
            this.gitSyncMessage = 'Error: ' + error.message;
        } finally {
            this.gitBackupLoading = false;
        }
    },

    // Restore everything from Git
    async restoreFromGit() {
        const confirmMsg = this.gitRestoreOverwrite 
            ? 'This will restore data from backup and OVERWRITE existing data with the same names. This cannot be undone! Continue?'
            : 'This will restore data from backup. Existing data with the same names will be skipped. Continue?';
        
        if (!confirm(confirmMsg)) {
            return;
        }
        
        this.gitRestoreLoading = true;
        this.gitSyncMessage = '';
        
        try {
            const response = await fetch('/api/git/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    overwrite: this.gitRestoreOverwrite
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.gitSyncMessage = data.message;
                if (data.stats && data.stats.errors && data.stats.errors.length > 0) {
                    this.gitSyncMessage += '\n\nWarnings: ' + data.stats.errors.join(', ');
                }
                await this.fetchTemplates(); // Refresh templates list
                this.showRefreshButton = true; // Show refresh button
            } else {
                this.gitSyncMessage = 'Error: ' + (data.error || 'Restore failed');
            }
        } catch (error) {
            this.gitSyncMessage = 'Error: ' + error.message;
        } finally {
            this.gitRestoreLoading = false;
        }
    },

    // Refresh the page
    refreshPage() {
        window.location.reload();
    }
};
