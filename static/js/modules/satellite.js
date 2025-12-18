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

        if (response.ok) {
            this.syncMessage = result.message;
            if (result.mock_used) {
                this.syncMessage += " (Used Mock Data due to API failure)";
            }
        } else {
            this.syncMessage = `Error during synchronization: ${result.error || 'Unknown error'}`;
        }
    }
};
