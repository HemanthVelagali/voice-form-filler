/**
 * Action Planner & Voice Navigation — Phase 4
 * 
 * Translates natural voice utterances into concrete UI actions:
 *   - Field Navigation: "Next", "Previous", "Go to Email", "Jump to Address"
 *   - Dropdown Selection: "Select India", "Choose California", "Pick United States"
 *   - Radio Selection: "Select Male", "Pick Female", "Choose Other"
 *   - Checkbox Toggling: "Check Python and JavaScript", "I agree to terms"
 *   - Form Submission / Reset: "Submit application", "Clear form"
 *   - Value Filling: "My name is Barack Obama" -> extracts clean value and fills field
 * 
 * Zero external dependencies; UMD (Browser & Node.js).
 */

(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const planner = factory();
        root.ActionPlanner = planner;
        root.FormFiller = root.FormFiller || {};
        root.FormFiller.ActionPlanner = planner;
        if (typeof window !== 'undefined') {
            window.ActionPlanner = planner;
        }
    }
})(typeof self !== 'undefined' ? self : (typeof global !== 'undefined' ? global : this), function() {
    'use strict';

    /**
     * Helper to get SpeechCleaner instance
     */
    function getSpeechCleaner() {
        if (typeof SpeechCleaner !== 'undefined') return SpeechCleaner;
        if (typeof window !== 'undefined' && window.SpeechCleaner) return window.SpeechCleaner;
        if (typeof require === 'function') {
            try { return require('./speech-cleaner.js'); } catch (e) {}
        }
        return null;
    }

    /**
     * Parses a spoken utterance against the current form snapshot and active context to produce an Action Plan.
     * 
     * @param {string} utterance - Raw speech transcript
     * @param {Object} context - { activeFieldId, formSnapshot }
     * @returns {Object} Action plan { action: string, ...details }
     */
    function planAction(utterance, context = {}) {
        if (!utterance || typeof utterance !== 'string') {
            return { action: 'NOOP', message: 'Empty utterance' };
        }

        const raw = utterance.trim().replace(/[.,!?;:]+$/, '').trim();
        const lower = raw.toLowerCase();
        const snapshot = context.formSnapshot || (typeof window !== 'undefined' && window.FormScanner && window.FormScanner.getFormSnapshot ? window.FormScanner.getFormSnapshot() : null);
        const activeFieldId = context.activeFieldId || null;

        // 1. Check for Direct Navigation Intents
        if (/^(?:looks\s+good|next|next\s+field|go\s+to\s+next|next\s+please|proceed|continue|move\s+next|looks\s+fine|looks\s+ok)$/i.test(raw)) {
            return { action: 'NEXT_FIELD', message: 'Moving to next field' };
        }

        if (/^(?:go\s+back|previous|previous\s+field|back|back\s+please|go\s+previous)$/i.test(raw)) {
            return { action: 'PREVIOUS_FIELD', message: 'Moving to previous field' };
        }

        if (/^(?:submit|submit\s+form|submit\s+application|send\s+form|send\s+application|finish|done)$/i.test(raw)) {
            return { action: 'SUBMIT_FORM', message: 'Submitting form' };
        }

        if (/^(?:clear|clear\s+field|erase|delete|reset\s+field|wipe\s+field)$/i.test(raw)) {
            return { action: 'CLEAR_FIELD', targetFieldId: activeFieldId, message: 'Clearing field' };
        }

        // 2. Check for "Go to / Jump to [Field]" Navigation
        const fieldJumpMatch = raw.match(/^(?:go\s+to|jump\s+to|switch\s+to|focus\s+on|navigate\s+to|select\s+field)\s+(?:the\s+)?([a-zA-Z0-9_\s]+)$/i);
        if (fieldJumpMatch && snapshot && snapshot.forms) {
            const targetQuery = fieldJumpMatch[1].trim().toLowerCase();
            for (const form of snapshot.forms) {
                for (const field of form.fields) {
                    const label = (field.label || '').toLowerCase();
                    const name = (field.name || '').toLowerCase();
                    const id = (field.id || '').toLowerCase();

                    if (label === targetQuery || name === targetQuery || id === targetQuery || label.includes(targetQuery) || name.includes(targetQuery)) {
                        return {
                            action: 'NAVIGATE_TO_FIELD',
                            targetFieldId: field.id || field.name,
                            field: field,
                            message: `Navigating to ${field.label || field.name}`
                        };
                    }
                }
            }
        }

        // 3. Check for Dropdown Option Selection (e.g. "Select India", "Choose California", "Pick United States")
        const selectOptionMatch = raw.match(/^(?:select|choose|pick|set\s+country\s+to|set\s+state\s+to|set\s+option\s+to)\s+([a-zA-Z0-9_\s]+)$/i);
        if (selectOptionMatch && snapshot && snapshot.forms) {
            const optionQuery = selectOptionMatch[1].trim().toLowerCase();
            for (const form of snapshot.forms) {
                for (const field of form.fields) {
                    if (field.type === 'select' && Array.isArray(field.options)) {
                        const matchedOpt = field.options.find(opt => 
                            (opt.text && opt.text.toLowerCase() === optionQuery) ||
                            (opt.value && opt.value.toLowerCase() === optionQuery) ||
                            (opt.text && opt.text.toLowerCase().includes(optionQuery))
                        );
                        if (matchedOpt) {
                            return {
                                action: 'SELECT_OPTION',
                                fieldId: field.id || field.name,
                                value: matchedOpt.value,
                                optionText: matchedOpt.text,
                                message: `Selected ${matchedOpt.text} for ${field.label || field.name}`
                            };
                        }
                    }
                }
            }
        }

        // 4. Check for Radio Group Selection (e.g. "Select Male", "Pick Female", "Choose Other")
        if (selectOptionMatch && snapshot && snapshot.forms) {
            const radioQuery = selectOptionMatch[1].trim().toLowerCase();
            for (const form of snapshot.forms) {
                for (const field of form.fields) {
                    if (field.type === 'radio' && Array.isArray(field.options)) {
                        const matchedRadio = field.options.find(opt => 
                            (opt.label && opt.label.toLowerCase() === radioQuery) ||
                            (opt.value && opt.value.toLowerCase() === radioQuery) ||
                            (opt.label && opt.label.toLowerCase().includes(radioQuery))
                        );
                        if (matchedRadio) {
                            return {
                                action: 'SET_RADIO',
                                fieldId: field.id || field.name,
                                value: matchedRadio.value,
                                label: matchedRadio.label,
                                selector: matchedRadio.selector,
                                message: `Selected ${matchedRadio.label} for ${field.label || field.name}`
                            };
                        }
                    }
                }
            }
        }

        // 5. Check for Checkbox Toggling (e.g. "Check Python", "Select JavaScript", "I agree to terms")
        const checkboxMatch = raw.match(/^(?:check|select|toggle|enable)\s+([a-zA-Z0-9_\s]+)$/i) ||
                              (/^i\s+(?:agree|accept|certify)(?:\s+to)?(?:\s+the)?\s+(?:terms|privacy|conditions)?$/i.test(raw) ? ['agree', 'terms'] : null);
        if (checkboxMatch && snapshot && snapshot.forms) {
            const cbQuery = (checkboxMatch[1] || 'terms').trim().toLowerCase();
            for (const form of snapshot.forms) {
                for (const field of form.fields) {
                    // Checkbox group
                    if (field.type === 'checkbox_group' && Array.isArray(field.options)) {
                        const matchedCb = field.options.find(opt => 
                            (opt.label && opt.label.toLowerCase().includes(cbQuery)) ||
                            (opt.value && opt.value.toLowerCase() === cbQuery)
                        );
                        if (matchedCb) {
                            return {
                                action: 'TOGGLE_CHECKBOX',
                                fieldId: field.id || field.name,
                                value: matchedCb.value,
                                label: matchedCb.label,
                                checked: true,
                                message: `Checked ${matchedCb.label}`
                            };
                        }
                    }
                    // Single Checkbox
                    if (field.type === 'checkbox') {
                        const label = (field.label || '').toLowerCase();
                        const name = (field.name || '').toLowerCase();
                        if (label.includes(cbQuery) || name.includes(cbQuery) || cbQuery === 'terms') {
                            return {
                                action: 'TOGGLE_CHECKBOX',
                                fieldId: field.id || field.name,
                                checked: true,
                                message: `Checked ${field.label || field.name}`
                            };
                        }
                    }
                }
            }
        }

        // 6. Default: Value Filling Action for the Active Field
        const cleaner = getSpeechCleaner();
        let cleanValue = raw;
        let activeFieldMeta = null;

        if (snapshot && snapshot.forms && activeFieldId) {
            for (const form of snapshot.forms) {
                const found = form.fields.find(f => f.id === activeFieldId || f.name === activeFieldId);
                if (found) {
                    activeFieldMeta = found;
                    break;
                }
            }
        }

        if (cleaner && typeof cleaner.cleanInputForField === 'function') {
            cleanValue = cleaner.cleanInputForField(raw, activeFieldMeta || { id: activeFieldId, name: activeFieldId });
        } else {
            // Built-in inline regex cleaner fallback
            cleanValue = raw
                .replace(/^(?:my\s+(?:first\s+name|last\s+name|full\s+name|name|email|phone|address|contact)\s+(?:is|would\s+be|'s|:))\s*/i, '')
                .replace(/^(?:(?:first\s+name|last\s+name|full\s+name|name|email|phone|address|contact)\s+(?:is|would\s+be|'s|:))\s*/i, '')
                .replace(/^(?:please\s+)?(?:enter|put|write|fill|type|insert|set)\s+(?:in\s+|for\s+)?(?:the\s+)?(?:first\s+name|last\s+name|name|email|phone|address|field)?\s*(?:as|to|is|:)?\s*/i, '')
                .replace(/^(?:it\s+is|it's|this\s+is|i\s+am)\s*/i, '')
                .replace(/[.]+$/, '')
                .trim();

            if (activeFieldId && (activeFieldId.includes('name') || activeFieldId === 'fname' || activeFieldId === 'lname')) {
                cleanValue = cleanValue.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }
        }

        return {
            action: 'FILL_VALUE',
            targetFieldId: activeFieldId,
            rawValue: raw,
            value: cleanValue,
            field: activeFieldMeta,
            message: `Filled '${cleanValue}' into ${activeFieldId || 'field'}`
        };
    }

    /**
     * Executes the action plan against the live browser DOM.
     * 
     * @param {Object} plan - Action plan produced by planAction
     * @param {Object} handlers - Optional custom handlers { onNavigate, onFill, onSubmit, onAnnounce }
     */
    function executeAction(plan, handlers = {}) {
        if (!plan) return false;

        switch (plan.action) {
            case 'NEXT_FIELD':
                if (typeof handlers.onNext === 'function') {
                    handlers.onNext();
                } else if (typeof window !== 'undefined' && typeof window.moveToNextField === 'function') {
                    window.moveToNextField();
                }
                return true;

            case 'PREVIOUS_FIELD':
                if (typeof handlers.onPrevious === 'function') {
                    handlers.onPrevious();
                }
                return true;

            case 'NAVIGATE_TO_FIELD':
                if (typeof handlers.onNavigate === 'function') {
                    handlers.onNavigate(plan.targetFieldId);
                } else if (typeof document !== 'undefined') {
                    const el = document.getElementById(plan.targetFieldId) || document.querySelector(`[name="${plan.targetFieldId}"]`);
                    if (el) {
                        el.focus();
                        if (typeof window.setActiveField === 'function') {
                            window.setActiveField(plan.targetFieldId);
                        }
                    }
                }
                return true;

            case 'SELECT_OPTION':
                if (typeof document !== 'undefined') {
                    const selectEl = document.getElementById(plan.fieldId) || document.querySelector(`select[name="${plan.fieldId}"]`);
                    if (selectEl) {
                        selectEl.value = plan.value;
                        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                        selectEl.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
                return true;

            case 'SET_RADIO':
                if (typeof document !== 'undefined') {
                    const radioEl = document.querySelector(`input[type="radio"][name="${plan.fieldId}"][value="${plan.value}"]`) || (plan.selector ? document.querySelector(plan.selector) : null);
                    if (radioEl) {
                        radioEl.checked = true;
                        radioEl.dispatchEvent(new Event('change', { bubbles: true }));
                        radioEl.dispatchEvent(new Event('click', { bubbles: true }));
                    }
                }
                return true;

            case 'TOGGLE_CHECKBOX':
                if (typeof document !== 'undefined') {
                    const cbEl = document.querySelector(`input[type="checkbox"][name="${plan.fieldId}"][value="${plan.value}"]`) || document.getElementById(plan.fieldId);
                    if (cbEl) {
                        cbEl.checked = plan.checked !== undefined ? plan.checked : !cbEl.checked;
                        cbEl.dispatchEvent(new Event('change', { bubbles: true }));
                        cbEl.dispatchEvent(new Event('click', { bubbles: true }));
                    }
                }
                return true;

            case 'SUBMIT_FORM':
                if (typeof handlers.onSubmit === 'function') {
                    handlers.onSubmit();
                } else if (typeof document !== 'undefined') {
                    const form = document.querySelector('form');
                    if (form) {
                        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                    }
                }
                return true;

            case 'CLEAR_FIELD':
                if (typeof handlers.onFill === 'function') {
                    handlers.onFill(plan.targetFieldId, '');
                } else if (typeof document !== 'undefined' && plan.targetFieldId) {
                    const el = document.getElementById(plan.targetFieldId);
                    if (el) {
                        el.value = '';
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }
                return true;

            case 'FILL_VALUE':
                if (typeof handlers.onFill === 'function') {
                    handlers.onFill(plan.targetFieldId, plan.value);
                } else if (typeof document !== 'undefined' && plan.targetFieldId) {
                    const el = document.getElementById(plan.targetFieldId);
                    if (el) {
                        el.value = plan.value;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
                return true;

            default:
                return false;
        }
    }

    return {
        planAction,
        executeAction
    };
});
