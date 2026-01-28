// Copyright (C) 2025 Fotios Tsiadimos
// SPDX-License-Identifier: GPL-3.0-only
//
// Dashboard Module
// Methods for the main dashboard view and utilities

const DashboardMethods = {
    // Render markdown text using marked library with enhanced code block handling
    renderMarkdown(text) {
        marked.setOptions({
            breaks: true,
            gfm: true
        });
        
        const html = marked.parse(text);
        
        // Create a temporary element to parse and modify the HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        
        // Find ALL pre elements (using Array.from to avoid live collection issues)
        const preElements = Array.from(tempDiv.querySelectorAll('pre'));
        
        preElements.forEach((pre) => {
            const codeBlock = pre.querySelector('code');
            if (!codeBlock) return;
            
            const code = codeBlock.textContent;
            const classes = codeBlock.className || '';
            
            // Check if this is a bash/shell code block
            const isBashCommand = classes.includes('language-bash') || 
                                  classes.includes('language-sh') || 
                                  classes.includes('language-shell');
            
            if (isBashCommand) {
                // Create wrapper div
                const wrapper = document.createElement('div');
                wrapper.style.cssText = 'position: relative; margin: 1rem 0;';
                
                // Clone the pre element to avoid reference issues
                const newPre = pre.cloneNode(true);
                const newCode = newPre.querySelector('code');
                
                // Apply terminal styling
                newPre.style.cssText = 'background-color: #0a0e1a; border: 1px solid #1e293b; border-radius: 0.5rem; padding: 2.5rem 1rem 1rem 1rem; margin: 0; overflow-x: auto;';
                newCode.style.cssText = 'color: #4ade80; font-family: Menlo, Monaco, "Courier New", monospace; font-size: 0.875rem; white-space: pre-wrap; word-wrap: break-word;';
                
                // Create copy button
                const copyBtn = document.createElement('button');
                copyBtn.innerHTML = '<i class="fas fa-copy"></i> Copy';
                copyBtn.style.cssText = 'position: absolute; top: 0.5rem; right: 0.5rem; padding: 0.375rem 0.75rem; background-color: #1e293b; color: white; border: none; border-radius: 0.375rem; font-size: 0.75rem; cursor: pointer; z-index: 10;';
                copyBtn.onmouseover = () => copyBtn.style.backgroundColor = '#334155';
                copyBtn.onmouseout = () => copyBtn.style.backgroundColor = '#1e293b';
                
                // Store code content
                const codeContent = code;
                copyBtn.onclick = () => {
                    this.copyToClipboard(codeContent);
                };
                
                // Build the wrapper
                wrapper.appendChild(newPre);
                wrapper.appendChild(copyBtn);
                
                // Replace the original pre
                pre.replaceWith(wrapper);
            }
        });
        
        return tempDiv.innerHTML;
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
