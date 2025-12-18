// Cron History Module
// Methods for viewing cron job execution history

const CronHistoryMethods = {
    // Fetch cron execution history with pagination and search
    async fetchCronHistory(page = this.cronHistoryPage, perPage = this.cronHistoryPerPage, search = this.cronHistorySearchQuery) {
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
        } catch (error) {
            console.error('Error fetching cron history:', error);
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
