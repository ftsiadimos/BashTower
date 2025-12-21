// Template Management Module
// Methods and reactive state for managing script templates

// Data fields related to templates
const TemplatesData = () => ({
    templates: [],
    editingTemplate: false,
    templateForm: { id: null, name: '', script: '', script_type: 'bash' },
    templateSearchQuery: '',
    templateDropdownOpen: false,
    templateDropdownSearch: '',

    // AI Script Assistant state
    scriptAIPrompt: '',
    scriptAIResponse: '',
    scriptAILoading: false,
    aiConfigured: false
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
        this.templateForm = { id: null, name: '', script: '', script_type: 'bash' };
        this.editingTemplate = true;
    },

    // Edit an existing template
    editTemplate(template) {
        this.templateForm = { ...template, script: template.script, script_type: template.script_type || 'bash' };
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
            script_type: this.templateForm.script_type || 'bash'
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
    }
};
