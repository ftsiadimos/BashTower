// Group Management Module
// Methods for managing host groups

const GroupsMethods = {
    // Fetch all groups from API
    async fetchGroups() {
        const response = await fetch(API.GROUPS);
        this.groups = await response.json();
    },

    // Get group name by ID (helper)
    getGroupName(id) {
        const group = this.groups.find(g => g.id === id);
        return group ? group.name : `Group ID ${id}`;
    },

    // Get host name by ID (helper)
    getHostName(id) {
        const host = this.hosts.find(h => h.id === id);
        return host ? host.name : `Host ID ${id}`;
    },

    // Toggle a host in the group form
    toggleHostInGroup(hostId) {
        const index = this.groupForm.host_ids.indexOf(hostId);
        if (index > -1) {
            this.groupForm.host_ids.splice(index, 1);
        } else {
            this.groupForm.host_ids.push(hostId);
        }
    },

    // Start creating a new group
    startNewGroup() {
        this.groupForm = { id: null, name: '', host_ids: [] };
        this.editingGroup = true;
    },

    // Edit an existing group
    editGroup(group) {
        this.groupForm = { ...group };
        this.editingGroup = true;
    },

    // Cancel group editing
    cancelGroupEdit() {
        this.editingGroup = false;
    },

    // Toggle select all hosts for group
    toggleSelectAllGroupHosts(event) {
        if (event.target.checked) {
            this.groupForm.host_ids = this.hosts.map(h => h.id);
        } else {
            this.groupForm.host_ids = [];
        }
    },

    // Save group (create or update)
    async saveGroup() {
        if (!this.groupForm.name) return;

        const method = this.groupForm.id ? 'PUT' : 'POST';
        const url = this.groupForm.id ? `${API.GROUPS}/${this.groupForm.id}` : API.GROUPS;

        const payload = {
            name: this.groupForm.name,
            host_ids: this.groupForm.host_ids
        };

        try {
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (response.ok) {
                this.editingGroup = false;
                await this.fetchGroups();
                await this.fetchHosts();
            } else {
                const errorData = await response.json().catch(() => ({}));
                alert(errorData.error || 'Failed to save group.');
            }
        } catch (error) {
            console.error('Error saving group:', error);
            alert('An error occurred while saving the group.');
        }
    },

    // Delete a group
    async deleteGroup(id) {
        if (confirm('Are you sure you want to delete this group? This will not delete the member hosts.')) {
            await fetch(`${API.GROUPS}/${id}`, { method: 'DELETE' });
            await this.fetchGroups();
            await this.fetchHosts();
        }
    }
};
