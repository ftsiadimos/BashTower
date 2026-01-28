// Copyright (C) 2025 Fotios Tsiadimos
// SPDX-License-Identifier: GPL-3.0-only
//
// ============================================================================
// BashTower - Main Application Entry Point
// ============================================================================
// This file initializes the Vue.js application and combines all module methods.
// Each module is defined in the /static/js/modules/ directory.
// ============================================================================

// --- API Endpoints ---
const API = {
    TEMPLATES: '/api/templates',
    HOSTS: '/api/hosts',
    KEYS: '/api/keys',
    GROUPS: '/api/groups',
    JOBS: '/api/jobs',
    RUNNER: '/api/run',
    SATELLITE_CONFIG: '/api/satellite/config', 
    SATELLITE_SYNC: '/api/satellite/sync',
    CRONJOBS: '/api/cronjobs' 
};

// --- Smart Polling Configuration ---
const POLLING_CONFIG = {
    ACTIVE_INTERVAL: 5000,      // 5 seconds when page is visible
    INACTIVE_INTERVAL: 30000,   // 30 seconds when page is hidden
    CRON_ACTIVE_INTERVAL: 10000,
    CRON_INACTIVE_INTERVAL: 60000
};

// ============================================================================
// Vue Application Definition
// ============================================================================
const App = {
    // Use custom delimiters to avoid conflict with Jinja2 server-side templating
    delimiters: ['[[', ']]'],
    
    // ========================================================================
    // Application State
    // ========================================================================
    data() {
        return {
            // --- Navigation ---
            currentView: 'dashboard',
            
            // --- Data Loading State ---
            dataLoaded: {
                templates: false,
                hosts: false,
                groups: false,
                keys: false,
                jobs: false,
                satellite: false,
                cronjobs: false,
                cronHistory: false,
                settings: false
            },
            
            // --- Page Visibility ---
            isPageVisible: true,
            
            // --- Template Management (moved to module)
            ...TemplatesData(),

            // --- Host Management (moved to module)
            ...HostsData(),

            // --- Key Management (moved to module)
            ...KeysData(),

            // --- Group Management (moved to module)
            ...GroupsData(),

            // --- Job Runner ---
            isRunning: false,
            launchPending: false, // true while creating a job on the server
            lastLaunchedJobId: null, // ID of the most recently launched job
            jobHistory: [],
            activeJob: null,
            jobPollingInterval: null,
            hostSearchQuery: '',
            runForm: {
                template_id: null,
                selection_type: 'groups',
                host_ids: [],
                group_ids: [],
                key_id: null,
                arguments: {}
            },

            // --- AI Troubleshooter ---
            llmLoading: false,

            // --- AI Script Assistant (moved to Templates module)

            // --- Satellite Sync ---
            satelliteConfig: { url: '', username: '', ssh_username: 'ec2-user' },
            satelliteForm: { url: '', username: '', password: '', ssh_username: 'ec2-user' }, 
            satelliteLoading: false,
            syncMessage: '',

            // --- Cron Jobs ---
            cronjobs: [],
            editingCronJob: false,
            cronJobSearchQuery: '',
            cronHostSearchQuery: '',
            cronGroupSearchQuery: '',
            cronTemplateSearchQuery: '',
            cronTemplateDropdownOpen: false,
            cronJobForm: { 
                id: null, 
                name: '', 
                schedule: '', 
                template_id: null, 
                key_id: null, 
                host_ids: [], 
                group_ids: [], 
                selection_type: 'groups', 
                enabled: true 
            },

            // --- Cron History ---
            cronHistory: [],
            cronHistoryPage: 1,
            cronHistoryPerPage: 10,
            cronHistoryTotal: 0,
            cronHistoryPollingInterval: null,
            activeCronLog: null,
            cronHistorySearchQuery: '',
            viewingAllOutputs: false,
            cronHistoryLoading: false,
            allOutputsData: [],
            allOutputsFilterCronJob: '',
            allOutputsFilterTimeRange: 'all',
            allOutputsFilterStatus: '',
            allOutputsLimit: '100',

            // --- Settings ---
            settingsForm: {
                ai_provider: 'openai',
                ai_api_key: '',
                ai_model: 'gpt-3.5-turbo',
                ai_endpoint: '',
                cron_history_limit: 0,
                auth_disabled: false
            },
            settingsSaving: false,
            settingsMessage: '',
            ollamaModels: [],
            ollamaModelsLoading: false,
            ollamaModelsError: '',
            cronHistoryCount: 0,
            showDeleteCronHistoryModal: false,
            deletingCronHistory: false,

            // --- Authentication ---
            currentUser: null,
            authDisabled: false,

            // --- User Management (moved to module)
            ...UsersData(),

            // --- Job Sorting ---
            jobSortStatus: 'all', // 'all', 'success', 'error', 'running'
            logSortStatus: 'all' // 'all', 'success', 'error', 'running'
        };
    },
    
    // ========================================================================
    // Computed Properties
    // ========================================================================
    computed: {
        // Calculate selected hosts from groups or direct host selection (Dashboard)
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

        // Calculate selected hosts for cron job form
        cronJobSelectedHostCount() {
            if (this.cronJobForm.selection_type === 'hosts') {
                return this.cronJobForm.host_ids.length;
            }

            const selectedHostIds = new Set();
            this.cronJobForm.group_ids.forEach(groupId => {
                const group = this.groups.find(g => g.id === groupId);
                if (group) {
                    group.host_ids.forEach(hostId => selectedHostIds.add(hostId));
                }
            });
            return selectedHostIds.size;
        },

        // Host computed properties (moved to module)
        ...HostsComputed,

        // Group computed properties (moved to module)
        ...GroupsComputed,

        // Template computed properties (moved to module)
        ...TemplatesComputed,

        // Filter cron jobs based on search query
        filteredCronJobs() {
            if (!this.cronJobSearchQuery.trim()) {
                return this.cronjobs;
            }
            const query = this.cronJobSearchQuery.toLowerCase();
            return this.cronjobs.filter(c => 
                c.name.toLowerCase().includes(query) || 
                c.schedule.toLowerCase().includes(query)
            );
        },



        // Filter hosts for cron job form
        filteredCronHosts() {
            if (!this.cronHostSearchQuery.trim()) {
                return this.hosts;
            }
            const query = this.cronHostSearchQuery.toLowerCase();
            return this.hosts.filter(h => 
                h.name.toLowerCase().includes(query) || 
                h.hostname.toLowerCase().includes(query)
            );
        },

        // Filter groups for cron job form
        filteredCronGroups() {
            if (!this.cronGroupSearchQuery.trim()) {
                return this.groups;
            }
            const query = this.cronGroupSearchQuery.toLowerCase();
            return this.groups.filter(g => g.name.toLowerCase().includes(query));
        },

        // Filter templates for cron job form
        filteredCronTemplates() {
            if (!this.cronTemplateSearchQuery.trim()) {
                return this.templates;
            }
            const query = this.cronTemplateSearchQuery.toLowerCase();
            return this.templates.filter(t => t.name.toLowerCase().includes(query));
        },

        // Get unique cron job names from current history
        uniqueCronJobNames() {
            const names = new Set();
            this.allOutputsData.forEach(log => {
                if (log.cron_job_name) {
                    names.add(log.cron_job_name);
                }
            });
            return Array.from(names).sort();
        },

        // Calculate visible page numbers for pagination
        cronHistoryVisiblePages() {
            const total = Math.ceil(this.cronHistoryTotal / this.cronHistoryPerPage);
            const current = this.cronHistoryPage;
            const pages = [];
            
            if (total <= 7) {
                // Show all pages if 7 or fewer
                for (let i = 1; i <= total; i++) {
                    pages.push(i);
                }
            } else {
                // Always show first page
                pages.push(1);
                
                if (current <= 3) {
                    // Near start: 1 2 3 4 5 ... last
                    for (let i = 2; i <= 5; i++) {
                        pages.push(i);
                    }
                    pages.push('...');
                    pages.push(total);
                } else if (current >= total - 2) {
                    // Near end: 1 ... n-4 n-3 n-2 n-1 n
                    pages.push('...');
                    for (let i = total - 4; i <= total; i++) {
                        pages.push(i);
                    }
                } else {
                    // Middle: 1 ... current-1 current current+1 ... last
                    pages.push('...');
                    pages.push(current - 1);
                    pages.push(current);
                    pages.push(current + 1);
                    pages.push('...');
                    pages.push(total);
                }
            }
            
            return pages;
        },

        // Filter all outputs based on selected filters
        filteredAllOutputs() {
            let filtered = this.allOutputsData;

            // Filter by cron job
            if (this.allOutputsFilterCronJob) {
                filtered = filtered.filter(log => log.cron_job_name === this.allOutputsFilterCronJob);
            }

            // Filter by status
            if (this.allOutputsFilterStatus) {
                filtered = filtered.filter(log => log.status === this.allOutputsFilterStatus);
            }

            // Filter by time range
            if (this.allOutputsFilterTimeRange && this.allOutputsFilterTimeRange !== 'all') {
                const now = new Date();
                const timeRanges = {
                    '10m': 10 * 60 * 1000,
                    '30m': 30 * 60 * 1000,
                    '1h': 60 * 60 * 1000,
                    '3h': 3 * 60 * 60 * 1000,
                    '6h': 6 * 60 * 60 * 1000,
                    '12h': 12 * 60 * 60 * 1000,
                    '24h': 24 * 60 * 60 * 1000
                };
                const timeRange = timeRanges[this.allOutputsFilterTimeRange];
                if (timeRange) {
                    const timeLimit = new Date(now.getTime() - timeRange);
                    filtered = filtered.filter(log => {
                        // Parse timestamp as UTC by appending 'Z' if not present
                        let timestamp = log.created_at;
                        if (timestamp && !timestamp.endsWith('Z') && !timestamp.includes('+')) {
                            timestamp = timestamp + 'Z';
                        }
                        const logTime = new Date(timestamp);
                        return logTime >= timeLimit;
                    });
                }
            }

            // Apply limit
            const limit = parseInt(this.allOutputsLimit);
            if (!isNaN(limit) && limit > 0) {
                filtered = filtered.slice(0, limit);
            }

            return filtered;
        },

        // Key computed properties (moved to module)
        ...KeysComputed,

        // User computed properties (moved to module)
        ...usersComputed,

        // Sorted job history based on status
        sortedJobHistory() {
            if (this.jobSortStatus === 'all') return this.jobHistory;
            if (this.jobSortStatus === 'success') {
                return this.jobHistory.filter(j => ['success', 'complete', 'completed'].includes(j.status));
            }
            if (this.jobSortStatus === 'error') {
                return this.jobHistory.filter(j => ['error', 'failed'].includes(j.status));
            }
            if (this.jobSortStatus === 'running') {
                return this.jobHistory.filter(j => j.status === 'running');
            }
            return this.jobHistory;
        },

        // Sort and filter active job logs
        sortedActiveJobLogs() {
            if (!this.activeJob || !this.activeJob.logs) return [];
            let logs = this.activeJob.logs.slice();
            // Sort alphabetically by hostname only
            logs.sort((a, b) => a.hostname.localeCompare(b.hostname));
            if (this.logSortStatus === 'all') return logs;
            if (this.logSortStatus === 'success') {
                return logs.filter(l => ['success', 'complete', 'completed'].includes(l.status));
            }
            if (this.logSortStatus === 'error') {
                return logs.filter(l => ['error', 'failed', 'connection_failed'].includes(l.status));
            }
            if (this.logSortStatus === 'running') {
                return logs.filter(l => l.status === 'running');
            }
            return logs;
        },

        // Whether the most recently launched job is still running
        lastLaunchedJobRunning() {
            if (!this.lastLaunchedJobId) return false;
            const jobInHistory = this.jobHistory.find(j => j.id === this.lastLaunchedJobId);
            if (jobInHistory) return jobInHistory.status === 'running' || jobInHistory.status === 'started';
            if (this.activeJob && this.activeJob.id === this.lastLaunchedJobId) return this.activeJob.status === 'running' || this.activeJob.status === 'started';
            return false;
        },
    },

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================
    mounted() {
        // Fetch current user info
        this.checkAuth();
        
        // Load essential data for dashboard
        this.loadViewData('dashboard');
        
        // Setup smart polling with Page Visibility API
        this.setupSmartPolling();

        // Global keydown handler (Escape to close dropdown)
        this.handleGlobalKeydown = (event) => {
            if (event.key === 'Escape' && this.templateDropdownOpen) {
                this.closeTemplateDropdown();
            }
            if (event.key === 'Escape' && this.cronTemplateDropdownOpen) {
                this.cronTemplateDropdownOpen = false;
                this.cronTemplateSearchQuery = '';
            }
        };
        document.addEventListener('keydown', this.handleGlobalKeydown);
        
        // Watch for view changes to lazy load data and close dropdown
        this.$watch('currentView', (newView) => {
            this.loadViewData(newView);
            // Close the template dropdown when switching views
            if (this.templateDropdownOpen) this.closeTemplateDropdown();
            if (this.cronTemplateDropdownOpen) {
                this.cronTemplateDropdownOpen = false;
                this.cronTemplateSearchQuery = '';
            }
        });

        // Watch job history to clear lastLaunchedJobId when it completes
        this.$watch('jobHistory', (newHistory) => {
            if (!this.lastLaunchedJobId) return;
            const job = newHistory.find(j => j.id === this.lastLaunchedJobId);
            if (job && job.status && job.status !== 'running' && job.status !== 'started') {
                // Job finished, clear tracking id
                this.lastLaunchedJobId = null;
            }
        }, { deep: true });

        // Also watch the activeJob detail view for completion
        this.$watch('activeJob', (newJob) => {
            if (!this.lastLaunchedJobId || !newJob) return;
            if (newJob.id === this.lastLaunchedJobId && newJob.status && newJob.status !== 'running' && newJob.status !== 'started') {
                this.lastLaunchedJobId = null;
            }
        }, { deep: true });
    },

    unmounted() {
        this.cleanupPolling();
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        // Remove global keydown handler
        document.removeEventListener('keydown', this.handleGlobalKeydown);
    },

    // ========================================================================
    // Methods - Combined from all modules
    // ========================================================================
    methods: {
        // --------------------------------------------------------------------
        // Smart Polling Setup
        // --------------------------------------------------------------------
        setupSmartPolling() {
            // Setup visibility change handler
            this.handleVisibilityChange = () => {
                this.isPageVisible = !document.hidden;
                this.updatePollingIntervals();
                // Close template dropdown when switching browser tabs (page hidden)
                if (document.hidden && this.templateDropdownOpen) {
                    this.closeTemplateDropdown();
                }
                if (document.hidden && this.cronTemplateDropdownOpen) {
                    this.cronTemplateDropdownOpen = false;
                    this.cronTemplateSearchQuery = '';
                }
            };
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
            
            // Start polling with smart intervals
            this.startPolling();
        },
        
        startPolling() {
            const jobInterval = this.isPageVisible 
                ? POLLING_CONFIG.ACTIVE_INTERVAL 
                : POLLING_CONFIG.INACTIVE_INTERVAL;
            const cronInterval = this.isPageVisible 
                ? POLLING_CONFIG.CRON_ACTIVE_INTERVAL 
                : POLLING_CONFIG.CRON_INACTIVE_INTERVAL;
            
            this.jobPollingInterval = setInterval(() => {
                if (this.dataLoaded.jobs) this.fetchJobHistory();
            }, jobInterval);
            
            this.cronHistoryPollingInterval = setInterval(() => {
                if (this.dataLoaded.cronHistory) this.fetchCronHistory();
            }, cronInterval);
        },
        
        updatePollingIntervals() {
            // Clear existing intervals and restart with new timing
            this.cleanupPolling();
            this.startPolling();
        },
        
        cleanupPolling() {
            if (this.jobPollingInterval) {
                clearInterval(this.jobPollingInterval);
                this.jobPollingInterval = null;
            }
            if (this.cronHistoryPollingInterval) {
                clearInterval(this.cronHistoryPollingInterval);
                this.cronHistoryPollingInterval = null;
            }
        },
        
        // --------------------------------------------------------------------
        // Lazy Data Loading by View
        // --------------------------------------------------------------------
        async loadViewData(view) {
            switch(view) {
                case 'dashboard':
                    // Dashboard needs templates, groups, keys, hosts, and job history
                    await Promise.all([
                        this.ensureLoaded('templates', this.fetchTemplates),
                        this.ensureLoaded('groups', this.fetchGroups),
                        this.ensureLoaded('keys', this.fetchKeys),
                        this.ensureLoaded('hosts', this.fetchHosts),
                        this.ensureLoaded('jobs', this.fetchJobHistory),
                        this.ensureLoaded('settings', this.fetchSettings)
                    ]);
                    break;
                case 'templates':
                    await this.ensureLoaded('templates', this.fetchTemplates);
                    break;
                case 'hosts':
                    await Promise.all([
                        this.ensureLoaded('hosts', this.fetchHosts),
                        this.ensureLoaded('groups', this.fetchGroups)
                    ]);
                    break;
                case 'groups':
                    await Promise.all([
                        this.ensureLoaded('groups', this.fetchGroups),
                        this.ensureLoaded('hosts', this.fetchHosts)
                    ]);
                    break;
                case 'keys':
                    await this.ensureLoaded('keys', this.fetchKeys);
                    break;
                case 'cronjobs':
                    await Promise.all([
                        this.ensureLoaded('cronjobs', this.fetchCronJobs),
                        this.ensureLoaded('templates', this.fetchTemplates),
                        this.ensureLoaded('keys', this.fetchKeys),
                        this.ensureLoaded('groups', this.fetchGroups),
                        this.ensureLoaded('hosts', this.fetchHosts)
                    ]);
                    break;
                case 'cronHistory':
                    await this.ensureLoaded('cronHistory', this.fetchCronHistory);
                    break;
                case 'satellite':
                    await this.ensureLoaded('satellite', this.fetchSatelliteConfig);
                    break;
                case 'settings':
                    await this.ensureLoaded('settings', this.fetchSettings);
                    break;
                case 'users':
                    await this.fetchUsers();
                    break;
            }
        },
        
        async ensureLoaded(key, fetchFn) {
            if (!this.dataLoaded[key]) {
                await fetchFn.call(this);
                this.dataLoaded[key] = true;
            }
        },

        // --------------------------------------------------------------------
        // General Data Fetcher (kept for manual refresh if needed)
        // --------------------------------------------------------------------
        async fetchData() {
            // Reset loaded flags to force refresh
            Object.keys(this.dataLoaded).forEach(key => this.dataLoaded[key] = false);
            await this.loadViewData(this.currentView);
        },

        // Force refresh current view data
        async refreshCurrentView() {
            const viewKeys = {
                'dashboard': ['templates', 'groups', 'keys', 'hosts', 'jobs', 'settings'],
                'templates': ['templates'],
                'hosts': ['hosts', 'groups'],
                'groups': ['groups', 'hosts'],
                'keys': ['keys'],
                'cronjobs': ['cronjobs', 'templates', 'keys', 'groups', 'hosts'],
                'cronHistory': ['cronHistory'],
                'satellite': ['satellite'],
                'settings': ['settings']
            };
            const keysToRefresh = viewKeys[this.currentView] || [];
            keysToRefresh.forEach(key => this.dataLoaded[key] = false);
            await this.loadViewData(this.currentView);
        },

        // --------------------------------------------------------------------
        // Template Methods (from modules/templates.js)
        // --------------------------------------------------------------------
        ...TemplatesMethods,

        // --------------------------------------------------------------------
        // Host Methods (from modules/hosts.js)
        // --------------------------------------------------------------------
        ...HostsMethods,

        // --------------------------------------------------------------------
        // Group Methods (from modules/groups.js)
        // --------------------------------------------------------------------
        ...GroupsMethods,

        // --------------------------------------------------------------------
        // Key Methods (from modules/keys.js)
        // --------------------------------------------------------------------
        ...KeysMethods,

        // --------------------------------------------------------------------
        // Job Methods (from modules/jobs.js)
        // --------------------------------------------------------------------
        ...JobsMethods,

        // --------------------------------------------------------------------
        // Satellite Methods (from modules/satellite.js)
        // --------------------------------------------------------------------
        ...SatelliteMethods,

        // --------------------------------------------------------------------
        // Cron Job Methods (from modules/cronjobs.js)
        // --------------------------------------------------------------------
        ...CronJobsMethods,

        // --------------------------------------------------------------------
        // Cron History Methods (from modules/cronhistory.js)
        // --------------------------------------------------------------------
        ...CronHistoryMethods,

        // --------------------------------------------------------------------
        // Dashboard Methods (from modules/dashboard.js)
        // --------------------------------------------------------------------
        ...DashboardMethods,

        // --------------------------------------------------------------------
        // Settings Methods (from modules/settings.js)
        // --------------------------------------------------------------------
        ...SettingsMethods,

        // --------------------------------------------------------------------
        // User Management Methods (from modules/users.js)
        // --------------------------------------------------------------------
        ...usersMethods,

        // --------------------------------------------------------------------
        // Authentication Methods
        // --------------------------------------------------------------------
        async checkAuth() {
            try {
                const response = await fetch('/api/auth/check', { credentials: 'same-origin' });
                if (response.ok) {
                    const data = await response.json();
                    this.currentUser = data.user;
                    this.authDisabled = data.auth_disabled || false;
                } else {
                    // Check if auth is disabled before redirecting
                    const settingsResp = await fetch('/api/settings');
                    if (settingsResp.ok) {
                        const settings = await settingsResp.json();
                        this.authDisabled = settings.auth_disabled || false;
                        if (this.authDisabled) {
                            // Auth is disabled, no need to redirect
                            return;
                        }
                    }
                    window.location.href = '/login';
                }
            } catch (error) {
                console.error('Auth check failed:', error);
            }
        },

        async logout() {
            // Don't logout if auth is disabled
            if (this.authDisabled) {
                return;
            }
            try {
                const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
                if (response.ok) {
                    window.location.href = '/login';
                }
            } catch (error) {
                console.error('Logout failed:', error);
            }
        },

        formatDate(dateStr) {
            if (!dateStr) return 'N/A';
            return new Date(dateStr).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        },

        showToast(message, type = 'info') {
            // Simple toast notification (you can enhance this)
            console.log(`[${type.toUpperCase()}] ${message}`);
            // For a basic implementation, use alert
            if (type === 'error') {
                alert(message);
            }
        },

        getTemplateById(templateId) {
            return this.templates.find(t => t.id === templateId) || null;
        },

        ansiToHtml(text) {
            if (!text) return '';
            // Basic ANSI color code to HTML span conversion
            return text
                .replace(/\u001b\[0m/g, '</span>')
                .replace(/\u001b\[32m/g, '<span style="color:#22c55e">') // green
                .replace(/\u001b\[31m/g, '<span style="color:#ef4444">') // red
                .replace(/\u001b\[33m/g, '<span style="color:#eab308">') // yellow
                .replace(/\u001b\[34m/g, '<span style="color:#3b82f6">') // blue
                .replace(/\u001b\[35m/g, '<span style="color:#a21caf">') // magenta
                .replace(/\u001b\[36m/g, '<span style="color:#06b6d4">') // cyan
                .replace(/\u001b\[1m/g, '<span style="font-weight:bold">') // bold
                .replace(/\u001b\[.*?m/g, ''); // remove any other ansi
        },

        stripAnsi(text) {
            if (!text) return '';
            return text.replace(/\u001b\[[0-9;]*m/g, '');
        },
    }
};

// ============================================================================
// Initialize Vue Application
// ============================================================================
Vue.createApp(App).mount('#app');
