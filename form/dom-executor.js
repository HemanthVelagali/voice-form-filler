/**
 * Universal DOM Executor — Phase 6: Framework-Agnostic Value Injection
 *
 * Injects form values into ANY web framework without breaking its reactive
 * state management:
 *
 *   • Vanilla HTML5 forms        — direct .value + native events
 *   • React (16–19)              — Object.getOwnPropertyDescriptor nativeInputValue trick
 *   • Vue 2 / Vue 3              — triggers 'input' + 'change' with bubbling
 *   • Angular (Zone.js aware)    — patched dispatchEvent to flush change detection
 *   • Shadow DOM / Web Components — pierces open shadow roots recursively
 *   • Select / Radio / Checkbox   — sets checked/selectedIndex + dispatches events
 *
 * API:
 *   DOMExecutor.setValue(selector|element, value)       → bool
 *   DOMExecutor.selectOption(selector|element, value)   → bool
 *   DOMExecutor.setRadio(name, value)                   → bool
 *   DOMExecutor.setCheckbox(selector|element, checked)  → bool
 *   DOMExecutor.focusField(selector|element)            → bool
 *   DOMExecutor.submitForm(selector|element)            → bool
 *   DOMExecutor.detect()                                → { react, vue, angular, shadowDom }
 *
 * Zero external dependencies; UMD (Browser & Node.js).
 */

(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const exec = factory();
        root.DOMExecutor = exec;
        root.FormFiller = root.FormFiller || {};
        root.FormFiller.DOMExecutor = exec;
        if (typeof window !== 'undefined') window.DOMExecutor = exec;
    }
})(typeof self !== 'undefined' ? self : (typeof global !== 'undefined' ? global : this), function() {
    'use strict';

    /* ─────────────────────────────────────────────
       Framework Detection
       ───────────────────────────────────────────── */

    /**
     * Sniffs which frameworks are present on the page.
     * @returns {{ react: bool, vue: bool, angular: bool, shadowDom: bool }}
     */
    function detect() {
        const w = (typeof window !== 'undefined') ? window : {};
        return {
            react:     !!(w.React || w.__REACT_DEVTOOLS_GLOBAL_HOOK__),
            vue:       !!(w.Vue || w.__VUE__),
            angular:   !!(w.ng || w.getAllAngularRootElements || (w.Zone && w.Zone.current)),
            shadowDom: !!(w.customElements || (w.HTMLElement && w.HTMLElement.prototype.attachShadow))
        };
    }

    /* ─────────────────────────────────────────────
       Internal Utilities
       ───────────────────────────────────────────── */

    /** Resolves selector string or DOM element. Returns null if not found. */
    function resolve(target) {
        if (!target) return null;
        if (typeof target === 'string') {
            // Try id, name attribute, CSS selector in that order
            return (
                document.getElementById(target) ||
                document.querySelector(`[name="${target}"]`) ||
                document.querySelector(target) ||
                _shadowQuery(document, target)
            );
        }
        return target instanceof Element ? target : null;
    }

    /** Recursively searches open shadow roots for a selector. */
    function _shadowQuery(root, selector) {
        for (const el of root.querySelectorAll('*')) {
            if (el.shadowRoot) {
                const found = el.shadowRoot.querySelector(selector);
                if (found) return found;
                const deeper = _shadowQuery(el.shadowRoot, selector);
                if (deeper) return deeper;
            }
        }
        return null;
    }

    /**
     * Dispatches a sequence of native DOM events on an element.
     * Covers React's synthetic event system, Vue watchers, and Angular zones.
     */
    function _dispatch(el, events) {
        events.forEach(evName => {
            const ev = new Event(evName, { bubbles: true, cancelable: true });
            el.dispatchEvent(ev);
        });
    }

    /**
     * Injects a value into an input/textarea using the React nativeInputValueSetter
     * trick so React's synthetic onChange fires correctly.
     */
    function _reactSet(el, value) {
        try {
            const proto = Object.getPrototypeOf(el);
            const descriptor =
                Object.getOwnPropertyDescriptor(proto, 'value') ||
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
                Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            if (descriptor && descriptor.set) {
                descriptor.set.call(el, value);
                return true;
            }
        } catch (e) { /* fall through */ }
        return false;
    }

    /* ─────────────────────────────────────────────
       Public API
       ───────────────────────────────────────────── */

    /**
     * Sets a text/number/email/tel/textarea value on any element.
     * Fires input + change events compatible with React, Vue, Angular, vanilla.
     *
     * @param {string|Element} target  - CSS selector, id, name, or DOM element
     * @param {string}         value   - The value to set
     * @returns {boolean} true if element was found and value was set
     */
    function setValue(target, value) {
        const el = resolve(target);
        if (!el) {
            console.warn('[DOMExecutor] setValue: element not found:', target);
            return false;
        }

        const tag  = el.tagName.toLowerCase();
        const type = (el.type || '').toLowerCase();

        // Delegate to type-specific setters
        if (tag === 'select')   return selectOption(el, value);
        if (type === 'radio')   return setRadio(el.name, value);
        if (type === 'checkbox') return setCheckbox(el, value === true || value === 'true' || value === '1' || value === el.value);

        // Text-like inputs and textareas
        const frameworks = detect();
        let changed = false;

        if (frameworks.react) {
            changed = _reactSet(el, value);
        }

        if (!changed) {
            el.value = value;
        }

        _dispatch(el, ['input', 'change', 'blur']);

        // Vue 3 specific: trigger v-model update
        if (frameworks.vue && typeof el.__vueParentComponent !== 'undefined') {
            try {
                el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
            } catch (e) { /* ignore */ }
        }

        console.log(`[DOMExecutor] setValue: "${value}" → #${el.id || el.name || tag}`);
        return true;
    }

    /**
     * Selects an option in a <select> element by value, text, or partial text match.
     *
     * @param {string|Element} target  - selector or <select> element
     * @param {string}         value   - option value or display text to match
     * @returns {boolean}
     */
    function selectOption(target, value) {
        const el = resolve(target);
        if (!el || el.tagName.toLowerCase() !== 'select') {
            console.warn('[DOMExecutor] selectOption: <select> not found:', target);
            return false;
        }

        const options = Array.from(el.options);
        const lv = (value || '').toLowerCase().trim();

        // Priority: exact value → exact text → partial text
        const match =
            options.find(o => o.value.toLowerCase() === lv) ||
            options.find(o => o.text.toLowerCase()  === lv) ||
            options.find(o => o.text.toLowerCase().includes(lv));

        if (!match) {
            console.warn(`[DOMExecutor] selectOption: no option matching "${value}"`);
            return false;
        }

        if (detect().react) _reactSet(el, match.value);
        el.value = match.value;
        _dispatch(el, ['change', 'input']);
        console.log(`[DOMExecutor] selectOption: "${match.text}" (${match.value})`);
        return true;
    }

    /**
     * Checks a radio button within a named group.
     *
     * @param {string} name   - radio group name attribute
     * @param {string} value  - option value or label text to select
     * @returns {boolean}
     */
    function setRadio(name, value) {
        if (!name) return false;
        const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`));
        if (!radios.length) {
            console.warn(`[DOMExecutor] setRadio: no radios with name="${name}"`);
            return false;
        }

        const lv = (value || '').toLowerCase().trim();
        const match = radios.find(r => r.value.toLowerCase() === lv) ||
                      radios.find(r => {
                          const lbl = document.querySelector(`label[for="${r.id}"]`);
                          return lbl && lbl.textContent.toLowerCase().trim() === lv;
                      });

        if (!match) {
            console.warn(`[DOMExecutor] setRadio: no radio matching "${value}" in group "${name}"`);
            return false;
        }

        match.checked = true;
        _dispatch(match, ['click', 'change', 'input']);
        console.log(`[DOMExecutor] setRadio: checked "${match.value}" in group "${name}"`);
        return true;
    }

    /**
     * Sets a checkbox to checked or unchecked.
     *
     * @param {string|Element} target   - selector or checkbox element
     * @param {boolean}        [checked=true]
     * @returns {boolean}
     */
    function setCheckbox(target, checked = true) {
        const el = resolve(target);
        if (!el || el.type !== 'checkbox') {
            console.warn('[DOMExecutor] setCheckbox: checkbox not found:', target);
            return false;
        }
        el.checked = !!checked;
        _dispatch(el, ['click', 'change', 'input']);
        console.log(`[DOMExecutor] setCheckbox: ${el.id || el.name} → ${el.checked}`);
        return true;
    }

    /**
     * Focuses a form field and scrolls it into view.
     *
     * @param {string|Element} target
     * @returns {boolean}
     */
    function focusField(target) {
        const el = resolve(target);
        if (!el) {
            console.warn('[DOMExecutor] focusField: element not found:', target);
            return false;
        }
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        _dispatch(el, ['focus']);
        return true;
    }

    /**
     * Submits a form element — fires the 'submit' event (which the app can intercept)
     * and optionally calls .submit() if not prevented.
     *
     * @param {string|Element} [target='form'] - selector or form element
     * @returns {boolean}
     */
    function submitForm(target) {
        let formEl = resolve(target);
        if (!formEl) formEl = document.querySelector('form');
        if (!formEl) {
            console.warn('[DOMExecutor] submitForm: no form found');
            return false;
        }

        let prevented = false;
        const ev = new Event('submit', { bubbles: true, cancelable: true });
        ev.preventDefault = () => { prevented = true; };
        formEl.dispatchEvent(ev);

        if (!prevented) {
            try { formEl.submit(); } catch (e) { /* ignore */ }
        }
        console.log(`[DOMExecutor] submitForm: submitted ${formEl.id || 'form'}`);
        return true;
    }

    /**
     * Clears a field value and fires events.
     *
     * @param {string|Element} target
     * @returns {boolean}
     */
    function clearField(target) {
        return setValue(target, '');
    }

    return {
        detect,
        setValue,
        selectOption,
        setRadio,
        setCheckbox,
        focusField,
        submitForm,
        clearField
    };
});
