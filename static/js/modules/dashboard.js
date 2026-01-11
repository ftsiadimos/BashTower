// Dashboard Module
// Methods for the main dashboard view and utilities

const DashboardMethods = {
    // Render markdown text using marked library
    renderMarkdown(text) {
        return marked.parse(text);
    },

    // Copy text to clipboard with light UI feedback
    async copyToClipboard(text) {
        try {
            const toCopy = (typeof text === 'string') ? text : JSON.stringify(text);
            if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(toCopy);
            } else {
                const el = document.createElement('textarea');
                el.value = toCopy;
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                el.remove();
            }
            const feedback = document.createElement('div');
            feedback.textContent = 'Copied to clipboard';
            feedback.className = 'fixed bottom-4 right-4 bg-slate-800 text-white text-xs px-3 py-2 rounded shadow';
            document.body.appendChild(feedback);
            setTimeout(() => feedback.remove(), 1500);
        } catch (err) {
            console.error('copy failed', err);
        }
    },

    // Get the currently selected template object
    getSelectedTemplate() {
        if (!this.runForm.template_id) return null;
        return this.templates.find(t => t.id === this.runForm.template_id);
    }
};
