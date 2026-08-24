// Copyright (C) 2025 Fotios Tsiadimos
// SPDX-License-Identifier: GPL-3.0-only
//
// Satellite Sync Module
// Methods for Red Hat Satellite integration

const SatelliteMethods = {
    // Fetch satellite configuration
    async fetchSatelliteConfig() {
        const response = await fetch(API.SATELLITE_CONFIG);
        const config = await response.json();
        this.satelliteConfig = config;
        this.satelliteForm.url = config.url;
        this.satelliteForm.username = config.username;
        this.satelliteForm.ssh_username = config.ssh_username;
        this.satelliteForm.auto_sync_enabled = config.auto_sync_enabled || false;
        this.satelliteForm.auto_sync_interval = config.auto_sync_interval || 60;
    },

    // Save satellite configuration
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
                ssh_username: this.satelliteForm.ssh_username,
                auto_sync_enabled: this.satelliteForm.auto_sync_enabled,
                auto_sync_interval: this.satelliteForm.auto_sync_interval,
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

    // Sync hosts from Satellite
    async syncSatelliteHosts() {
        this.satelliteLoading = true;
        this.syncMessage = 'Starting synchronization...';

        const response = await fetch(API.SATELLITE_SYNC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        const result = await response.json();
        this.satelliteLoading = false;
        
        // Refresh both hosts and groups after sync
        await this.fetchHosts();
        await this.fetchGroups();
        
        // Refresh satellite config to get updated sync history
        await this.fetchSatelliteConfig();

        if (response.ok) {
            this.syncMessage = result.message;
            if (result.mock_used) {
                this.syncMessage += " (Used Mock Data due to API failure)";
            }
        } else {
            this.syncMessage = `Error during synchronization: ${result.error || 'Unknown error'}`;
        }
    },

    // Format sync time for log display
    formatSyncLogTime(isoDateTime) {
        if (!isoDateTime) return '';
        const date = new Date(isoDateTime);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        const ms = String(date.getMilliseconds()).padStart(3, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds},${ms}`;
    }
};
