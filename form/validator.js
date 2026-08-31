/**
 * Intelligent Validator — Phase 5: Field Validation & Voice Confirmation Loop
 *
 * Validates form field values based on:
 *   - HTML5 constraints  (required, minlength, maxlength, min, max, pattern)
 *   - Semantic field type (email format, phone digits, name sanity)
 *   - Custom rules injected per field
 *
 * Returns a ValidationResult: { valid, errors[], warnings[], suggestion }
 *
 * Zero external dependencies; UMD (Browser & Node.js).
 */

(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const v = factory();
        root.FormValidator = v;
        root.FormFiller = root.FormFiller || {};
        root.FormFiller.Validator = v;
        if (typeof window !== 'undefined') window.FormValidator = v;
    }
})(typeof self !== 'undefined' ? self : (typeof global !== 'undefined' ? global : this), function() {
    'use strict';

    /* ─────────────────────────────────────────────
       Built-in Semantic Validation Rules
       ───────────────────────────────────────────── */
    const SEMANTIC_RULES = {
        'CONTACT.EMAIL': [
            {
                test: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
                message: 'Please say a valid email address, like user at gmail dot com.',
                code: 'INVALID_EMAIL'
            }
        ],
        'CONTACT.PHONE': [
            {
                test: v => /^\+?[\d]{7,15}$/.test(v.replace(/[\s\-\(\)]/g, '')),
                message: 'Phone number should be 7 to 15 digits. Please say your number again.',
                code: 'INVALID_PHONE'
            }
        ],
        'CONTACT.MOBILE': [
            {
                test: v => /^\+?[\d]{7,15}$/.test(v.replace(/[\s\-\(\)]/g, '')),
                message: 'Mobile number should be 7 to 15 digits. Please say your number again.',
                code: 'INVALID_PHONE'
            }
        ],
        'PERSON.FIRST_NAME': [
            {
                test: v => v.length >= 2,
                message: 'First name must be at least 2 characters.',
                code: 'TOO_SHORT'
            },
            {
                test: v => /^[a-zA-Z\s'\-\.]+$/.test(v),
                message: 'Name should contain only letters. Did you mean to say a name?',
                code: 'INVALID_CHARS'
            }
        ],
        'PERSON.LAST_NAME': [
            {
                test: v => v.length >= 2,
                message: 'Last name must be at least 2 characters.',
                code: 'TOO_SHORT'
            },
            {
                test: v => /^[a-zA-Z\s'\-\.]+$/.test(v),
                message: 'Name should contain only letters. Did you mean to say a name?',
                code: 'INVALID_CHARS'
            }
        ],
        'PERSON.FULL_NAME': [
            {
                test: v => v.trim().split(/\s+/).length >= 1,
                message: 'Please say your full name.',
                code: 'TOO_SHORT'
            }
        ],
        'WORK.EXPERIENCE_YEARS': [
            {
                test: v => !isNaN(Number(v)) && Number(v) >= 0 && Number(v) <= 60,
                message: 'Please say a number between 0 and 60 for years of experience.',
                code: 'OUT_OF_RANGE'
            }
        ],
        'GENERAL.RATING': [
            {
                test: v => !isNaN(Number(v)) && Number(v) >= 1 && Number(v) <= 10,
                message: 'Rating should be between 1 and 10.',
                code: 'OUT_OF_RANGE'
            }
        ]
    };

    /* ─────────────────────────────────────────────
       HTML Type Rules
       ───────────────────────────────────────────── */
    const HTML_TYPE_RULES = {
        'email': [
            {
                test: v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
                message: 'Please say a valid email, like user at domain dot com.',
                code: 'INVALID_EMAIL'
            }
        ],
        'tel': [
            {
                test: v => /^\+?[\d]{7,15}$/.test(v.replace(/[\s\-\(\)]/g, '')),
                message: 'Phone number should contain 7 to 15 digits.',
                code: 'INVALID_PHONE'
            }
        ],
        'number': [
            {
                test: v => !isNaN(Number(v)),
                message: 'Please say a number.',
                code: 'NOT_A_NUMBER'
            }
        ],
        'url': [
            {
                test: v => { try { new URL(v); return true; } catch { return false; } },
                message: 'Please say a valid web address.',
                code: 'INVALID_URL'
            }
        ]
    };

    /**
     * Validates a value against a field's metadata and constraints.
     *
     * @param {string} value           - The cleaned input value to validate
     * @param {Object} fieldInfo       - Field metadata from FormScanner / DOM
     *   { id, name, type, label, semantic_field, required, minlength, maxlength, min, max, pattern }
     * @returns {{ valid: boolean, errors: string[], warnings: string[], suggestion: string|null }}
     */
    function validate(value, fieldInfo = {}) {
        const errors = [];
        const warnings = [];
        const trimmed = (value || '').trim();

        const required   = fieldInfo.required === true || fieldInfo.required === 'true';
        const minlength  = parseInt(fieldInfo.minlength || fieldInfo.minLength, 10) || 0;
        const maxlength  = parseInt(fieldInfo.maxlength || fieldInfo.maxLength, 10) || Infinity;
        const min        = fieldInfo.min !== undefined ? Number(fieldInfo.min) : undefined;
        const max        = fieldInfo.max !== undefined ? Number(fieldInfo.max) : undefined;
        const pattern    = fieldInfo.pattern || null;
        const label      = fieldInfo.label || fieldInfo.id || fieldInfo.name || 'field';
        const htmlType   = (fieldInfo.type || '').toLowerCase();
        const semantic   = fieldInfo.semantic_field || '';

        // 1. Required check
        if (required && trimmed === '') {
            errors.push(`${label} is required. Please say your ${label}.`);
        }

        // 2. Min / Max length
        if (trimmed && minlength > 0 && trimmed.length < minlength) {
            errors.push(`${label} must be at least ${minlength} characters. You said "${trimmed}" which is too short.`);
        }
        if (trimmed && isFinite(maxlength) && trimmed.length > maxlength) {
            errors.push(`${label} must be no more than ${maxlength} characters.`);
        }

        // 3. HTML pattern
        if (trimmed && pattern) {
            try {
                if (!new RegExp(pattern).test(trimmed)) {
                    errors.push(`${label} does not match the required format. Please try again.`);
                }
            } catch (e) { /* ignore bad regex */ }
        }

        // 4. Numeric min/max (for type=number)
        if (trimmed && htmlType === 'number') {
            const num = Number(trimmed);
            if (isNaN(num)) {
                errors.push(`${label} must be a number.`);
            } else {
                if (min !== undefined && num < min) errors.push(`${label} must be at least ${min}.`);
                if (max !== undefined && num > max) errors.push(`${label} must be at most ${max}.`);
            }
        }

        // 5. HTML type-specific rules
        if (trimmed && HTML_TYPE_RULES[htmlType]) {
            for (const rule of HTML_TYPE_RULES[htmlType]) {
                if (!rule.test(trimmed)) errors.push(rule.message);
            }
        }

        // 6. Semantic rules (override HTML type if semantic is more specific)
        if (trimmed && SEMANTIC_RULES[semantic]) {
            for (const rule of SEMANTIC_RULES[semantic]) {
                if (!rule.test(trimmed)) {
                    // Don't double-report the same issue
                    if (!errors.some(e => e === rule.message)) {
                        errors.push(rule.message);
                    }
                }
            }
        }

        // 7. Soft warnings (non-blocking)
        if (trimmed && (semantic.startsWith('PERSON.') || label.toLowerCase().includes('name'))) {
            if (/\d/.test(trimmed)) {
                warnings.push(`"${trimmed}" looks like it contains a number. Is this your ${label}?`);
            }
        }

        // Build voice-friendly suggestion
        let suggestion = null;
        if (errors.length > 0) {
            suggestion = errors[0]; // Lead with the first error as the spoken prompt
        } else if (warnings.length > 0) {
            suggestion = warnings[0];
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            suggestion
        };
    }

    /**
     * Validates a value directly from a DOM element (reads constraints from the element).
     *
     * @param {string}      value   - Cleaned value to validate
     * @param {HTMLElement} el      - DOM input element
     * @param {Object}      [extra] - Extra metadata overrides (e.g. semantic_field from FormScanner)
     */
    function validateFromElement(value, el, extra = {}) {
        if (!el) return { valid: false, errors: ['Element not found'], warnings: [], suggestion: null };

        const fieldInfo = {
            id:         el.id,
            name:       el.name,
            type:       el.type || el.tagName.toLowerCase(),
            label:      (() => {
                            const lblEl = el.id && document.querySelector(`label[for="${el.id}"]`);
                            return lblEl ? lblEl.textContent.trim() : (el.name || el.id);
                        })(),
            required:   el.required,
            minlength:  el.minLength > 0 ? el.minLength : undefined,
            maxlength:  el.maxLength > 0 && el.maxLength < 524288 ? el.maxLength : undefined,
            min:        el.min !== '' ? el.min : undefined,
            max:        el.max !== '' ? el.max : undefined,
            pattern:    el.pattern || undefined,
            ...extra
        };

        return validate(value, fieldInfo);
    }

    /**
     * Applies visual validation feedback to a DOM element.
     * Adds/removes .field-valid / .field-error CSS classes
     * and injects an inline error message element.
     *
     * @param {HTMLElement} el     - Input element
     * @param {{ valid, errors }} result
     */
    function applyVisualFeedback(el, result) {
        if (!el || typeof document === 'undefined') return;

        const groupEl = el.closest('.form-group') || el.parentElement;

        // Remove existing feedback
        el.classList.remove('field-valid', 'field-error');
        const existing = groupEl && groupEl.querySelector('.voice-validation-msg');
        if (existing) existing.remove();

        if (result.valid) {
            el.classList.add('field-valid');
        } else {
            el.classList.add('field-error');
            if (groupEl && result.errors.length > 0) {
                const msg = document.createElement('div');
                msg.className = 'voice-validation-msg';
                msg.textContent = '⚠ ' + result.errors[0];
                groupEl.appendChild(msg);
            }
        }
    }

    return {
        validate,
        validateFromElement,
        applyVisualFeedback
    };
});

