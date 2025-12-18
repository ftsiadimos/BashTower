// Dashboard Module
// Methods for the main dashboard view and utilities

const DashboardMethods = {
    // Render markdown text using marked library
    renderMarkdown(text) {
        return marked.parse(text);
    },

    // Get the currently selected template object
    getSelectedTemplate() {
        if (!this.runForm.template_id) return null;
        return this.templates.find(t => t.id === this.runForm.template_id);
    }
};
