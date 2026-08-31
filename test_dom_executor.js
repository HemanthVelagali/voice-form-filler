/**
 * Automated Unit Test Suite for DOMExecutor (Phase 6)
 * Runs in Node.js using a lightweight JSDOM mock.
 */

// Minimal DOM mock for Node.js testing
class MockElement {
    constructor(tag, attrs = {}) {
        this.tagName = tag.toUpperCase();
        this.id = attrs.id || '';
        this.name = attrs.name || '';
        this.type = attrs.type || 'text';
        this.value = '';
        this.checked = false;
        this.required = attrs.required || false;
        this.options = [];
        this._events = {};
        this.shadowRoot = null;
        this.classList = {
            _list: new Set(),
            add: (c) => this.classList._list.add(c),
            remove: (c) => this.classList._list.delete(c),
            contains: (c) => this.classList._list.has(c)
        };
        this.style = {};
        this.parentElement = null;
        Object.assign(this, attrs);
    }
    dispatchEvent(ev) {
        const handlers = this._events[ev.type] || [];
        handlers.forEach(h => h(ev));
        return true;
    }
    addEventListener(type, handler) {
        this._events[type] = this._events[type] || [];
        this._events[type].push(handler);
    }
    focus() { this._focused = true; }
    scrollIntoView() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest() { return this.parentElement; }
    get parentNode() { return this.parentElement; }
}

class MockSelect extends MockElement {
    constructor(attrs = {}) {
        super('select', attrs);
        this.options = [];
        this.tagName = 'SELECT';
    }
    addOption(text, value) {
        this.options.push({ text, value, selected: false });
    }
    get selectedIndex() {
        return this.options.findIndex(o => o.value === this.value);
    }
}

// Minimal document mock
const mockElements = new Map();
const mockDocument = {
    getElementById: (id) => mockElements.get('id:' + id) || null,
    querySelector:  (sel) => {
        if (sel.startsWith('[name="')) {
            const name = sel.slice(7, -2);
            return mockElements.get('name:' + name) || null;
        }
        if (sel.startsWith('input[type="radio"][name="')) {
            // handled by querySelectorAll
        }
        return null;
    },
    querySelectorAll: (sel) => {
        const results = [];
        if (sel.startsWith('input[type="radio"][name="')) {
            const name = sel.match(/name="([^"]+)"/)[1];
            for (const [k, el] of mockElements) {
                if (el.type === 'radio' && el.name === name) results.push(el);
            }
        }
        return results;
    }
};

function registerEl(el) {
    if (el.id)   mockElements.set('id:' + el.id, el);
    if (el.name) mockElements.set('name:' + el.name, el);
}

// Inject globals so dom-executor.js can run in Node
global.document = mockDocument;
global.window   = { FormFiller: {} };
global.HTMLInputElement    = { prototype: { value: '' } };
global.HTMLTextAreaElement = { prototype: { value: '' } };
global.HTMLElement = { prototype: { attachShadow: () => {} } };
global.customElements = {};
global.Event = class Event {
    constructor(type, opts = {}) {
        this.type = type;
        this.bubbles = opts.bubbles || false;
        this.cancelable = opts.cancelable || false;
    }
    preventDefault() { this._defaultPrevented = true; }
};
global.InputEvent = global.Event;
global.Element = MockElement;

const DOMExecutor = require('./form/dom-executor.js');

let passed = 0, failed = 0;

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function runTest(num, title, fn) {
    try {
        fn();
        console.log(`✔ [Test ${num}] PASSED: ${title}`);
        passed++;
    } catch (e) {
        console.error(`✖ [Test ${num}] FAILED: ${title}`);
        console.error(`    Error: ${e.message}`);
        failed++;
    }
}

console.log('====================================================');
console.log('  DOM Executor Phase 6 Verification Suite');
console.log('====================================================\n');

// Test 1: setValue on text input
runTest(1, 'setValue sets value on a plain text input and fires events', () => {
    const el = new MockElement('input', { id: 'fname', type: 'text' });
    registerEl(el);
    const events = [];
    el.addEventListener('input',  () => events.push('input'));
    el.addEventListener('change', () => events.push('change'));

    const ok = DOMExecutor.setValue('fname', 'Barack Obama');
    assert(ok, 'setValue should return true');
    assert(el.value === 'Barack Obama', `Expected Barack Obama, got ${el.value}`);
    assert(events.includes('input'),  'input event should fire');
    assert(events.includes('change'), 'change event should fire');
});

// Test 2: setValue by name attribute
runTest(2, 'setValue resolves element by name attribute', () => {
    const el = new MockElement('input', { id: 'em1', name: 'email', type: 'email' });
    registerEl(el);
    const ok = DOMExecutor.setValue('email', 'user@gmail.com');
    assert(ok, 'setValue should return true');
    assert(el.value === 'user@gmail.com', `Expected user@gmail.com, got ${el.value}`);
});

// Test 3: selectOption by value
runTest(3, 'selectOption selects correct option by value', () => {
    const sel = new MockSelect({ id: 'country' });
    sel.addOption('India', 'IN');
    sel.addOption('United States', 'US');
    sel.addOption('United Kingdom', 'UK');
    registerEl(sel);
    const events = [];
    sel.addEventListener('change', () => events.push('change'));

    const ok = DOMExecutor.selectOption('country', 'IN');
    assert(ok, 'selectOption should return true');
    assert(sel.value === 'IN', `Expected IN, got ${sel.value}`);
    assert(events.includes('change'), 'change event should fire');
});

// Test 4: selectOption by display text (case-insensitive)
runTest(4, 'selectOption matches option by display text (case-insensitive)', () => {
    const sel = new MockSelect({ id: 'country2' });
    sel.addOption('India', 'IN');
    sel.addOption('United States', 'US');
    registerEl(sel);

    const ok = DOMExecutor.selectOption('country2', 'india');
    assert(ok, 'selectOption by text should return true');
    assert(sel.value === 'IN', `Expected IN, got ${sel.value}`);
});

// Test 5: selectOption partial text match
runTest(5, 'selectOption matches option by partial text', () => {
    const sel = new MockSelect({ id: 'country3' });
    sel.addOption('United Kingdom', 'UK');
    sel.addOption('United States', 'US');
    registerEl(sel);

    const ok = DOMExecutor.selectOption('country3', 'kingdom');
    assert(ok, 'selectOption partial text should return true');
    assert(sel.value === 'UK', `Expected UK, got ${sel.value}`);
});

// Test 6: setRadio by value
runTest(6, 'setRadio checks correct radio button by value', () => {
    const r1 = new MockElement('input', { id: 'g1', name: 'gender', type: 'radio', value: 'male' });
    const r2 = new MockElement('input', { id: 'g2', name: 'gender', type: 'radio', value: 'female' });
    registerEl(r1);
    registerEl(r2);
    mockElements.set('id:g1', r1);
    mockElements.set('id:g2', r2);

    const events = [];
    r1.addEventListener('change', () => events.push('change-male'));
    const ok = DOMExecutor.setRadio('gender', 'male');
    assert(ok, 'setRadio should return true');
    assert(r1.checked === true,  'male radio should be checked');
    assert(r2.checked === false, 'female radio should not be checked');
    assert(events.includes('change-male'), 'change event should fire on male radio');
});

// Test 7: setCheckbox
runTest(7, 'setCheckbox checks and unchecks a checkbox', () => {
    const cb = new MockElement('input', { id: 'terms', name: 'terms', type: 'checkbox' });
    registerEl(cb);
    const events = [];
    cb.addEventListener('change', () => events.push('change'));

    DOMExecutor.setCheckbox('terms', true);
    assert(cb.checked === true, 'Checkbox should be checked');
    assert(events.length > 0, 'change event should fire');

    DOMExecutor.setCheckbox('terms', false);
    assert(cb.checked === false, 'Checkbox should be unchecked');
});

// Test 8: clearField
runTest(8, 'clearField resets value to empty string', () => {
    const el = new MockElement('input', { id: 'clrtest', type: 'text' });
    registerEl(el);
    el.value = 'something';
    DOMExecutor.clearField('clrtest');
    assert(el.value === '', `Expected empty string, got "${el.value}"`);
});

// Test 9: setValue returns false for non-existent element
runTest(9, 'setValue returns false gracefully when element does not exist', () => {
    const ok = DOMExecutor.setValue('nonexistent_xyz_987', 'value');
    assert(ok === false, 'Should return false for missing element');
});

// Test 10: detect() returns framework flags object
runTest(10, 'detect() returns a framework detection object with expected keys', () => {
    const flags = DOMExecutor.detect();
    assert(typeof flags === 'object', 'detect should return an object');
    assert('react'     in flags, 'should have react key');
    assert('vue'       in flags, 'should have vue key');
    assert('angular'   in flags, 'should have angular key');
    assert('shadowDom' in flags, 'should have shadowDom key');
    assert(typeof flags.react === 'boolean', 'react flag should be boolean');
});

console.log('\n====================================================');
console.log(`  Test Run Complete: ${passed} Passed, ${failed} Failed`);
console.log('====================================================\n');

if (failed > 0) process.exit(1);
