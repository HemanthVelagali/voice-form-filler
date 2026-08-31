/**
 * Form Scanner — Phase 1: Universal Form Awareness
 * 
 * Inspects any DOM structure to build a rich, structured, canonical representation
 * of form fields, inputs, selects, radio groups, checkbox groups, and action buttons.
 * Independent of specific field names or application architectures.
 * 
 * Zero external dependencies. Browser & Node.js (via jsdom/mock) compatible.
 */

(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const scanner = factory();
        root.FormScanner = scanner;
        root.FormFiller = root.FormFiller || {};
        root.FormFiller.scanPage = scanner.scanPage.bind(scanner);
        root.FormFiller.getFormSnapshot = scanner.getFormSnapshot.bind(scanner);
        root.FormFiller.startAutoScan = scanner.startAutoScan.bind(scanner);
        root.FormFiller.stopAutoScan = scanner.stopAutoScan.bind(scanner);
        root.FormFiller.scanner = scanner;
    }
})(typeof self !== 'undefined' ? self : (typeof global !== 'undefined' ? global : this), function() {
    'use strict';

    // State management for dynamic scanning
    let cachedSnapshot = null;
    let mutationObserver = null;
    let debounceTimer = null;
    let activeOptions = {
        debounceMs: 200,
        debug: false,
        includeHidden: false,
        onChange: null
    };

    /**
     * Cleans and sanitizes extracted label strings.
     * Removes trailing colons, asterisks, extra whitespace, newlines, and indicator text.
     */
    function cleanLabelText(text) {
        if (!text || typeof text !== 'string') return '';
        return text
            .replace(/\s+/g, ' ')
            .replace(/[\*:\u2022\u25CF]+/g, ' ') // Strip asterisks, colons, bullets
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Prettifies identifier strings like 'candidate_first_name' or 'firstName' into 'Candidate First Name'
     */
    function humanizeIdentifier(str) {
        if (!str || typeof str !== 'string') return '';
        return str
            .replace(/[-_]+/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
            .join(' ');
    }

    /**
     * Checks if an element is visible in the DOM.
     */
    function isElementVisible(el) {
        if (!el) return false;
        if (el.type === 'hidden') return false;
        if (el.hidden || (el.getAttribute && el.getAttribute('aria-hidden') === 'true')) return false;

        if (typeof window !== 'undefined' && window.getComputedStyle) {
            try {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                    return false;
                }
            } catch (e) {
                // Fallback for mock environments
            }
        }

        if (typeof el.offsetParent !== 'undefined' && el.offsetParent === null && el.tagName !== 'BODY') {
            // offsetParent is null for display:none elements (except fixed position elements)
            if (typeof window !== 'undefined' && window.getComputedStyle) {
                try {
                    const style = window.getComputedStyle(el);
                    if (style.position !== 'fixed') return false;
                } catch (e) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Generates a stable CSS selector for an element.
     */
    function getCssSelector(el) {
        if (!el || !el.tagName) return '';
        if (el.id) return `#${el.id}`;
        
        let path = el.tagName.toLowerCase();
        if (el.name) {
            path += `[name="${el.name}"]`;
            if (el.type) path += `[type="${el.type}"]`;
            if (el.value && (el.type === 'radio' || el.type === 'checkbox')) {
                path += `[value="${el.value}"]`;
            }
            return path;
        }

        if (el.className && typeof el.className === 'string') {
            const classes = el.className.trim().split(/\s+/).filter(c => !c.startsWith('ng-') && !c.startsWith('active-') && !c.startsWith('recording')).join('.');
            if (classes) path += `.${classes}`;
        }

        const parent = el.parentElement;
        if (parent && parent.tagName && parent.children) {
            const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
            if (siblings.length > 1) {
                const index = siblings.indexOf(el) + 1;
                path += `:nth-of-type(${index})`;
            }
            return `${getCssSelector(parent)} > ${path}`;
        }

        return path;
    }

    /**
     * Extracts text from elements referenced by ID in aria-labelledby.
     */
    function getTextFromAriaLabelledBy(doc, el) {
        if (!el || !el.getAttribute) return null;
        const labelledBy = el.getAttribute('aria-labelledby');
        if (!labelledBy || !doc) return null;
        
        const ids = labelledBy.trim().split(/\s+/);
        const textParts = [];
        for (const id of ids) {
            const refEl = typeof doc.getElementById === 'function' ? doc.getElementById(id) : (doc.querySelector ? doc.querySelector(`#${id}`) : null);
            if (refEl) {
                const txt = cleanLabelText(refEl.innerText || refEl.textContent);
                if (txt) textParts.push(txt);
            }
        }
        return textParts.length > 0 ? textParts.join(' ') : null;
    }

    /**
     * Intelligent Label Detection with strict prioritized resolution.
     * 
     * Priority:
     * 1. <label for="...">
     * 2. Wrapping <label>
     * 3. aria-label
     * 4. aria-labelledby
     * 5. Associated visible text (fieldset legend, preceding sibling, container label, title)
     * 6. placeholder
     * 7. name (humanized)
     * 8. id (humanized)
     */
    function detectFieldLabel(el, doc, options = {}) {
        const rootDoc = doc || (el.ownerDocument || (typeof document !== 'undefined' ? document : null));

        // 1. <label for="element_id">
        if (el.id && rootDoc && typeof rootDoc.querySelector === 'function') {
            try {
                const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(el.id) : el.id;
                const explicitLabel = rootDoc.querySelector(`label[for="${escapedId}"]`);
                if (explicitLabel) {
                    const text = cleanLabelText(explicitLabel.innerText || explicitLabel.textContent);
                    if (text) return { label: text, source: 'label_for' };
                }
            } catch (e) {
                // Ignore querySelector syntax errors
            }
        }

        // 2. Wrapping <label>
        if (el.closest) {
            const wrappingLabel = el.closest('label');
            if (wrappingLabel) {
                // Clone to avoid reading child input's current text if any
                const clone = wrappingLabel.cloneNode(true);
                const innerInputs = clone.querySelectorAll ? clone.querySelectorAll('input, select, textarea, button') : [];
                innerInputs.forEach(input => { if (input.remove) input.remove(); });
                const text = cleanLabelText(clone.innerText || clone.textContent);
                if (text) return { label: text, source: 'wrapping_label' };
            }
        }

        // 3. aria-label attribute
        if (el.getAttribute) {
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel && cleanLabelText(ariaLabel)) {
                return { label: cleanLabelText(ariaLabel), source: 'aria_label' };
            }
        }

        // 4. aria-labelledby
        if (rootDoc) {
            const ariaLabelledByText = getTextFromAriaLabelledBy(rootDoc, el);
            if (ariaLabelledByText) {
                return { label: ariaLabelledByText, source: 'aria_labelledby' };
            }
        }

        // 5. Associated visible text
        // 5a. Fieldset Legend (especially relevant if not in a radio/checkbox group)
        if (el.closest) {
            const fieldset = el.closest('fieldset');
            if (fieldset && fieldset.querySelector) {
                const legend = fieldset.querySelector('legend');
                if (legend) {
                    const legendText = cleanLabelText(legend.innerText || legend.textContent);
                    if (legendText && !options.isGroupOption) {
                        return { label: legendText, source: 'fieldset_legend' };
                    }
                }
            }
        }

        // 5b. Preceding Sibling Label / Heading / Span / Div (stopping at any input boundary)
        let prev = el.previousElementSibling;
        while (prev) {
            const tagName = prev.tagName ? prev.tagName.toUpperCase() : '';
            // If we cross another input element, stop searching backwards
            if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tagName)) {
                break;
            }
            if (prev.querySelector && prev.querySelector('input, select, textarea, button')) {
                break;
            }

            const className = prev.className || (prev.getAttribute ? prev.getAttribute('class') : '') || '';
            if (tagName === 'LABEL' || /label|title|heading/i.test(className)) {
                // Ensure this preceding label is not for a different input id
                const forAttr = prev.getAttribute ? prev.getAttribute('for') : null;
                if (!forAttr || forAttr === el.id) {
                    const text = cleanLabelText(prev.innerText || prev.textContent);
                    if (text) return { label: text, source: 'preceding_sibling' };
                }
            }
            prev = prev.previousElementSibling;
        }

        // 5c. Form Group / Parent Container label text
        if (el.closest) {
            const container = el.closest('.form-group, .form-row, .field, .field-group, .input-group, .control-group, [role="group"]');
            if (container && (!rootDoc || container !== rootDoc.body) && container.querySelectorAll) {
                const labelCandidates = Array.from(container.querySelectorAll('label, .label, .field-label, .control-label, span.title, th'));
                for (const lbl of labelCandidates) {
                    if (lbl === el || (lbl.contains && lbl.contains(el))) continue;
                    // If label has for="..." attribute for another id, skip
                    const forAttr = lbl.getAttribute ? lbl.getAttribute('for') : null;
                    if (forAttr && forAttr !== el.id) continue;
                    // If label wraps another input/select/textarea, skip
                    const innerInput = lbl.querySelector ? lbl.querySelector('input, select, textarea') : null;
                    if (innerInput && innerInput !== el) continue;

                    const text = cleanLabelText(lbl.innerText || lbl.textContent);
                    if (text) return { label: text, source: 'container_label' };
                }
            }
        }

        // 5d. Title attribute
        if (el.getAttribute) {
            const title = el.getAttribute('title');
            if (title && cleanLabelText(title)) {
                return { label: cleanLabelText(title), source: 'title' };
            }
        }

        // 6. Placeholder attribute
        if (el.getAttribute) {
            const placeholder = el.getAttribute('placeholder');
            if (placeholder && cleanLabelText(placeholder)) {
                return { label: cleanLabelText(placeholder), source: 'placeholder' };
            }
        }

        // 7. Humanized name attribute
        if (el.name) {
            const humanizedName = humanizeIdentifier(el.name);
            if (humanizedName) return { label: humanizedName, source: 'name' };
        }

        // 8. Humanized id attribute
        if (el.id) {
            const humanizedId = humanizeIdentifier(el.id);
            if (humanizedId) return { label: humanizedId, source: 'id' };
        }

        return { label: '', source: 'none' };
    }

    /**
     * Extracts individual option label (e.g. for a radio button or checkbox item).
     */
    function detectOptionLabel(el, doc) {
        const rootDoc = doc || (el.ownerDocument || (typeof document !== 'undefined' ? document : null));

        // Explicit label for
        if (el.id && rootDoc && typeof rootDoc.querySelector === 'function') {
            try {
                const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(el.id) : el.id;
                const explicitLabel = rootDoc.querySelector(`label[for="${escapedId}"]`);
                if (explicitLabel) {
                    const text = cleanLabelText(explicitLabel.innerText || explicitLabel.textContent);
                    if (text) return text;
                }
            } catch (e) {}
        }

        // Wrapping label
        if (el.closest) {
            const wrapping = el.closest('label');
            if (wrapping) {
                const clone = wrapping.cloneNode(true);
                const inner = clone.querySelectorAll ? clone.querySelectorAll('input, select, textarea') : [];
                inner.forEach(i => { if (i.remove) i.remove(); });
                const text = cleanLabelText(clone.innerText || clone.textContent);
                if (text) return text;
            }
        }

        // aria-label
        if (el.getAttribute) {
            const ariaLabel = el.getAttribute('aria-label');
            if (ariaLabel && cleanLabelText(ariaLabel)) return cleanLabelText(ariaLabel);
        }

        // Next sibling text / element
        let next = el.nextSibling;
        if (next && (next.nodeType === 3 || next.nodeValue)) { // Text node
            const text = cleanLabelText(next.nodeValue || next.textContent);
            if (text) return text;
        }
        if (el.nextElementSibling) {
            const nextTag = el.nextElementSibling.tagName ? el.nextElementSibling.tagName.toUpperCase() : '';
            if (nextTag === 'SPAN' || nextTag === 'LABEL') {
                const text = cleanLabelText(el.nextElementSibling.innerText || el.nextElementSibling.textContent);
                if (text) return text;
            }
        }

        // Fallback to value or humanized id
        if (el.value && el.value !== 'on') return humanizeIdentifier(el.value);
        if (el.id) return humanizeIdentifier(el.id);
        return '';
    }

    /**
     * Scans and extracts options from a <select> element.
     */
    function extractSelectOptions(selectEl) {
        const options = [];
        const optElements = selectEl.querySelectorAll ? selectEl.querySelectorAll('option') : [];
        
        optElements.forEach(opt => {
            options.push({
                text: cleanLabelText(opt.textContent || opt.innerText || opt.value),
                value: opt.value !== undefined ? opt.value : (opt.getAttribute ? opt.getAttribute('value') : ''),
                selected: !!opt.selected,
                disabled: !!opt.disabled
            });
        });

        return options;
    }

    /**
     * Determines container group label for fieldset or radio/checkbox group.
     */
    function detectGroupLabel(elements, doc) {
        if (!elements || elements.length === 0) return '';
        const firstEl = elements[0];
        const rootDoc = doc || (firstEl.ownerDocument || (typeof document !== 'undefined' ? document : null));

        // Fieldset legend
        if (firstEl.closest) {
            const fieldset = firstEl.closest('fieldset');
            if (fieldset && fieldset.querySelector) {
                const legend = fieldset.querySelector('legend');
                if (legend) {
                    const text = cleanLabelText(legend.innerText || legend.textContent);
                    if (text) return text;
                }
            }

            // Container label (e.g. .form-group > label)
            const container = firstEl.closest('.form-group, .form-row, .field, .field-group, [role="group"]');
            if (container && (!rootDoc || container !== rootDoc.body) && container.querySelector) {
                const groupLabelEl = container.querySelector('label, .label, span.group-title, .form-label');
                if (groupLabelEl) {
                    const text = cleanLabelText(groupLabelEl.innerText || groupLabelEl.textContent);
                    if (text) return text;
                }
            }
        }

        // Humanized shared name
        if (firstEl.name) {
            return humanizeIdentifier(firstEl.name);
        }

        return '';
    }

    /**
     * Extracts full metadata for a standard input, textarea, or ARIA field.
     */
    function extractFieldMetadata(el, doc) {
        const rootDoc = doc || (el.ownerDocument || (typeof document !== 'undefined' ? document : null));
        const tag = el.tagName ? el.tagName.toLowerCase() : 'input';
        const rawType = (el.getAttribute ? el.getAttribute('type') : null) || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : (el.type || 'text'));
        const type = rawType.toLowerCase();

        const labelInfo = detectFieldLabel(el, rootDoc);
        const visible = isElementVisible(el);

        const field = {
            id: el.id || null,
            name: el.name || null,
            type: type,
            tag: tag,
            label: labelInfo.label,
            label_source: labelInfo.source,
            placeholder: (el.getAttribute ? el.getAttribute('placeholder') : null) || null,
            aria_label: (el.getAttribute ? el.getAttribute('aria-label') : null) || null,
            aria_labelledby: (el.getAttribute ? el.getAttribute('aria-labelledby') : null) || null,
            required: !!(el.required || (el.getAttribute && el.getAttribute('aria-required') === 'true')),
            disabled: !!(el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')),
            readonly: !!(el.readOnly || (el.getAttribute && el.getAttribute('aria-readonly') === 'true')),
            value: el.value !== undefined ? el.value : '',
            autocomplete: (el.getAttribute ? el.getAttribute('autocomplete') : null) || null,
            visible: visible,
            selector: getCssSelector(el),
            options: [],
            // Extensible placeholders for Phase 2 semantic mapping
            semantic_field: null,
            confidence: null,
            validation: {
                min: (el.getAttribute ? el.getAttribute('min') : null) || null,
                max: (el.getAttribute ? el.getAttribute('max') : null) || null,
                pattern: (el.getAttribute ? el.getAttribute('pattern') : null) || null,
                maxlength: el.maxLength > 0 && el.maxLength < 1000000 ? el.maxLength : (el.getAttribute ? el.getAttribute('maxlength') : null),
                minlength: el.minLength > 0 ? el.minLength : (el.getAttribute ? el.getAttribute('minlength') : null),
                step: (el.getAttribute ? el.getAttribute('step') : null) || null
            }
        };

        if (tag === 'select') {
            field.multiple = !!(el.multiple || (el.getAttribute && el.getAttribute('multiple') !== null));
            field.options = extractSelectOptions(el);
            if (field.multiple) {
                if (el.selectedOptions) {
                    field.value = Array.from(el.selectedOptions).map(o => o.value);
                } else {
                    field.value = field.options.filter(o => o.selected).map(o => o.value);
                }
            } else {
                const selectedOpt = field.options.find(o => o.selected);
                field.value = selectedOpt ? selectedOpt.value : (el.value || '');
            }
        }

        return field;
    }

    /**
     * Extracts action buttons (<button>, <input type="submit|button|reset">, [role="button"]).
     */
    function extractActionMetadata(el, doc) {
        const rootDoc = doc || (el.ownerDocument || (typeof document !== 'undefined' ? document : null));
        const tag = el.tagName ? el.tagName.toLowerCase() : 'button';
        let type = 'button';

        if (tag === 'button') {
            type = ((el.getAttribute ? el.getAttribute('type') : null) || el.type || 'submit').toLowerCase();
        } else if (tag === 'input') {
            type = ((el.getAttribute ? el.getAttribute('type') : null) || el.type || 'button').toLowerCase();
        }

        let text = cleanLabelText(el.innerText || el.textContent || el.value || (el.getAttribute ? (el.getAttribute('aria-label') || el.getAttribute('title')) : '') || '');
        if (!text && el.id) text = humanizeIdentifier(el.id);
        if (!text && el.name) text = humanizeIdentifier(el.name);

        return {
            id: el.id || null,
            name: el.name || null,
            type: type,
            tag: tag,
            text: text,
            aria_label: (el.getAttribute ? el.getAttribute('aria-label') : null) || null,
            disabled: !!(el.disabled || (el.getAttribute && el.getAttribute('aria-disabled') === 'true')),
            visible: isElementVisible(el),
            selector: getCssSelector(el)
        };
    }

    /**
     * Scans a specific container (e.g. <form> or logical container) and extracts fields and actions.
     */
    function scanContainer(container, doc, options = {}) {
        const rootDoc = doc || (container.ownerDocument || (typeof document !== 'undefined' ? document : null));
        const fields = [];
        const actions = [];

        // Collect all potential input-like and action elements
        const candidateElements = container.querySelectorAll ? Array.from(container.querySelectorAll(
            'input, textarea, select, button, [role="button"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"]'
        )) : [];

        // Group radios by name
        const radioGroups = new Map();
        // Group checkboxes by name (when multiple checkboxes share the same name)
        const checkboxGroups = new Map();
        // Elements already processed as part of a group
        const processedGroupElements = new Set();

        // 1. Identify Radio & Checkbox Groups
        candidateElements.forEach(el => {
            const tag = el.tagName ? el.tagName.toLowerCase() : '';
            const type = ((el.getAttribute ? el.getAttribute('type') : null) || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : (el.type || 'text'))).toLowerCase();

            if (type === 'radio' && el.name) {
                if (!radioGroups.has(el.name)) {
                    radioGroups.set(el.name, []);
                }
                radioGroups.get(el.name).push(el);
            } else if (type === 'checkbox' && el.name) {
                if (!checkboxGroups.has(el.name)) {
                    checkboxGroups.set(el.name, []);
                }
                checkboxGroups.get(el.name).push(el);
            }
        });

        // 2. Process elements in DOM order
        candidateElements.forEach(el => {
            if (processedGroupElements.has(el)) return;

            const tag = el.tagName ? el.tagName.toLowerCase() : '';
            const type = ((el.getAttribute ? el.getAttribute('type') : null) || (tag === 'textarea' ? 'textarea' : tag === 'select' ? 'select' : (el.type || 'text'))).toLowerCase();
            const role = ((el.getAttribute ? el.getAttribute('role') : null) || '').toLowerCase();

            // Ignore hidden inputs if includeHidden is false
            if (type === 'hidden' && !options.includeHidden) {
                return;
            }

            // Buttons & Actions
            if (tag === 'button' || role === 'button' || (tag === 'input' && ['submit', 'button', 'reset', 'image'].includes(type))) {
                actions.push(extractActionMetadata(el, rootDoc));
                return;
            }

            // Radio Groups
            if (type === 'radio' && el.name && radioGroups.has(el.name)) {
                const groupItems = radioGroups.get(el.name);
                groupItems.forEach(item => processedGroupElements.add(item));

                const groupLabel = detectGroupLabel(groupItems, rootDoc) || humanizeIdentifier(el.name);
                const optionsList = groupItems.map(item => ({
                    id: item.id || null,
                    value: item.value,
                    label: detectOptionLabel(item, rootDoc) || item.value,
                    selected: !!item.checked,
                    disabled: !!item.disabled,
                    selector: getCssSelector(item)
                }));

                const checkedItem = groupItems.find(item => item.checked);
                const isRequired = groupItems.some(item => item.required || (item.getAttribute && item.getAttribute('aria-required') === 'true'));
                const isDisabled = groupItems.every(item => item.disabled || (item.getAttribute && item.getAttribute('aria-disabled') === 'true'));

                fields.push({
                    id: el.name ? `${el.name}-group` : (el.id || null),
                    name: el.name,
                    type: 'radio',
                    tag: 'input',
                    label: groupLabel,
                    label_source: 'group_label',
                    placeholder: null,
                    aria_label: (el.getAttribute ? el.getAttribute('aria-label') : null) || null,
                    aria_labelledby: (el.getAttribute ? el.getAttribute('aria-labelledby') : null) || null,
                    required: isRequired,
                    disabled: isDisabled,
                    readonly: false,
                    value: checkedItem ? checkedItem.value : null,
                    options: optionsList,
                    visible: groupItems.some(item => isElementVisible(item)),
                    selector: `input[type="radio"][name="${el.name}"]`,
                    semantic_field: null,
                    confidence: null,
                    validation: { min: null, max: null, pattern: null, maxlength: null, minlength: null, step: null }
                });
                return;
            }

            // Checkbox Groups (when >1 checkbox shares same name)
            if (type === 'checkbox' && el.name && checkboxGroups.has(el.name) && checkboxGroups.get(el.name).length > 1) {
                const groupItems = checkboxGroups.get(el.name);
                groupItems.forEach(item => processedGroupElements.add(item));

                const groupLabel = detectGroupLabel(groupItems, rootDoc) || humanizeIdentifier(el.name);
                const optionsList = groupItems.map(item => ({
                    id: item.id || null,
                    value: item.value,
                    label: detectOptionLabel(item, rootDoc) || item.value,
                    checked: !!item.checked,
                    disabled: !!item.disabled,
                    selector: getCssSelector(item)
                }));

                const checkedValues = groupItems.filter(item => item.checked).map(item => item.value);
                const isRequired = groupItems.some(item => item.required || (item.getAttribute && item.getAttribute('aria-required') === 'true'));
                const isDisabled = groupItems.every(item => item.disabled || (item.getAttribute && item.getAttribute('aria-disabled') === 'true'));

                fields.push({
                    id: el.name ? `${el.name}-group` : (el.id || null),
                    name: el.name,
                    type: 'checkbox_group',
                    tag: 'input',
                    label: groupLabel,
                    label_source: 'group_label',
                    placeholder: null,
                    aria_label: (el.getAttribute ? el.getAttribute('aria-label') : null) || null,
                    aria_labelledby: (el.getAttribute ? el.getAttribute('aria-labelledby') : null) || null,
                    required: isRequired,
                    disabled: isDisabled,
                    readonly: false,
                    value: checkedValues,
                    options: optionsList,
                    visible: groupItems.some(item => isElementVisible(item)),
                    selector: `input[type="checkbox"][name="${el.name}"]`,
                    semantic_field: null,
                    confidence: null,
                    validation: { min: null, max: null, pattern: null, maxlength: null, minlength: null, step: null }
                });
                return;
            }

            // Single Checkbox
            if (type === 'checkbox') {
                const meta = extractFieldMetadata(el, rootDoc);
                meta.checked = !!el.checked;
                meta.value = el.checked ? (el.value || 'on') : '';
                // For single checkbox, fallback label from option label if detectFieldLabel gave empty
                if (!meta.label) {
                    meta.label = detectOptionLabel(el, rootDoc);
                }
                fields.push(meta);
                return;
            }

            // Standard Inputs, Textareas, Selects
            if (['input', 'textarea', 'select'].includes(tag) || role === 'textbox' || role === 'combobox') {
                fields.push(extractFieldMetadata(el, rootDoc));
            }
        });

        return { fields, actions };
    }

    /**
     * Primary API: Scans the entire page or a root DOM node.
     * Identifies all traditional <form> elements and standalone interactive fields.
     */
    function scanPage(rootElement, userOptions = {}) {
        const options = Object.assign({}, activeOptions, userOptions);
        const root = rootElement || (typeof document !== 'undefined' ? document.body : null);
        if (!root) {
            return {
                page: { url: '', title: '', scanned_at: new Date().toISOString() },
                forms: [],
                summary: { total_forms: 0, total_fields: 0, total_actions: 0 }
            };
        }

        const doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
        const pageMeta = {
            url: typeof location !== 'undefined' ? location.href : '',
            title: doc && doc.title ? doc.title : (typeof document !== 'undefined' ? document.title : ''),
            scanned_at: new Date().toISOString()
        };

        const formList = [];
        const formElements = root.querySelectorAll ? Array.from(root.querySelectorAll('form')) : [];
        const coveredElements = new Set();

        // 1. Process explicit <form> elements
        formElements.forEach((formEl, index) => {
            const formId = formEl.id || formEl.name || `form_${index + 1}`;
            const { fields, actions } = scanContainer(formEl, doc, options);
            
            // Mark all inputs in this form as covered
            if (formEl.querySelectorAll) {
                formEl.querySelectorAll('input, textarea, select, button').forEach(el => coveredElements.add(el));
            }

            formList.push({
                form_id: formId,
                form_name: formEl.name || formEl.id || null,
                action: (formEl.getAttribute ? formEl.getAttribute('action') : null) || '',
                method: ((formEl.getAttribute ? formEl.getAttribute('method') : null) || 'GET').toLowerCase(),
                is_virtual: false,
                fields: fields,
                actions: actions
            });
        });

        // 2. Identify standalone fields outside of any <form>
        const allInteractive = root.querySelectorAll ? Array.from(root.querySelectorAll('input, textarea, select, button, [role="button"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"]')) : [];
        const standaloneElements = allInteractive.filter(el => !coveredElements.has(el) && (!el.closest || !el.closest('form')));

        if (standaloneElements.length > 0) {
            // Create a virtual container to scan standalone elements
            const virtualContainer = {
                querySelectorAll: (selector) => {
                    return standaloneElements.filter(el => {
                        try {
                            return el.matches ? el.matches(selector) : true;
                        } catch (e) {
                            return true;
                        }
                    });
                },
                ownerDocument: doc
            };

            const { fields, actions } = scanContainer(virtualContainer, doc, options);
            if (fields.length > 0 || actions.length > 0) {
                formList.push({
                    form_id: formList.length === 0 ? 'form_default' : 'form_standalone',
                    form_name: 'Standalone Fields',
                    action: '',
                    method: 'get',
                    is_virtual: true,
                    fields: fields,
                    actions: actions
                });
            }
        }

        let totalFields = 0;
        let totalActions = 0;
        formList.forEach(f => {
            totalFields += f.fields.length;
            totalActions += f.actions.length;
        });

        const snapshot = {
            page: pageMeta,
            forms: formList,
            summary: {
                total_forms: formList.length,
                total_fields: totalFields,
                total_actions: totalActions
            }
        };

        // Phase 2: Automatically enrich semantic fields if SemanticMapper is present
        let mapper = options.mapper || (typeof window !== 'undefined' ? (window.SemanticMapper || (window.FormFiller && window.FormFiller.SemanticMapper)) : null);
        if (!mapper && typeof require === 'function') {
            try {
                mapper = require('./semantic-mapper.js');
            } catch (e) {
                // Standalone mode without semantic mapper
            }
        }
        if (mapper && typeof mapper.enrichSnapshot === 'function') {
            mapper.enrichSnapshot(snapshot, { inPlace: true });
        }

        cachedSnapshot = snapshot;

        // Expose snapshot for DevTools inspection
        if (typeof window !== 'undefined') {
            window.__FORM_SNAPSHOT__ = snapshot;
        }

        if (options.debug) {
            console.log('[FormScanner] Form Snapshot generated:', snapshot);
        }

        return snapshot;
    }

    /**
     * Returns the cached form snapshot or runs a fresh scan if none exists.
     */
    function getFormSnapshot() {
        if (!cachedSnapshot) {
            return scanPage();
        }
        return cachedSnapshot;
    }

    /**
     * Starts dynamic DOM observation using MutationObserver with debouncing.
     */
    function startAutoScan(options = {}) {
        activeOptions = Object.assign({}, activeOptions, options);

        if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') {
            if (activeOptions.debug) {
                console.warn('[FormScanner] MutationObserver is not available in this environment.');
            }
            return;
        }

        stopAutoScan(); // Clear any existing observer

        const targetNode = options.root || (typeof document !== 'undefined' ? (document.body || document.documentElement) : null);
        if (!targetNode) return;

        const observerCallback = function(mutationsList) {
            // Check if any mutation affects interactive form elements
            let isRelevant = false;
            for (const mutation of mutationsList) {
                if (mutation.type === 'childList') {
                    if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
                        isRelevant = true;
                        break;
                    }
                } else if (mutation.type === 'attributes') {
                    const attr = mutation.attributeName;
                    if (['disabled', 'required', 'hidden', 'style', 'class', 'value', 'type', 'name', 'checked', 'selected', 'aria-hidden', 'aria-disabled'].includes(attr)) {
                        isRelevant = true;
                        break;
                    }
                }
            }

            if (!isRelevant) return;

            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            debounceTimer = setTimeout(() => {
                const snapshot = scanPage(targetNode, activeOptions);
                if (typeof activeOptions.onChange === 'function') {
                    activeOptions.onChange(snapshot);
                }
                if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
                    document.dispatchEvent(new CustomEvent('form-scanner:updated', { detail: { snapshot } }));
                }
            }, activeOptions.debounceMs || 200);
        };

        mutationObserver = new MutationObserver(observerCallback);
        mutationObserver.observe(targetNode, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['disabled', 'required', 'hidden', 'style', 'class', 'value', 'type', 'name', 'checked', 'selected', 'aria-hidden', 'aria-disabled']
        });

        // Run initial scan
        const initialSnapshot = scanPage(targetNode, activeOptions);
        if (typeof activeOptions.onChange === 'function') {
            activeOptions.onChange(initialSnapshot);
        }

        if (activeOptions.debug) {
            console.log('[FormScanner] Dynamic MutationObserver active.');
        }

        return initialSnapshot;
    }

    /**
     * Stops dynamic observation and cleans up listeners.
     */
    function stopAutoScan() {
        if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }
    }

    return {
        scanPage,
        getFormSnapshot,
        startAutoScan,
        stopAutoScan,
        cleanLabelText,
        humanizeIdentifier,
        detectFieldLabel,
        isElementVisible
    };
});
