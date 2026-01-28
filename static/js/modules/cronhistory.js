// Copyright (C) 2025 Fotios Tsiadimos
// SPDX-License-Identifier: GPL-3.0-only
//
// Cron History Module
// Methods for viewing cron job execution history

const CronHistoryMethods = {
    // Fetch cron execution history with pagination and search
    async fetchCronHistory(page = this.cronHistoryPage, perPage = this.cronHistoryPerPage, search = this.cronHistorySearchQuery) {
        this.cronHistoryLoading = true;
        try {
            const url = new URL('/api/cronhistory', window.location.origin);
            url.searchParams.append('page', page);
            url.searchParams.append('per_page', perPage);
            if (search && search.trim()) {
                url.searchParams.append('search', search.trim());
            }
            const response = await fetch(url);
            const data = await response.json();
            // Expected shape: { logs: [], page: X, per_page: Y, total: Z }
            this.cronHistory = data.logs || [];
            this.cronHistoryPage = data.page || page;
            this.cronHistoryPerPage = data.per_page || perPage;
            this.cronHistoryTotal = data.total || 0;
            if (typeof this.showToast === 'function') {
                this.showToast('Cron history refreshed!', 'success');
            }
        } catch (error) {
            console.error('Error fetching cron history:', error);
            if (typeof this.showToast === 'function') {
                this.showToast('Failed to refresh cron history.', 'error');
            }
        } finally {
            this.cronHistoryLoading = false;
        }
    },

    // Toggle auto-refresh for cron history
    toggleCronHistoryAutoRefresh() {
        this.cronHistoryAutoRefresh = !this.cronHistoryAutoRefresh;
        if (this.cronHistoryAutoRefresh) {
            this.startCronHistoryAutoRefresh();
        } else {
            this.stopCronHistoryAutoRefresh();
        }
    },

    // Start auto-refresh interval
    startCronHistoryAutoRefresh() {
        // Clear any existing interval first
        this.stopCronHistoryAutoRefresh();
        // Refresh every 5 seconds
        this.cronHistoryAutoRefreshInterval = setInterval(() => {
            this.fetchCronHistory();
        }, 5000);
    },

    // Stop auto-refresh interval
    stopCronHistoryAutoRefresh() {
        if (this.cronHistoryAutoRefreshInterval) {
            clearInterval(this.cronHistoryAutoRefreshInterval);
            this.cronHistoryAutoRefreshInterval = null;
        }
    },

    // Search cron history (reset to page 1)
    searchCronHistory() {
        this.cronHistoryPage = 1;
        this.fetchCronHistory(1, this.cronHistoryPerPage, this.cronHistorySearchQuery);
    },

    // Change per page and refresh immediately
    changeCronHistoryPerPage() {
        this.cronHistoryPage = 1;
        this.fetchCronHistory(1, this.cronHistoryPerPage, this.cronHistorySearchQuery);
    },

    // Show detailed log output for a cron job entry
    showCronLogOutput(log) {
        this.activeCronLog = log;
    },

    // Go to next page in cron history
    nextCronHistoryPage() {
        const maxPage = Math.ceil(this.cronHistoryTotal / this.cronHistoryPerPage);
        if (this.cronHistoryPage < maxPage) {
            this.cronHistoryPage += 1;
            this.fetchCronHistory(this.cronHistoryPage, this.cronHistoryPerPage, this.cronHistorySearchQuery);
        }
    },

    // Go to previous page in cron history
    prevCronHistoryPage() {
        if (this.cronHistoryPage > 1) {
            this.cronHistoryPage -= 1;
            this.fetchCronHistory(this.cronHistoryPage, this.cronHistoryPerPage, this.cronHistorySearchQuery);
        }
    },

    // View all outputs in a combined modal
    async viewAllOutputs() {
        if (this.cronHistory.length === 0 && this.cronHistoryTotal === 0) {
            return;
        }
        // Reset filters when opening
        this.allOutputsFilterCronJob = '';
        this.allOutputsFilterTimeRange = 'all';
        this.allOutputsFilterStatus = '';
        this.allOutputsLimit = '100';
        
        // Fetch more logs to populate the modal (1000 by default)
        this.cronHistoryLoading = true;
        try {
            const url = new URL('/api/cronhistory', window.location.origin);
            url.searchParams.append('page', 1);
            url.searchParams.append('per_page', 1000);
            if (this.cronHistorySearchQuery && this.cronHistorySearchQuery.trim()) {
                url.searchParams.append('search', this.cronHistorySearchQuery.trim());
            }
            const response = await fetch(url);
            const data = await response.json();
            // Store these logs separately for the modal
            this.allOutputsData = data.logs || [];
            this.viewingAllOutputs = true;
        } catch (error) {
            console.error('Error fetching logs for all outputs view:', error);
            // Fallback to current page data if fetch fails
            this.allOutputsData = this.cronHistory;
            this.viewingAllOutputs = true;
        } finally {
            this.cronHistoryLoading = false;
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
    }
};
