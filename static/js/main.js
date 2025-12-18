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
            
            // --- Template Management ---
            templates: [],
            editingTemplate: false,
            templateForm: { id: null, name: '', script: '', script_type: 'bash' },
            templateSearchQuery: '',

            // --- Host Management ---
            hosts: [],
            hostForm: { id: null, name: '', hostname: '', username: '', port: 22 },
            hostPageSearchQuery: '',
            showHostModal: false,
            editingHost: null,

            // --- Key Management ---
            keys: [],
            keyForm: { name: '', private_key: '' },
            showKeyModal: false,
            keySearchQuery: '',

            // --- Group Management ---
            groups: [],
            editingGroup: false,
            groupForm: { id: null, name: '', host_ids: [] },
            groupSearchQuery: '',
            groupPageSearchQuery: '',

            // --- Job Runner ---
            isRunning: false,
            jobHistory: [],
            activeJob: null,
            jobPollingInterval: null,
            hostSearchQuery: '',
            templateDropdownOpen: false,
            runForm: {
                template_id: null,
                selection_type: 'groups',
                host_ids: [],
                group_ids: [],
                key_id: null
            },

            // --- AI Troubleshooter ---
            llmLoading: false,

            // --- AI Script Assistant ---
            scriptAIPrompt: '',
            scriptAIResponse: '',
            scriptAILoading: false,

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

            // --- Settings ---
            settingsForm: {
                ai_provider: 'openai',
                ai_api_key: '',
                ai_model: 'gpt-3.5-turbo',
                ai_endpoint: '',
                cron_history_limit: 0
            },
            aiConfigured: false,
            settingsSaving: false,
            settingsMessage: '',
            ollamaModels: [],
            ollamaModelsLoading: false,
            ollamaModelsError: '',
            cronHistoryCount: 0,
            showDeleteCronHistoryModal: false,
            deletingCronHistory: false,

            // --- User Management ---
            currentUser: null,
            users: [],
            userSearch: '',
            showUserModal: false,
            showDeleteModal: false,
            editingUser: null,
            userToDelete: null,
            userFormLoading: false,
            showModalPassword: false,
            userForm: {
                username: '',
                email: '',
                password: '',
                is_admin: false
            }
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

        // Filter hosts based on search query
        filteredHosts() {
            if (!this.hostSearchQuery.trim()) {
                return this.hosts;
            }
            const query = this.hostSearchQuery.toLowerCase();
            return this.hosts.filter(h => 
                h.name.toLowerCase().includes(query) || 
                h.hostname.toLowerCase().includes(query)
            );
        },

        // Filter groups based on search query
        filteredGroups() {
            if (!this.groupSearchQuery.trim()) {
                return this.groups;
            }
            const query = this.groupSearchQuery.toLowerCase();
            return this.groups.filter(g => g.name.toLowerCase().includes(query));
        },

        // Filter templates based on search query
        filteredTemplates() {
            if (!this.templateSearchQuery.trim()) {
                return this.templates;
            }
            const query = this.templateSearchQuery.toLowerCase();
            return this.templates.filter(t => t.name.toLowerCase().includes(query));
        },

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

        // Filter hosts for hosts page (separate from dashboard filter)
        filteredHostsPage() {
            if (!this.hostPageSearchQuery.trim()) {
                return this.hosts;
            }
            const query = this.hostPageSearchQuery.toLowerCase();
            return this.hosts.filter(h => 
                h.name.toLowerCase().includes(query) || 
                h.hostname.toLowerCase().includes(query) ||
                h.username.toLowerCase().includes(query)
            );
        },

        // Filter groups for groups page (separate from dashboard filter)
        filteredGroupsPage() {
            if (!this.groupPageSearchQuery.trim()) {
                return this.groups;
            }
            const query = this.groupPageSearchQuery.toLowerCase();
            return this.groups.filter(g => g.name.toLowerCase().includes(query));
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

        // Filter keys based on search query
        filteredKeys() {
            if (!this.keySearchQuery || !this.keySearchQuery.trim()) {
                return this.keys;
            }
            const query = this.keySearchQuery.toLowerCase();
            return this.keys.filter(k => k.name.toLowerCase().includes(query));
        },

        // Filter users based on search query
        filteredUsers() {
            if (!this.userSearch) return this.users;
            const search = this.userSearch.toLowerCase();
            return this.users.filter(u => 
                u.username.toLowerCase().includes(search) ||
                (u.email && u.email.toLowerCase().includes(search))
            );
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
        
        // Watch for view changes to lazy load data
        this.$watch('currentView', (newView) => {
            this.loadViewData(newView);
        });
    },

    unmounted() {
        this.cleanupPolling();
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
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
                const response = await fetch('/api/auth/check');
                if (response.ok) {
                    const data = await response.json();
                    this.currentUser = data.user;
                } else {
                    window.location.href = '/login';
                }
            } catch (error) {
                console.error('Auth check failed:', error);
            }
        },

        async logout() {
            try {
                const response = await fetch('/api/auth/logout', { method: 'POST' });
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
        }
    }
};

// ============================================================================
// Initialize Vue Application
// ============================================================================
Vue.createApp(App).mount('#app');
