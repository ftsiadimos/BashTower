// Host Management Module
// Methods for managing remote hosts

const HostsMethods = {
    // Fetch all hosts from API
    async fetchHosts() {
        const response = await fetch(API.HOSTS);
        this.hosts = await response.json();
    },

    // Open modal to add a new host
    openHostModal() {
        this.editingHost = null;
        this.hostForm = { id: null, name: '', hostname: '', username: '', port: 22 };
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
            port: host.port || 22
        };
        this.showHostModal = true;
    },

    // Close modal and reset form
    closeHostModal() {
        this.showHostModal = false;
        this.editingHost = null;
        this.hostForm = { id: null, name: '', hostname: '', username: '', port: 22 };
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
