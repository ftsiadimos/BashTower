// Key Management Module
// Methods, data and computed for managing SSH keys

const KeysData = () => ({
    keys: [],
    keyForm: { name: '', private_key: '' },
    showKeyModal: false,
    keySearchQuery: ''
});

const KeysComputed = {
    filteredKeys() {
        if (!this.keySearchQuery || !this.keySearchQuery.trim()) {
            return this.keys;
        }
        const query = this.keySearchQuery.toLowerCase();
        return this.keys.filter(k => k.name.toLowerCase().includes(query));
    }
};

const KeysMethods = {
    // Fetch all keys from API
    async fetchKeys() {
        const response = await fetch(API.KEYS);
        this.keys = await response.json();
        if (this.keys.length > 0 && !this.runForm.key_id) {
            this.runForm.key_id = this.keys[0].id;
        }
    },


    // Open modal to add a new key
    openKeyModal() {
        this.keyForm = { name: '', private_key: '' };
        this.showKeyModal = true;
    },

    // Close key modal
    closeKeyModal() {
        this.showKeyModal = false;
        this.keyForm = { name: '', private_key: '' };
    },

    // Save key (from modal)
    async saveKey() {
        if (!this.keyForm.name || !this.keyForm.private_key) {
            alert('Please provide both a key name and private key.');
            return;
        }

        const response = await fetch(API.KEYS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(this.keyForm)
        });
        
        if (response.ok) {
            this.closeKeyModal();
            this.fetchKeys();
        } else {
            const error = await response.json();
            alert(error.error || 'Failed to save SSH key');
        }
    },

    // Legacy add method (redirect to saveKey)
    async addKey() {
        await this.saveKey();
    },

    // Delete a key
    async deleteKey(id) {
        if (confirm('Are you sure you want to delete this SSH key?')) {
            await fetch(`${API.KEYS}/${id}`, { method: 'DELETE' });
            this.fetchKeys();
        }
    },

    // Get key name by ID (helper)
    getKeyNameById(keyId) {
        const key = this.keys.find(k => k.id === keyId);
        return key ? key.name : 'Unknown Key';
    }
};
