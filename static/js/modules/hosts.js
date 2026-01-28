// Copyright (C) 2025 Fotios Tsiadimos
// SPDX-License-Identifier: GPL-3.0-only
//
// Host Management Module
// Methods, data and computed for managing remote hosts

const HostsData = () => ({
    hosts: [],
    hostForm: { id: null, name: '', hostname: '', username: '', port: 22 },
    hostPageSearchQuery: '',
    showHostModal: false,
    editingHost: null
});

const HostsComputed = {
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
    }
};

// Methods
const HostsMethods = {
    // Fetch all hosts from API
    async fetchHosts() {
        const response = await fetch(API.HOSTS);
        this.hosts = await response.json();
    },

    // Open modal to add a new host
    openHostModal() {
        this.editingHost = null;
   this.hostForm = { id: null, name: '', hostname: '', username: '', port: 22, shell: 'bash' };
        this.showHostModal = true;
    },

    // Open modal to edit existing host
    editHost(host) {
        this.editingHost = host;
        this.hostForm = {
            id: host.id,
            name: host.name,
            hostname: host.hostname,
            username: host.username,
            port: host.port || 22,
            shell: host.shell || 'bash'
        };
        this.showHostModal = true;
    },

    // Close modal and reset form
    closeHostModal() {
        this.showHostModal = false;
        this.editingHost = null;
        this.hostForm = { id: null, name: '', hostname: '', username: '', port: 22, shell: 'bash' };
    },

    // Save host (add or update)
    async saveHost() {
        if (!this.hostForm.hostname || !this.hostForm.username) return;

        const url = this.editingHost 
            ? `${API.HOSTS}/${this.editingHost.id}` 
            : API.HOSTS;
        const method = this.editingHost ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.hostForm)
        });

        if (response.ok) {
            this.closeHostModal();
            this.fetchHosts();
        } else {
            const data = await response.json();
            alert(data.error || 'Failed to save host');
        }
    },

    // Legacy add method (redirect to modal)
    async addHost() {
        await this.saveHost();
    },

    // Delete a host
    async deleteHost(id) {
        if (confirm('Are you sure you want to delete this host?')) {
            await fetch(`${API.HOSTS}/${id}`, { method: 'DELETE' });
            this.fetchHosts();
        }
    },

    // Get host friendly name from hostname (helper)
    getHostFriendlyName(hostname) {
        const host = this.hosts.find(h => h.hostname === hostname);
        return host ? `${host.name} (${hostname})` : hostname;
    },

    // Get host names by IDs (helper)
    getHostNamesByIds(hostIds) {
        return hostIds.map(id => {
            const host = this.hosts.find(h => h.id === id);
            return host ? host.name : `Unknown Host ('${id}')`;
        }).join(', ');
    }
};
