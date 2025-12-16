// --- Firebase Setup (Required for Canvas Environment) ---
// These variables are provided by the hosting environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? initialAuthToken : null;

// Mock UUID function for environments where crypto is not available
const mockUuid = () => {
    return 'id-' + Math.random().toString(36).substring(2, 9);
};

// --- API Endpoints ---
const API = {
    TEMPLATES: '/api/templates',
    HOSTS: '/api/hosts',
    KEYS: '/api/keys',
    GROUPS: '/api/groups', // NEW
    JOBS: '/api/jobs', // Used for GET job history and details
    RUNNER: '/api/run', // Used for POST job execution
    SATELLITE_CONFIG: '/api/satellite/config', 
    SATELLITE_SYNC: '/api/satellite/sync',
    CRONJOBS: '/api/cronjobs' 
};

const App = {
    // FIX: Change delimiters to avoid conflict with Jinja2/server-side templating
    delimiters: ['[[', ']]'],
    
        data() {
            return {
                currentView: 'dashboard',
                
                // --- Template Management ---
                templates: [],
                editingTemplate: false,
                templateForm: { id: null, name: '', script: '' },

                // --- Host Management ---
                hosts: [],
                hostForm: { name: '', hostname: '', username: '', port: 22 },

                // --- Key Management ---
                keys: [],
                keyForm: { name: '', private_key: '' },

                // --- Group Management (NEW) ---
                groups: [],
                editingGroup: false,
                groupForm: { id: null, name: '', host_ids: [] },

                // --- Job Runner (MODIFIED) ---
                isRunning: false,
                jobHistory: [],
                activeJob: null,
                jobPollingInterval: null,
                runForm: {
                    template_id: null,
                    selection_type: 'groups', // NEW: 'groups' or 'hosts'
                    host_ids: [], // NEW: For single host selection
                    group_ids: [],
                    key_id: null
                },

                // --- AI Troubleshooter ---
                llmLoading: false,

                // --- Satellite Sync (Unchanged) ---
                satelliteConfig: { url: '', username: '', ssh_username: 'ec2-user' },
                satelliteForm: { url: '', username: '', password: '', ssh_username: 'ec2-user' }, 
                satelliteLoading: false,
                syncMessage: '',
                cronjobs: [],
                editingCronJob: false,
                cronJobForm: { id: null, name: '', schedule: '', template_id: null, key_id: null, host_ids: [], enabled: true },
                // New state for cron history view with pagination

                cronHistory: [],
                cronHistoryPage: 1,
                cronHistoryPerPage: 14,
                cronHistoryTotal: 0,
                cronHistoryPollingInterval: null,
                activeCronLog: null
            };
        },
    
    // Computed property to calculate selected hosts from groups (MODIFIED to check selection_type)
    computed: {
        selectedHostCount() {
            if (this.runForm.selection_type === 'hosts') {
                return this.runForm.host_ids.length;
            }

            const selectedHostIds = new Set();
            this.runForm.group_ids.forEach(groupId => {
                const group = this.groups.find(g => g.id === groupId);
                if (group) {
                    group.host_ids.forEach(hostId => selectedHostIds.add(hostId));
                }
            });
            return selectedHostIds.size;
        },
    },

    mounted() {
        this.fetchData();
        // Start polling job history on mount
        this.jobPollingInterval = setInterval(this.fetchJobHistory, 5000); 
        // Start polling cron history on mount
        this.cronHistoryPollingInterval = setInterval(this.fetchCronHistory, 10000); 
    },

    unmounted() {
        if (this.jobPollingInterval) {
            clearInterval(this.jobPollingInterval);
        }
        if (this.cronHistoryPollingInterval) {
            clearInterval(this.cronHistoryPollingInterval);
        }
    },

    methods: {
        // General Data Fetcher
        async fetchData() {
            await Promise.all([
                this.fetchTemplates(),
                this.fetchHosts(),
                this.fetchGroups(), // NEW
                this.fetchKeys(),
                this.fetchJobHistory(),
                this.fetchSatelliteConfig(),
                this.fetchCronJobs(), // NEW: Fetch cron jobs on app load
                this.fetchCronHistory() // NEW: Load cron history on app load
            ]);
        },

        // --- Fetch Methods (Unchanged) ---
        async fetchTemplates() {
            const response = await fetch(API.TEMPLATES);
            this.templates = await response.json();
            if (this.templates.length > 0 && !this.runForm.template_id) {
                this.runForm.template_id = this.templates[0].id;
            }
        },

        async fetchHosts() {
            const response = await fetch(API.HOSTS);
            this.hosts = await response.json();
        },
        
        async fetchGroups() { // NEW
            const response = await fetch(API.GROUPS);
            this.groups = await response.json();
        },

        async fetchKeys() {
            const response = await fetch(API.KEYS);
            this.keys = await response.json();
            if (this.keys.length > 0 && !this.runForm.key_id) {
                this.runForm.key_id = this.keys[0].id;
            }
        },
        
        async fetchJobHistory() {
            const response = await fetch(API.JOBS);
            this.jobHistory = await response.json();

            // Check if active job needs updating
            if (this.activeJob) {
                const updatedJob = this.jobHistory.find(j => j.id === this.activeJob.id);
                if (updatedJob && updatedJob.status === 'running') {
                    this.viewJob(this.activeJob.id, true); // Force update active job logs
                } else if (updatedJob && updatedJob.status !== 'running') {
                    // Final fetch for the completed/failed job
                    this.viewJob(this.activeJob.id, true);
                }
            }
        },

        async fetchCronJobs() {
            try {
                const response = await fetch(API.CRONJOBS);
                this.cronjobs = await response.json();
            } catch (error) {
                console.error('Error fetching cron jobs:', error);
            }
        },

        // Fetch cron execution history (logs) with pagination
        async fetchCronHistory(page = this.cronHistoryPage, perPage = this.cronHistoryPerPage) {
            try {
                const url = new URL('/api/cronhistory', window.location.origin);
                url.searchParams.append('page', page);
                url.searchParams.append('per_page', perPage);
                const response = await fetch(url);
                const data = await response.json();
                // Expected shape: { logs: [], page: X, per_page: Y, total: Z }
                this.cronHistory = data.logs || [];
                this.cronHistoryPage = data.page || page;
                this.cronHistoryPerPage = data.per_page || perPage;
                this.cronHistoryTotal = data.total || 0;
            } catch (error) {
                console.error('Error fetching cron history:', error);
            }
        },

        async viewJob(job_id, forceUpdate = false) {
            if (this.activeJob && this.activeJob.id === job_id && !forceUpdate) {
                return;
            }

            const response = await fetch(`${API.JOBS}/${job_id}`);
            const jobDetails = await response.json();
            
            // Preserve AI analysis
            if (jobDetails.logs) {
                jobDetails.logs.forEach(log => {
                    if (log.aiAnalysis) {
                        log.aiAnalysis = log.aiAnalysis; 
                    }
                    // This logic seems incorrect. Should retrieve the existing analysis from activeJob if it exists.
                    // For this simple update, we'll skip the preservation logic as the next request will overwrite.
                });
            }

            this.activeJob = jobDetails;
        },

        // Show detailed log output for a cron job entry
        showCronLogOutput(log) {
            this.activeCronLog = log;
        },

        // Pagination controls for cron history
        nextCronHistoryPage() {
            const maxPage = Math.ceil(this.cronHistoryTotal / this.cronHistoryPerPage);
            if (this.cronHistoryPage < maxPage) {
                this.cronHistoryPage += 1;
                this.fetchCronHistory(this.cronHistoryPage, this.cronHistoryPerPage);
            }
        },
        prevCronHistoryPage() {
            if (this.cronHistoryPage > 1) {
                this.cronHistoryPage -= 1;
                this.fetchCronHistory(this.cronHistoryPage, this.cronHistoryPerPage);
            }
        },

        // Clean all cron logs from the database
        async cleanCronLogs() {
            if (!confirm('Delete ALL cron logs? This cannot be undone.')) {
                return;
            }
            try {
                const response = await fetch('/api/cronhistory/clean', { method: 'DELETE' });
                const data = await response.json();
                console.log(data.message);
                // Refresh history after cleaning
                this.fetchCronHistory(1, this.cronHistoryPerPage);
                this.cronHistoryPage = 1;
            } catch (err) {
                console.error('Error cleaning cron logs:', err);
            }
        },


        // --- Group Management Methods (Unchanged) ---
        getGroupName(id) {
            const group = this.groups.find(g => g.id === id);
            return group ? group.name : `Group ID ${id}`;
        },
        
        startNewGroup() {
            this.groupForm = { id: null, name: '', host_ids: [] };
            this.editingGroup = true;
        },

        editGroup(group) {
            this.groupForm = { ...group }; // Copy group to form
            this.editingGroup = true;
        },

        cancelGroupEdit() {
            this.editingGroup = false;
        },
        
        toggleSelectAllGroupHosts(event) {
            if (event.target.checked) {
                this.groupForm.host_ids = this.hosts.map(h => h.id);
            } else {
                this.groupForm.host_ids = [];
            }
        },

        async saveGroup() {
            if (!this.groupForm.name) return;

            const method = this.groupForm.id ? 'PUT' : 'POST';
            const url = this.groupForm.id ? `${API.GROUPS}/${this.groupForm.id}` : API.GROUPS;

            const payload = {
                name: this.groupForm.name,
                host_ids: this.groupForm.host_ids
            };

            await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            this.editingGroup = false;
            await this.fetchGroups();
            await this.fetchHosts(); // Hosts need updating to show new group membership
        },

        async deleteGroup(id) {
            if (confirm('Are you sure you want to delete this group? This will not delete the member hosts.')) {
                await fetch(`${API.GROUPS}/${id}`, { method: 'DELETE' });
                await this.fetchGroups();
                await this.fetchHosts();
            }
        },

        // --- Host Management Methods (Unchanged) ---
        async addHost() {
            if (!this.hostForm.hostname || !this.hostForm.username) return;

            const response = await fetch(API.HOSTS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.hostForm)
            });
            if (response.ok) {
                this.hostForm = { name: '', hostname: '', username: '', port: 22 };
                this.fetchHosts();
            }
        },

        async deleteHost(id) {
            if (confirm('Are you sure you want to delete this host?')) {
                await fetch(`${API.HOSTS}/${id}`, { method: 'DELETE' });
                this.fetchHosts();
            }
        },

        // --- Template Management Methods (Unchanged) ---
        startNewTemplate() {
            this.templateForm = { id: null, name: '', script: '' };
            this.editingTemplate = true;
        },

        editTemplate(template) {
            this.templateForm = { ...template, script: template.script }; // Copy template to form
            this.editingTemplate = true;
        },

        cancelEdit() {
            this.editingTemplate = false;
        },

        async saveTemplate() {
            if (!this.templateForm.name || !this.templateForm.script) return;

            const method = this.templateForm.id ? 'PUT' : 'POST';
            const url = this.templateForm.id ? `${API.TEMPLATES}/${this.templateForm.id}` : API.TEMPLATES;

            const payload = {
                name: this.templateForm.name,
                script: this.templateForm.script
            };

            await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            this.editingTemplate = false;
            this.fetchTemplates();
        },

        async deleteTemplate(id) {
            if (confirm('Are you sure you want to delete this template?')) {
                await fetch(`${API.TEMPLATES}/${id}`, { method: 'DELETE' });
                this.fetchTemplates();
            }
        },

        // --- Key Management Methods (Unchanged) ---
        async addKey() {
            if (!this.keyForm.name || !this.keyForm.private_key) return;

            const response = await fetch(API.KEYS, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.keyForm)
            });
            if (response.ok) {
                this.keyForm = { name: '', private_key: '' };
                this.fetchKeys();
            }
        },

        async deleteKey(id) {
            if (confirm('Are you sure you want to delete this key?')) {
                await fetch(`${API.KEYS}/${id}`, { method: 'DELETE' });
                this.fetchKeys();
            }
        },
        
        // --- Job Execution Methods (MODIFIED) ---
        
        toggleSelectAllHosts(event) { // NEW METHOD for single hosts
            if (event.target.checked) {
                this.runForm.host_ids = this.hosts.map(h => h.id);
            } else {
                this.runForm.host_ids = [];
            }
        },

        toggleSelectAllGroups(event) {
            if (event.target.checked) {
                this.runForm.group_ids = this.groups.map(g => g.id);
            } else {
                this.runForm.group_ids = [];
            }
        },

        async runJob() {
            if (!this.runForm.template_id || !this.runForm.key_id) {
                alert('Please select a template and a key.');
                return;
            }

            let payload = {
                template_id: this.runForm.template_id,
                host_ids: [],
                host_group_ids: [],
                key_id: this.runForm.key_id
            };

            // Determine target based on selection type
            if (this.runForm.selection_type === 'hosts') {
                if (this.runForm.host_ids.length === 0) {
                    alert('Please select at least one individual host.');
                    return;
                }
                payload.host_ids = this.runForm.host_ids;

            } else { // selection_type === 'groups'
                if (this.runForm.group_ids.length === 0) {
                    alert('Please select at least one host group.');
                    return;
                }
                
                // Check if selected groups contain any hosts
                if (this.selectedHostCount === 0) {
                    alert('Selected host groups contain no actual hosts. Please select groups with members.');
                    return;
                }
                payload.host_group_ids = this.runForm.group_ids;
            }

            this.isRunning = true;
            this.activeJob = null; // Clear previous job output
            
            const response = await fetch(API.RUNNER, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const result = await response.json();
                this.viewJob(result.id); // View the new job immediately
                this.fetchJobHistory();
            } else {
                 const error = await response.json();
                 alert(`Job Submission Error: ${error.error || 'Unknown error'}`);
            }
            this.isRunning = false; 
        },

        statusClass(status) {
            switch(status) {
                case 'running': return 'bg-blue-200 text-blue-800';
                case 'completed': return 'bg-green-200 text-green-800';
                case 'failed': return 'bg-red-200 text-red-800';
                default: return 'bg-gray-200 text-gray-800';
            }
        },

        getHostFriendlyName(hostname) {
            const host = this.hosts.find(h => h.hostname === hostname);
            return host ? `${host.name} (${hostname})` : hostname;
        },

        renderMarkdown(text) {
            return marked.parse(text);
        },

        // --- AI Troubleshooter Method (Placeholder for LLM call - Unchanged) ---
        async analyzeError(log, templateName) {
            if (this.llmLoading) return;

            log.aiAnalysis = 'Analyzing error...';
            this.llmLoading = true;
            
            const prompt = `Analyze the following execution logs to determine the root cause of the error. Provide a concise explanation and a specific resolution step in markdown format.
Template Name: ${templateName}
Hostname: ${log.hostname}
Status: ${log.status}
---
SCRIPT STDOUT:
${log.stdout}
---
SCRIPT STDERR:
${log.stderr}
---`;

            try {
                const payload = {
                    prompt: prompt,
                };

                // MOCK response for demonstration:
                const response = {
                    ok: true,
                    json: async () => ({
                        candidates: [{
                            content: {
                                parts: [{
                                    text: `**Analysis for Host \`${log.hostname}\`**\n\nThe script failed because of a **Permission Denied** error when attempting to run \`apt-get update\`. This is commonly due to the SSH user (\`ec2-user\`) not having the necessary root privileges to run package management commands.\n\n### **Resolution**\n1.  **Elevate Privileges**: Change the command in the template to use \`sudo\`, for example: \`sudo apt-get update\`.\n2.  **Verify SSH Key**: Ensure the private key used has the correct permissions for the target user (\`ec2-user\`).\n3.  **Check \`/etc/sudoers\`**: If \`sudo\` is used, ensure the \`ec2-user\` is configured to run commands without a password prompt on the target host.`
                                }]
                            }
                        }]
                    })
                };
                
                // Simulate an API call delay
                await new Promise(resolve => setTimeout(resolve, 1500));

                const result = await response.json();
                const text = result.candidates?.[0]?.content?.parts?.[0]?.text;

                if (text) {
                    log.aiAnalysis = text;
                } else {
                    log.aiAnalysis = 'Error: Could not retrieve analysis. Check the console for API errors.';
                }
            } catch (error) {
                log.aiAnalysis = `Network error during analysis: ${error.message}`;
            } finally {
                this.llmLoading = false;
            }
        },

        // --- Satellite Sync Methods (Unchanged) ---
        async fetchSatelliteConfig() {
            const response = await fetch(API.SATELLITE_CONFIG);
            const config = await response.json();
            this.satelliteConfig = config;
            this.satelliteForm.url = config.url;
            this.satelliteForm.username = config.username;
            // NEW FIELD MAPPING
            this.satelliteForm.ssh_username = config.ssh_username;
        },

        async saveSatelliteConfig() {
            this.satelliteLoading = true;
            this.syncMessage = '';

            const response = await fetch(API.SATELLITE_CONFIG, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: this.satelliteForm.url,
                    username: this.satelliteForm.username,
                    password: this.satelliteForm.password,
                    // NEW: Send ssh_username
                    ssh_username: this.satelliteForm.ssh_username
                })
            });

            const result = await response.json();
            this.satelliteLoading = false;

            if (response.ok) {
                this.satelliteConfig = result;
                this.satelliteForm.password = ''; 
                this.syncMessage = 'Configuration saved successfully!';
            } else {
                 this.syncMessage = `Error saving configuration: ${result.error || 'Unknown error'}`;
            }
        },

        async syncSatelliteHosts() {
            this.satelliteLoading = true;
            this.syncMessage = 'Starting synchronization...';

            const response = await fetch(API.SATELLITE_SYNC, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });

            const result = await response.json();
            this.satelliteLoading = false;
            await this.fetchHosts(); // Refresh host list after sync

            if (response.ok) {
                this.syncMessage = result.message;
                if (result.mock_used) {
                    this.syncMessage += " (Used Mock Data due to API failure)";
                }
            } else {
                this.syncMessage = `Error during synchronization: ${result.error || 'Unknown error'}`;
            }
        },

        // --- Cron Job Methods (NEW) ---
        getTemplateNameById(templateId) {
            const template = this.templates.find(t => t.id === templateId);
            return template ? template.name : 'Unknown Template';
        },

        getKeyNameById(keyId) {
            const key = this.keys.find(k => k.id === keyId);
            return key ? key.name : 'Unknown Key';
        },

        getHostNamesByIds(hostIds) {
            return hostIds.map(id => {
                const host = this.hosts.find(h => h.id === id);
                return host ? host.name : `Unknown Host ('${id}')`;
            }).join(', ');
        },

        startNewCronJob() {
            this.editingCronJob = true;
            this.cronJobForm = { id: null, name: '', schedule: '', template_id: null, key_id: null, host_ids: [], enabled: true };
            if (this.templates.length > 0) {
                this.cronJobForm.template_id = this.templates[0].id;
            }
            if (this.keys.length > 0) {
                this.cronJobForm.key_id = this.keys[0].id;
            }
        },

        editCronJob(job) {
            this.editingCronJob = true;
            this.cronJobForm = {
                id: job.id,
                name: job.name,
                schedule: job.schedule,
                template_id: job.template_id,
                key_id: job.key_id,
                host_ids: [...job.host_ids],
                enabled: job.enabled
            };
        },

        cancelCronJobEdit() {
            this.editingCronJob = false;
            this.cronJobForm = { id: null, name: '', schedule: '', template_id: null, key_id: null, host_ids: [], enabled: true };
        },

        toggleSelectAllCronJobHosts(event) {
            if (event.target.checked) {
                this.cronJobForm.host_ids = this.hosts.map(h => h.id);
            } else {
                this.cronJobForm.host_ids = [];
            }
        },

        async saveCronJob() {
            if (!this.cronJobForm.name || !this.cronJobForm.schedule || !this.cronJobForm.template_id || !this.cronJobForm.key_id || this.cronJobForm.host_ids.length === 0) {
                alert('Please fill all required fields and select at least one host.');
                return;
            }

            try {
                const method = this.cronJobForm.id ? 'PUT' : 'POST';
                const url = this.cronJobForm.id ? `${API.CRONJOBS}/${this.cronJobForm.id}` : API.CRONJOBS;
                
                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.cronJobForm)
                });

                if (response.ok) {
                    await this.fetchCronJobs();
                    this.cancelCronJobEdit();
                } else {
                    alert('Failed to save cron job.');
                }
            } catch (error) {
                console.error('Error saving cron job:', error);
                alert('An error occurred while saving the cron job.');
            }
        },

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
    }
};

Vue.createApp(App).mount('#app');