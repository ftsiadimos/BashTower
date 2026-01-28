// Settings Management Module
// Methods for managing application settings including AI configuration

const SettingsMethods = {
    // Fetch current settings
    async fetchSettings() {
        try {
            const response = await fetch('/api/settings');
            const data = await response.json();
            
            this.settingsForm.ai_provider = data.ai_provider || 'openai';
            this.settingsForm.ai_api_key = data.ai_api_key || '';
            this.settingsForm.ai_model = data.ai_model || 'gpt-3.5-turbo';
            this.settingsForm.ai_endpoint = data.ai_endpoint || '';
            this.settingsForm.cron_history_limit = data.cron_history_limit || 0;
            this.settingsForm.auth_disabled = data.auth_disabled || false;
            this.aiConfigured = data.ai_configured || false;
            
            // Fetch cron history count
            await this.refreshCronHistoryCount();
            
            // Fetch Ollama models if provider is ollama
            if (this.settingsForm.ai_provider === 'ollama') {
                await this.fetchOllamaModels();
            }
        } catch (error) {
            console.error('Error fetching settings:', error);
        }
    },

    // Fetch available Ollama models
    async fetchOllamaModels() {
        this.ollamaModelsLoading = true;
        this.ollamaModelsError = '';
        
        try {
            const endpoint = this.settingsForm.ai_endpoint || 'http://localhost:11434';
            const response = await fetch(`/api/ollama/models?endpoint=${encodeURIComponent(endpoint)}`);
            const data = await response.json();
            
            if (response.ok) {
                this.ollamaModels = data.models || [];
                // If current model not in list and we have models, select first one
                if (this.ollamaModels.length > 0) {
                    const modelNames = this.ollamaModels.map(m => m.name);
                    if (!modelNames.includes(this.settingsForm.ai_model)) {
                        this.settingsForm.ai_model = this.ollamaModels[0].name;
                    }
                }
            } else {
                this.ollamaModelsError = data.message || 'Failed to fetch models';
                this.ollamaModels = [];
            }
        } catch (error) {
            this.ollamaModelsError = 'Failed to connect to Ollama';
            this.ollamaModels = [];
        } finally {
            this.ollamaModelsLoading = false;
        }
    },

    // Handle provider change
    async onProviderChange() {
        // Set default model for each provider
        if (this.settingsForm.ai_provider === 'openai') {
            this.settingsForm.ai_model = 'gpt-3.5-turbo';
            this.ollamaModels = [];
            this.ollamaModelsError = '';
        } else if (this.settingsForm.ai_provider === 'gemini') {
            this.settingsForm.ai_model = 'gemini-pro';
            this.ollamaModels = [];
            this.ollamaModelsError = '';
        } else if (this.settingsForm.ai_provider === 'ollama') {
            this.settingsForm.ai_model = '';
            // Automatically fetch Ollama models
            await this.fetchOllamaModels();
        }
    },

    // Save settings
    async saveSettings() {
        this.settingsSaving = true;
        this.settingsMessage = '';
        
        try {
            const response = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.settingsForm)
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.settingsMessage = 'Settings saved successfully!';
                this.aiConfigured = data.ai_configured;
                // Refresh settings to get masked key
                await this.fetchSettings();
            } else {
                this.settingsMessage = 'Error: ' + (data.error || 'Failed to save settings');
            }
        } catch (error) {
            this.settingsMessage = 'Error: ' + error.message;
        } finally {
            this.settingsSaving = false;
            
            // Refresh cron history count after save (in case cleanup happened)
            await this.refreshCronHistoryCount();
            
            // Clear message after 3 seconds
            setTimeout(() => {
                this.settingsMessage = '';
            }, 3000);
        }
    },

    // Refresh cron history count
    async refreshCronHistoryCount() {
        try {
            const response = await fetch('/api/settings/cron-history/count');
            const data = await response.json();
            this.cronHistoryCount = data.count || 0;
        } catch (error) {
            console.error('Error fetching cron history count:', error);
        }
    },

    // Show delete confirmation modal
    confirmDeleteCronHistory() {
        this.showDeleteCronHistoryModal = true;
    },

    // Delete all cron history
    async deleteCronHistory() {
        this.deletingCronHistory = true;
        
        try {
            const response = await fetch('/api/settings/cron-history', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ delete_all: true })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                this.settingsMessage = `Deleted ${data.deleted} cron history entries`;
                this.showDeleteCronHistoryModal = false;
                await this.refreshCronHistoryCount();
                // Refresh cron history list if on that page
                if (typeof this.fetchCronHistory === 'function') {
                    await this.fetchCronHistory();
                }
            } else {
                this.settingsMessage = 'Error: ' + (data.error || 'Failed to delete history');
            }
        } catch (error) {
            this.settingsMessage = 'Error: ' + error.message;
        } finally {
            this.deletingCronHistory = false;
            
            // Clear message after 3 seconds
            setTimeout(() => {
                this.settingsMessage = '';
            }, 3000);
        }
    },

    // Open Git Backup modal from settings
    openGitBackup() {
        // Switch to templates view
        this.currentView = 'templates';
        // Wait for view to render, then open modal
        this.$nextTick(() => {
            if (typeof this.openGitSyncModal === 'function') {
                this.openGitSyncModal();
                // Switch to backup tab
                this.gitSyncTab = 'backup';
            }
        });
    }
};
