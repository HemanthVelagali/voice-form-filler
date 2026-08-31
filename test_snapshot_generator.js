/**
 * HTML Parser & Form Snapshot Generator
 * Loads HTML files, constructs DOM tree, and executes FormScanner.scanPage()
 */

const fs = require('fs');
const path = require('path');
const FormScanner = require('./form/scanner.js');

// HTML tokenizer & DOM tree builder
class DomElement {
    constructor(tagName, attrs = {}, text = '') {
        this.tagName = tagName.toUpperCase();
        this.nodeType = 1;
        this.attributes = attrs;
        this.textContent = text;
        this.innerText = text;
        this.children = [];
        this.parentElement = null;
        this.id = attrs.id || '';
        this.name = attrs.name || '';
        this.type = attrs.type || (this.tagName === 'TEXTAREA' ? 'textarea' : this.tagName === 'SELECT' ? 'select' : (this.tagName === 'BUTTON' ? 'submit' : 'text'));
        this.value = attrs.value !== undefined ? attrs.value : '';
        this.required = attrs.required !== undefined;
        this.disabled = attrs.disabled !== undefined;
        this.readOnly = attrs.readonly !== undefined;
        this.checked = attrs.checked !== undefined;
        this.selected = attrs.selected !== undefined;
        this.multiple = attrs.multiple !== undefined;
    }

    getAttribute(name) {
        return this.attributes[name] !== undefined ? this.attributes[name] : null;
    }

    appendChild(child) {
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    get previousElementSibling() {
        if (!this.parentElement) return null;
        const siblings = this.parentElement.children;
        const idx = siblings.indexOf(this);
        return idx > 0 ? siblings[idx - 1] : null;
    }

    get nextElementSibling() {
        if (!this.parentElement) return null;
        const siblings = this.parentElement.children;
        const idx = siblings.indexOf(this);
        return idx !== -1 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
    }

    get nextSibling() {
        return this.nextElementSibling;
    }

    closest(selector) {
        let curr = this;
        while (curr) {
            if (curr.matches(selector)) return curr;
            curr = curr.parentElement;
        }
        return null;
    }

    cloneNode(deep = true) {
        const clone = new DomElement(this.tagName, Object.assign({}, this.attributes), this.textContent);
        if (deep) {
            this.children.forEach(c => clone.appendChild(c.cloneNode(true)));
        }
        return clone;
    }

    matchesSingle(selector) {
        if (!selector) return false;
        let s = selector.trim();
        if (!s) return false;

        if (s.includes('[') && s.includes(']')) {
            const tagPart = s.split('[')[0].trim();
            if (tagPart && tagPart.toUpperCase() !== this.tagName) {
                return false;
            }
            const attrMatch = s.match(/\[([a-zA-Z0-9_-]+)(?:="?([^"\]]*)"?)?\]/);
            if (attrMatch) {
                const attrName = attrMatch[1];
                const expectedVal = attrMatch[2];
                const actualVal = this.getAttribute(attrName);
                if (expectedVal !== undefined) {
                    return actualVal === expectedVal;
                }
                return actualVal !== null;
            }
        }

        if (s.startsWith('#')) return this.id === s.slice(1);
        if (s.startsWith('.')) {
            const cls = this.attributes.class || this.className || '';
            return cls.split(/\s+/).includes(s.slice(1));
        }

        const tag = s.split(/[\s\.#\[]/)[0];
        if (tag && tag.toUpperCase() === this.tagName) return true;
        return false;
    }

    matches(selector) {
        if (!selector) return false;
        const parts = selector.split(',').map(p => p.trim());
        return parts.some(p => this.matchesSingle(p));
    }

    querySelectorAll(selector) {
        const results = [];
        const self = this;

        function traverse(node) {
            for (const child of node.children) {
                if (child.matches(selector)) {
                    results.push(child);
                }
                traverse(child);
            }
        }
        traverse(self);
        return results;
    }

    querySelector(selector) {
        const list = this.querySelectorAll(selector);
        return list.length > 0 ? list[0] : null;
    }
}

function parseHtml(html) {
    // Strip script and style blocks
    const cleanHtml = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    const root = new DomElement('body');
    const stack = [root];
    const tagRegex = /<\/?([a-zA-Z0-9_-]+)([^>]*)>|([^<]+)/g;
    let match;

    const voidTags = new Set(['INPUT', 'IMG', 'BR', 'HR', 'META', 'LINK']);

    while ((match = tagRegex.exec(cleanHtml)) !== null) {
        const [full, tagName, attrString, textContent] = match;

        if (textContent) {
            const trimmed = textContent.trim();
            if (trimmed && stack.length > 0) {
                stack[stack.length - 1].textContent += ' ' + trimmed;
                stack[stack.length - 1].innerText += ' ' + trimmed;
            }
            continue;
        }

        if (full.startsWith('</')) {
            // Closing tag
            const tagUpper = tagName.toUpperCase();
            for (let i = stack.length - 1; i > 0; i--) {
                if (stack[i].tagName === tagUpper) {
                    stack.splice(i);
                    break;
                }
            }
        } else {
            // Opening tag
            const attrs = {};
            const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
            let aMatch;
            while ((aMatch = attrRegex.exec(attrString || '')) !== null) {
                const attrName = aMatch[1].toLowerCase();
                const val = aMatch[2] !== undefined ? aMatch[2] : (aMatch[3] !== undefined ? aMatch[3] : (aMatch[4] !== undefined ? aMatch[4] : ''));
                attrs[attrName] = val;
            }

            const elem = new DomElement(tagName, attrs);
            if (stack.length > 0) {
                stack[stack.length - 1].appendChild(elem);
            }

            if (!voidTags.has(tagName.toUpperCase()) && !full.endsWith('/>')) {
                stack.push(elem);
            }
        }
    }

    return root;
}

if (require.main === module) {
    // 1. Scan voice-form.html
    const voiceFormHtml = fs.readFileSync(path.join(__dirname, 'voice-form.html'), 'utf8');
    const voiceFormDom = parseHtml(voiceFormHtml);
    const voiceFormSnapshot = FormScanner.scanPage(voiceFormDom);

    console.log('=== VOICE-FORM.HTML SNAPSHOT ===');
    console.log(JSON.stringify(voiceFormSnapshot, null, 2));

    // 2. Scan form-test.html
    const formTestHtml = fs.readFileSync(path.join(__dirname, 'form-test.html'), 'utf8');
    const formTestDom = parseHtml(formTestHtml);
    const formTestSnapshot = FormScanner.scanPage(formTestDom);

    console.log('\n=== FORM-TEST.HTML SNAPSHOT ===');
    console.log(JSON.stringify(formTestSnapshot, null, 2));
}

module.exports = { parseHtml, DomElement };
