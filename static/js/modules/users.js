// Users management module
const usersMethods = {
    async fetchUsers() {
        try {
            const response = await fetch('/api/users');
            if (response.ok) {
                this.users = await response.json();
            }
        } catch (error) {
            console.error('Error fetching users:', error);
        }
    },

    openUserModal(user = null) {
        this.editingUser = user;
        this.userForm = {
            username: user?.username || '',
            email: user?.email || '',
            password: '',
            is_admin: user?.is_admin || false
        };
        this.showModalPassword = false;
        this.showUserModal = true;
    },

    closeUserModal() {
        this.showUserModal = false;
        this.editingUser = null;
        this.userForm = {
            username: '',
            email: '',
            password: '',
            is_admin: false
        };
    },

    async saveUser() {
        this.userFormLoading = true;
        try {
            const url = this.editingUser 
                ? `/api/users/${this.editingUser.id}` 
                : '/api/users';
            const method = this.editingUser ? 'PUT' : 'POST';

            const payload = {
                username: this.userForm.username,
                email: this.userForm.email || null,
                is_admin: this.userForm.is_admin
            };

            // Only include password if provided
            if (this.userForm.password) {
                payload.password = this.userForm.password;
            }

            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (response.ok) {
                this.closeUserModal();
                this.fetchUsers();
                this.showToast(
                    this.editingUser ? 'User updated successfully' : 'User created successfully',
                    'success'
                );
            } else {
                this.showToast(data.error || 'Failed to save user', 'error');
            }
        } catch (error) {
            console.error('Error saving user:', error);
            this.showToast('Connection error', 'error');
        } finally {
            this.userFormLoading = false;
        }
    },

    confirmDeleteUser(user) {
        this.userToDelete = user;
        this.showDeleteModal = true;
    },

    async deleteUser() {
        if (!this.userToDelete) return;

        try {
            const response = await fetch(`/api/users/${this.userToDelete.id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.showDeleteModal = false;
                this.userToDelete = null;
                this.fetchUsers();
                this.showToast('User deleted successfully', 'success');
            } else {
                const data = await response.json();
                this.showToast(data.error || 'Failed to delete user', 'error');
            }
        } catch (error) {
            console.error('Error deleting user:', error);
            this.showToast('Connection error', 'error');
        }
    }
};

// Computed property for users
const usersComputed = {
    filteredUsers() {
        if (!this.userSearch) return this.users;
        const search = this.userSearch.toLowerCase();
        return this.users.filter(u => 
            u.username.toLowerCase().includes(search) ||
            (u.email && u.email.toLowerCase().includes(search))
        );
    }
};
