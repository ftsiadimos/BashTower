// Cron Job Management Module
// Methods for managing scheduled cron jobs

const CronJobsMethods = {
    // Fetch all cron jobs from API
    async fetchCronJobs() {
        try {
            const response = await fetch(API.CRONJOBS);
            this.cronjobs = await response.json();
        } catch (error) {
            console.error('Error fetching cron jobs:', error);
        }
    },

    // Start creating a new cron job
    startNewCronJob() {
        this.editingCronJob = true;
        this.cronHostSearchQuery = '';
        this.cronGroupSearchQuery = '';
        this.cronJobForm = {
            id: null,
            name: '',
            schedule: '',
            template_id: null,
            key_id: null,
            host_ids: [],
            group_ids: [],
            selection_type: 'groups',
            enabled: true
        };
        if (this.templates.length > 0) {
            this.cronJobForm.template_id = this.templates[0].id;
        }
        if (this.keys.length > 0) {
            this.cronJobForm.key_id = this.keys[0].id;
        }
    },

    // Edit an existing cron job
    editCronJob(job) {
        this.editingCronJob = true;
        this.cronHostSearchQuery = '';
        this.cronGroupSearchQuery = '';
        this.cronJobForm = {
            id: job.id,
            name: job.name,
            schedule: job.schedule,
            template_id: job.template_id,
            key_id: job.key_id,
            host_ids: [...job.host_ids],
            group_ids: [],
            selection_type: 'hosts',
            enabled: job.enabled
        };
    },

    // Cancel cron job editing
    cancelCronJobEdit() {
        this.editingCronJob = false;
        this.cronJobForm = { 
            id: null, 
            name: '', 
            schedule: '', 
            template_id: null, 
            key_id: null, 
            host_ids: [], 
            group_ids: [], 
            selection_type: 'groups', 
            enabled: true 
        };
    },

    // Toggle select all hosts for cron job
    toggleSelectAllCronJobHosts(event) {
        if (event.target.checked) {
            this.cronJobForm.host_ids = this.hosts.map(h => h.id);
        } else {
            this.cronJobForm.host_ids = [];
        }
    },

    // Toggle select all groups for cron job
    toggleSelectAllCronJobGroups(event) {
        if (event.target.checked) {
            this.cronJobForm.group_ids = this.groups.map(g => g.id);
        } else {
            this.cronJobForm.group_ids = [];
        }
    },

    // Save cron job (create or update)
    async saveCronJob() {
        // Basic validation for required fields
        if (!this.cronJobForm.name || !this.cronJobForm.schedule || !this.cronJobForm.template_id || !this.cronJobForm.key_id) {
            alert('Please fill all required fields.');
            return;
        }

        // Validate cron expression format on frontend
        if (!this.isValidCronExpression(this.cronJobForm.schedule)) {
            alert('Invalid cron expression format.\\n\\nExpected format: * * * * * (minute hour day month weekday)\\n\\nExamples:\\n• */15 * * * * (every 15 minutes)\\n• 0 * * * * (every hour)\\n• 0 0 * * * (daily at midnight)\\n• 0 0 * * 0 (weekly on Sunday)');
            return;
        }

        // Validate selection based on the chosen type
        if (this.cronJobForm.selection_type === 'hosts' && this.cronJobForm.host_ids.length === 0) {
            alert('Please select at least one host.');
            return;
        }
        if (this.cronJobForm.selection_type === 'groups' && this.cronJobForm.group_ids.length === 0) {
            alert('Please select at least one group.');
            return;
        }

        try {
            const method = this.cronJobForm.id ? 'PUT' : 'POST';
            const url = this.cronJobForm.id ? `${API.CRONJOBS}/${this.cronJobForm.id}` : API.CRONJOBS;

            const payload = {
                ...this.cronJobForm,
                host_ids: this.cronJobForm.host_ids || [],
                group_ids: this.cronJobForm.group_ids || []
            };

            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                await this.fetchCronJobs();
                this.cancelCronJobEdit();
            } else {
                const errorData = await response.json().catch(() => ({}));
                alert(errorData.error || 'Failed to save cron job.');
            }
        } catch (error) {
            console.error('Error saving cron job:', error);
            alert('An error occurred while saving the cron job.');
        }
    },

    // Validate cron expression format (basic frontend validation)
    isValidCronExpression(expr) {
        if (!expr || !expr.trim()) return false;
        
        const parts = expr.trim().split(/\s+/);
        
        // Standard cron has 5 parts: minute hour day month weekday
        if (parts.length !== 5) return false;
        
        // Generic cron field pattern: *, */N, N, N-M, N-M/S, or comma-separated combinations
        const cronFieldPattern = /^(\*|\d+)(-\d+)?(\/\d+)?(,(\*|\d+)(-\d+)?(\/\d+)?)*$/;
        
        // Check each part matches the pattern
        for (let i = 0; i < 5; i++) {
            if (!cronFieldPattern.test(parts[i])) {
                return false;
            }
        }
        
        return true;
    },

    // Delete a cron job
    async deleteCronJob(id) {
        if (confirm('Are you sure you want to delete this cron job?')) {
            try {
                const response = await fetch(`${API.CRONJOBS}/${id}`, {
                    method: 'DELETE'
                });

                if (response.ok) {
                    await this.fetchCronJobs();
                } else {
                    alert('Failed to delete cron job.');
                }
            } catch (error) {
                console.error('Error deleting cron job:', error);
                alert('An error occurred while deleting the cron job.');
            }
        }
    }
};
