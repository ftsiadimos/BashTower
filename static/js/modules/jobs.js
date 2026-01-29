// Copyright (C) 2025 Fotios Tsiadimos
// SPDX-License-Identifier: GPL-3.0-only
//
// Job Management Module
// Methods for job execution and history

const JobsMethods = {
    // Fetch job history from API
    async fetchJobHistory() {
        const response = await fetch(API.JOBS);
        this.jobHistory = await response.json();

        // Check if active job needs updating
        if (this.activeJob) {
            const updatedJob = this.jobHistory.find(j => j.id === this.activeJob.id);
            if (updatedJob && updatedJob.status === 'running') {
                this.viewJob(this.activeJob.id, true);
            } else if (updatedJob && updatedJob.status !== 'running') {
                this.viewJob(this.activeJob.id, true);
            }
        }
    },

    // View job details
    async viewJob(job_id, forceUpdate = false) {
        if (this.activeJob && this.activeJob.id === job_id && !forceUpdate) {
            return;
        }

        const response = await fetch(`${API.JOBS}/${job_id}`);
        const jobDetails = await response.json();
        
        // Preserve AI analysis and commands from existing activeJob logs
        if (this.activeJob && this.activeJob.id === job_id && this.activeJob.logs && jobDetails.logs) {
            jobDetails.logs.forEach(newLog => {
                const existingLog = this.activeJob.logs.find(l => l.hostname === newLog.hostname);
                if (existingLog) {
                    if (existingLog.aiAnalysis) {
                        newLog.aiAnalysis = existingLog.aiAnalysis;
                    }
                    if (existingLog.aiCommands) {
                        newLog.aiCommands = existingLog.aiCommands;
                    }
                }
            });
        }

        this.activeJob = jobDetails;

        // Detect unreachable hosts (DNS errors) and prompt user to remove them
        try {
            this.detectUnreachableHosts(jobDetails.logs || []);
        } catch (e) { console.warn('Failed to check unreachable hosts:', e); }
    },

    // Detect logs that indicate DNS/name resolution failures and offer to remove the host
    async detectUnreachableHosts(logs) {
        if (!logs || !this.hosts) return;
        // Avoid prompting repeatedly for same host during the same app session
        if (!this._unreachablePrompted) this._unreachablePrompted = new Set();

        for (const log of logs) {
            if (!log || !log.stderr || log.status !== 'connection_failed') continue;
            const stderr = (log.stderr || '').toLowerCase();
            // Look for common DNS/gaierror phrases
            const isDnsError = stderr.includes('name or service not known') || stderr.includes('gaierror') || stderr.includes('dns resolution failed') || stderr.includes('temporary failure in name resolution');
            if (!isDnsError) continue;

            const hostname = log.hostname;
            if (this._unreachablePrompted.has(hostname)) continue;
            this._unreachablePrompted.add(hostname);

            // Ask the user whether to remove the host
            const confirmMsg = `Host ${hostname} appears unreachable (DNS error). Would you like to remove this host from your inventory?`;
            if (!confirm(confirmMsg)) continue;

            // Find host entry by hostname
            const hostObj = this.hosts.find(h => h.hostname === hostname || h.name === hostname);
            if (!hostObj) {
                alert(`Could not find host ${hostname} in inventory to remove.`);
                continue;
            }

            try {
                const resp = await fetch(`${API.HOSTS}/${hostObj.id}`, { method: 'DELETE' });
                if (resp.ok) {
                    // Refresh hosts list and show confirmation
                    await this.fetchHosts();
                    alert(`Host ${hostname} removed.`);
                } else {
                    const err = await resp.json();
                    alert(`Failed to remove host: ${err.message || err.error || 'Unknown error'}`);
                }
            } catch (err) {
                alert(`Network error removing host: ${err.message}`);
            }
        }
    },

    // Toggle select all hosts for job run
    toggleSelectAllHosts(event) {
        if (event.target.checked) {
            this.runForm.host_ids = this.hosts.map(h => h.id);
        } else {
            this.runForm.host_ids = [];
        }
    },

    // Toggle select all groups for job run
    toggleSelectAllGroups(event) {
        if (event.target.checked) {
            this.runForm.group_ids = this.groups.map(g => g.id);
        } else {
            this.runForm.group_ids = [];
        }
    },

    // Run a job
    async runJob() {
        if (!this.runForm.template_id || !this.runForm.key_id) {
            alert('Please select a template and a key.');
            return;
        }

        let payload = {
            template_id: this.runForm.template_id,
            host_ids: [],
            host_group_ids: [],
            key_id: this.runForm.key_id,
            arguments: this.runForm.arguments || {}
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

        // Mark that we are creating a job and clear previous active job
        this.launchPending = true;
        this.activeJob = null;

        try {
            const response = await fetch(API.RUNNER, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const result = await response.json();
                // Record the launched job ID and fetch its details/history
                this.lastLaunchedJobId = result.id;
                this.viewJob(result.id);
                this.fetchJobHistory();
            } else {
                const error = await response.json();
                alert(`Job Submission Error: ${error.error || 'Unknown error'}`);
            }
        } catch (err) {
            alert(`Network error: ${err.message}`);
        } finally {
            this.launchPending = false;
        } 
    },

    // Get status CSS class
    statusClass(status) {
        switch(status) {
            case 'running': return 'bg-blue-200 text-blue-800';
            case 'completed': return 'bg-green-200 text-green-800';
            case 'failed': return 'bg-red-200 text-red-800';
            default: return 'bg-gray-200 text-gray-800';
        }
    },

    // AI Troubleshooter Method
    async analyzeError(log, templateName) {
        if (this.llmLoading) return;

        // Check if AI is configured
        if (!this.aiConfigured) {
            alert('AI is not configured. Please go to Settings and configure your AI provider.');
            return;
        }

        // Use Vue.set equivalent for reactivity - find log index and update
        const logIndex = this.activeJob.logs.findIndex(l => l.hostname === log.hostname);
        if (logIndex === -1) return;
        
        // Store reference to the log and open modal
        this.activeTroubleshootLog = {
            ...log,
            templateName: templateName,
            aiAnalysis: 'Analyzing error...',
            aiCommands: null
        };
        this.viewingTroubleshoot = true;
        this.llmLoading = true;
        
        const prompt = `Analyze the following execution logs to determine the root cause of the error. Provide a concise explanation and a specific resolution step in markdown format. If appropriate, include example commands in fenced code blocks or under a 'Recommended commands' heading.\nTemplate Name: ${templateName}\nHostname: ${log.hostname}\nStatus: ${log.status}\n---\nSCRIPT STDOUT:\n${log.stdout || '(empty)'}\n---\nSCRIPT STDERR:\n${log.stderr || '(empty)'}\n---`;

        try {
            const response = await fetch('/api/ai/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: prompt })
            });

            const result = await response.json();

            if (response.ok && result.analysis) {
                // Keep the full analysis text without extracting commands
                const analysis = (result.analysis || '').trim() || 'No analysis summary available.';
                
                this.activeTroubleshootLog.aiAnalysis = analysis;
                this.activeTroubleshootLog.aiCommands = null;
            } else {
                const errorMsg = `Error: ${result.message || result.error || 'Could not retrieve analysis.'}`;
                this.activeTroubleshootLog.aiAnalysis = errorMsg;
            }
        } catch (error) {
            const errorMsg = `Network error during analysis: ${error.message}`;
            this.activeTroubleshootLog.aiAnalysis = errorMsg;
        } finally {
            this.llmLoading = false;
        }
    },

    // Open a modal to view the full stdout/stderr for a single log
    viewLogOutput(log) {
        this.activeLogOutput = { ...log };
        this.viewingLogOutput = true;
    }
};
