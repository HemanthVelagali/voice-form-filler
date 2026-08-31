/**
 * Automated CLI Unit Test Suite for Form Scanner (Phase 1)
 */

const FormScanner = require('./form/scanner.js');

// Robust Mock DOM for CLI verification
class MockNode {
    constructor(tagName = 'div', attrs = {}, textContent = '') {
        this.tagName = tagName.toUpperCase();
        this.nodeType = 1;
        this.attributes = Object.assign({}, attrs);
        this.textContent = textContent;
        this.innerText = textContent;
        this.children = [];
        this.parentElement = null;
        this.ownerDocument = null;
        this.id = attrs.id || '';
        this.name = attrs.name || '';
        this.type = attrs.type || (this.tagName === 'TEXTAREA' ? 'textarea' : this.tagName === 'SELECT' ? 'select' : (this.tagName === 'BUTTON' ? 'submit' : 'text'));
        this.value = attrs.value !== undefined ? attrs.value : '';
        this.required = !!attrs.required;
        this.disabled = !!attrs.disabled;
        this.readOnly = !!attrs.readonly;
        this.checked = !!attrs.checked;
        this.selected = !!attrs.selected;
        this.multiple = !!attrs.multiple;
    }

    getAttribute(name) {
        return this.attributes[name] !== undefined ? this.attributes[name] : null;
    }

    setAttribute(name, val) {
        this.attributes[name] = val;
        if (name === 'id') this.id = val;
        if (name === 'name') this.name = val;
        if (name === 'type') this.type = val;
        if (name === 'value') this.value = val;
    }

    appendChild(child) {
        child.parentElement = this;
        child.ownerDocument = this.ownerDocument || this;
        this.children.push(child);
        return child;
    }

    remove() {
        if (this.parentElement) {
            const idx = this.parentElement.children.indexOf(this);
            if (idx !== -1) {
                this.parentElement.children.splice(idx, 1);
            }
        }
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
        const clone = new MockNode(this.tagName, Object.assign({}, this.attributes), this.textContent);
        if (deep) {
            this.children.forEach(c => clone.appendChild(c.cloneNode(true)));
        }
        return clone;
    }

    matchesSingle(selector) {
        if (!selector) return false;
        let s = selector.trim();
        if (!s) return false;

        // Attribute selector e.g. label[for="input1"] or [role="button"] or input[type="radio"]
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

class MockDocument {
    constructor() {
        this.body = new MockNode('body');
        this.body.ownerDocument = this;
    }
    getElementById(id) {
        return this.body.querySelector(`#${id}`);
    }
    querySelector(sel) {
        return this.body.querySelector(sel);
    }
    querySelectorAll(sel) {
        return this.body.querySelectorAll(sel);
    }
}

// Test runner
let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

async function runTest(num, title, fn) {
    try {
        await fn();
        console.log(`✔ [Test ${num}] PASSED: ${title}`);
        passed++;
    } catch (e) {
        console.error(`✖ [Test ${num}] FAILED: ${title}`);
        console.error(`    Error: ${e.message}`);
        failed++;
    }
}

async function runAllTests() {
    console.log('====================================================');
    console.log('  Form Scanner Phase 1 Automated Verification Suite');
    console.log('====================================================\n');

    // Test 1: Arbitrary field names
    await runTest(1, 'Detects arbitrary/varied field names without hardcoding', () => {
        const doc = new MockDocument();
        const form = doc.body.appendChild(new MockNode('form', { id: 'testForm1' }));
        form.appendChild(new MockNode('input', { id: 'f1', name: 'fname', type: 'text' }));
        form.appendChild(new MockNode('input', { id: 'f2', name: 'given_name', type: 'text' }));
        form.appendChild(new MockNode('input', { id: 'f3', name: 'candidate_first_name', type: 'text' }));
        form.appendChild(new MockNode('input', { id: 'f4', name: 'applicantFirstName', type: 'text' }));

        const snap = FormScanner.scanPage(doc.body);
        assert(snap.forms.length === 1, 'Should find 1 form');
        assert(snap.forms[0].fields.length === 4, `Expected 4 fields, got ${snap.forms[0].fields.length}`);
        const names = snap.forms[0].fields.map(f => f.name);
        assert(names.includes('fname') && names.includes('given_name') && names.includes('candidate_first_name') && names.includes('applicantFirstName'), 'All varied names must be detected');
    });

    // Test 2: Label resolution priorities
    await runTest(2, 'Intelligent label detection with prioritized resolution', () => {
        const doc = new MockDocument();
        const form = doc.body.appendChild(new MockNode('form', { id: 'testForm2' }));

        // 1. label for
        form.appendChild(new MockNode('label', { for: 'input1' }, 'Explicit First Name: *'));
        form.appendChild(new MockNode('input', { id: 'input1', name: 'inp1', type: 'text' }));

        // 2. wrapping label
        const wrap = form.appendChild(new MockNode('label', {}, 'Wrapped Email Label '));
        wrap.appendChild(new MockNode('input', { id: 'input2', name: 'inp2', type: 'email' }));

        // 3. aria-label
        form.appendChild(new MockNode('input', { id: 'input3', name: 'inp3', type: 'tel', 'aria-label': 'Mobile Number' }));

        // 4. aria-labelledby
        form.appendChild(new MockNode('span', { id: 'citySpan' }, 'Residential City'));
        form.appendChild(new MockNode('input', { id: 'input4', name: 'inp4', type: 'text', 'aria-labelledby': 'citySpan' }));

        // 5. placeholder fallback
        form.appendChild(new MockNode('input', { id: 'input5', name: 'inp5', type: 'text', placeholder: 'Enter your zip code' }));

        const snap = FormScanner.scanPage(doc.body);
        const fields = snap.forms[0].fields;

        const f1 = fields.find(f => f.name === 'inp1');
        assert(f1 && f1.label === 'Explicit First Name', `Expected 'Explicit First Name', got '${f1 ? f1.label : 'null'}' (source: ${f1 ? f1.label_source : ''})`);
        assert(f1.label_source === 'label_for', `Label source should be label_for, got ${f1.label_source}`);

        const f2 = fields.find(f => f.name === 'inp2');
        assert(f2 && f2.label === 'Wrapped Email Label', `Expected 'Wrapped Email Label', got '${f2 ? f2.label : 'null'}'`);
        assert(f2.label_source === 'wrapping_label', 'Label source should be wrapping_label');

        const f3 = fields.find(f => f.name === 'inp3');
        assert(f3 && f3.label === 'Mobile Number', `Expected 'Mobile Number', got '${f3 ? f3.label : 'null'}'`);
        assert(f3.label_source === 'aria_label', 'Label source should be aria_label');

        const f4 = fields.find(f => f.name === 'inp4');
        assert(f4 && f4.label === 'Residential City', `Expected 'Residential City', got '${f4 ? f4.label : 'null'}'`);
        assert(f4.label_source === 'aria_labelledby', 'Label source should be aria_labelledby');

        const f5 = fields.find(f => f.name === 'inp5');
        assert(f5 && f5.label === 'Enter your zip code', `Expected 'Enter your zip code', got '${f5 ? f5.label : 'null'}'`);
        assert(f5.label_source === 'placeholder', 'Label source should be placeholder');
    });

    // Test 3: Select elements (single & multiple)
    await runTest(3, 'Select fields extracted with options, selection states, and multi-select', () => {
        const doc = new MockDocument();
        const form = doc.body.appendChild(new MockNode('form', { id: 'testForm3' }));

        const sel1 = form.appendChild(new MockNode('select', { id: 'country', name: 'country' }));
        sel1.appendChild(new MockNode('option', { value: 'IN', selected: true }, 'India'));
        sel1.appendChild(new MockNode('option', { value: 'US' }, 'United States'));
        sel1.appendChild(new MockNode('option', { value: 'UK', disabled: true }, 'United Kingdom'));

        const sel2 = form.appendChild(new MockNode('select', { id: 'roles', name: 'roles', multiple: true }));
        sel2.appendChild(new MockNode('option', { value: 'fe', selected: true }, 'Frontend'));
        sel2.appendChild(new MockNode('option', { value: 'be', selected: true }, 'Backend'));

        const snap = FormScanner.scanPage(doc.body);
        const country = snap.forms[0].fields.find(f => f.name === 'country');
        assert(country && country.type === 'select', 'Country select must be present');
        assert(country.options.length === 3, 'Country should have 3 options');
        assert(country.options[0].text === 'India' && country.options[0].selected === true, 'Option 0 selected');
        assert(country.options[2].disabled === true, 'Option 2 disabled');

        const roles = snap.forms[0].fields.find(f => f.name === 'roles');
        assert(roles && roles.multiple === true, 'Roles should be multi-select');
        assert(roles.options.length === 2, 'Roles should have 2 options');
    });

    // Test 4: Radio button groups
    await runTest(4, 'Radio buttons grouped by name into single logical field with options', () => {
        const doc = new MockDocument();
        const form = doc.body.appendChild(new MockNode('form', { id: 'testForm4' }));

        const fieldset = form.appendChild(new MockNode('fieldset'));
        fieldset.appendChild(new MockNode('legend', {}, 'Gender Identity'));
        fieldset.appendChild(new MockNode('input', { type: 'radio', name: 'gender', value: 'male', id: 'g_m' }));
        fieldset.appendChild(new MockNode('input', { type: 'radio', name: 'gender', value: 'female', id: 'g_f', checked: true }));
        fieldset.appendChild(new MockNode('input', { type: 'radio', name: 'gender', value: 'other', id: 'g_o' }));

        const snap = FormScanner.scanPage(doc.body);
        const formSnap = snap.forms[0];
        assert(formSnap.fields.length === 1, `Expected 1 radio group field, got ${formSnap.fields.length}`);

        const radio = formSnap.fields[0];
        assert(radio.type === 'radio', 'Type should be radio');
        assert(radio.name === 'gender', 'Name should be gender');
        assert(radio.label === 'Gender Identity', `Label should be 'Gender Identity', got '${radio.label}'`);
        assert(radio.value === 'female', `Value should be checked 'female', got '${radio.value}'`);
        assert(radio.options.length === 3, 'Options length should be 3');
    });

    // Test 5: Checkbox grouping vs standalone checkbox
    await runTest(5, 'Checkbox groups vs standalone checkboxes correctly structured', () => {
        const doc = new MockDocument();
        const form = doc.body.appendChild(new MockNode('form', { id: 'testForm5' }));

        // Checkbox Group
        const fieldset = form.appendChild(new MockNode('fieldset'));
        fieldset.appendChild(new MockNode('legend', {}, 'Technical Skills'));
        fieldset.appendChild(new MockNode('input', { type: 'checkbox', name: 'skills', value: 'py', checked: true }));
        fieldset.appendChild(new MockNode('input', { type: 'checkbox', name: 'skills', value: 'js', checked: true }));
        fieldset.appendChild(new MockNode('input', { type: 'checkbox', name: 'skills', value: 'rs' }));

        // Standalone Checkbox
        form.appendChild(new MockNode('input', { type: 'checkbox', id: 'terms', name: 'agree_terms', 'aria-label': 'Accept Terms' }));

        const snap = FormScanner.scanPage(doc.body);
        const fields = snap.forms[0].fields;
        assert(fields.length === 2, `Expected 2 fields (group + single), got ${fields.length}`);

        const group = fields.find(f => f.name === 'skills');
        assert(group && group.type === 'checkbox_group', 'Group type must be checkbox_group');
        assert(group.options.length === 3, 'Group options length must be 3');
        assert(group.value.includes('py') && group.value.includes('js'), 'Group value contains checked items');

        const single = fields.find(f => f.name === 'agree_terms');
        assert(single && single.type === 'checkbox', 'Single type must be checkbox');
        assert(single.label === 'Accept Terms', `Single label should be 'Accept Terms', got '${single.label}'`);
    });

    // Test 6: Validation, required, disabled, readonly
    await runTest(6, 'Captures required, disabled, readonly, and validation constraints', () => {
        const doc = new MockDocument();
        const form = doc.body.appendChild(new MockNode('form', { id: 'testForm6' }));

        form.appendChild(new MockNode('input', { id: 'f1', name: 'req_input', type: 'text', required: true }));
        form.appendChild(new MockNode('input', { id: 'f2', name: 'dis_input', type: 'text', disabled: true }));
        form.appendChild(new MockNode('input', { id: 'f3', name: 'ro_input', type: 'text', readonly: true, value: 'Constant' }));
        form.appendChild(new MockNode('input', { id: 'f4', name: 'val_input', type: 'number', min: '5', max: '50', step: '2' }));

        const snap = FormScanner.scanPage(doc.body);
        const fields = snap.forms[0].fields;

        const f1 = fields.find(f => f.name === 'req_input');
        assert(f1 && f1.required === true, 'f1 required');

        const f2 = fields.find(f => f.name === 'dis_input');
        assert(f2 && f2.disabled === true, 'f2 disabled');

        const f3 = fields.find(f => f.name === 'ro_input');
        assert(f3 && f3.readonly === true, 'f3 readonly');

        const f4 = fields.find(f => f.name === 'val_input');
        assert(f4.validation.min === '5' && f4.validation.max === '50' && f4.validation.step === '2', 'f4 min/max/step');
    });

    // Test 7: Action buttons
    await runTest(7, 'Action buttons with types submit, button, and reset detected', () => {
        const doc = new MockDocument();
        const form = doc.body.appendChild(new MockNode('form', { id: 'testForm7' }));

        form.appendChild(new MockNode('button', { id: 'btnSubmit', type: 'submit' }, 'Submit Application'));
        form.appendChild(new MockNode('button', { id: 'btnNext', type: 'button' }, 'Next'));
        form.appendChild(new MockNode('input', { id: 'btnReset', type: 'reset', value: 'Reset Form' }));

        const snap = FormScanner.scanPage(doc.body);
        const actions = snap.forms[0].actions;
        assert(actions.length === 3, `Expected 3 actions, got ${actions.length}`);

        const a1 = actions.find(a => a.id === 'btnSubmit');
        assert(a1 && a1.type === 'submit' && a1.text === 'Submit Application', 'Submit button mismatch');

        const a2 = actions.find(a => a.id === 'btnNext');
        assert(a2 && a2.type === 'button' && a2.text === 'Next', 'Next button mismatch');

        const a3 = actions.find(a => a.id === 'btnReset');
        assert(a3 && a3.type === 'reset' && a3.text === 'Reset Form', 'Reset button mismatch');
    });

    // Test 8: Dynamic scanner / Rescan
    await runTest(8, 'Dynamic rescan capability after DOM modifications', () => {
        const doc = new MockDocument();
        const form = doc.body.appendChild(new MockNode('form', { id: 'testForm8' }));
        form.appendChild(new MockNode('input', { id: 'dyn1', name: 'country', type: 'text' }));

        const snap1 = FormScanner.scanPage(doc.body);
        assert(snap1.forms[0].fields.length === 1, 'Initial 1 field');

        // Dynamically add a new field
        form.appendChild(new MockNode('input', { id: 'dyn2', name: 'state', type: 'text', placeholder: 'State' }));

        const snap2 = FormScanner.scanPage(doc.body);
        assert(snap2.forms[0].fields.length === 2, 'Rescan captures 2 fields');
        const stateField = snap2.forms[0].fields.find(f => f.name === 'state');
        assert(stateField && stateField.label === 'State', 'New dynamic field has correct label');
    });

    // Test 9: Multiple forms and standalone fields
    await runTest(9, 'Multiple <form> elements and standalone virtual form separation', () => {
        const doc = new MockDocument();
        const f1 = doc.body.appendChild(new MockNode('form', { id: 'appForm' }));
        f1.appendChild(new MockNode('input', { id: 'inpA', name: 'form_a_input' }));

        const f2 = doc.body.appendChild(new MockNode('form', { id: 'feedbackForm' }));
        f2.appendChild(new MockNode('input', { id: 'inpB', name: 'rating' }));

        // Standalone input outside any form
        doc.body.appendChild(new MockNode('input', { id: 'standalone1', name: 'quick_search' }));

        const snap = FormScanner.scanPage(doc.body);
        assert(snap.forms.length === 3, `Expected 3 forms, got ${snap.forms.length}`);
        assert(snap.summary.total_fields === 3, `Expected total 3 fields, got ${snap.summary.total_fields}`);
        
        const formIds = snap.forms.map(f => f.form_id);
        assert(formIds.includes('appForm') && formIds.includes('feedbackForm') && formIds.includes('form_standalone'), 'All 3 form boundaries identified');
    });

    // Test 10: Helper utilities & backward compatibility
    await runTest(10, 'Sanitization, humanization, and backward compatibility exports', () => {
        assert(FormScanner.cleanLabelText('  First Name:  *  ') === 'First Name', 'cleanLabelText cleans colons/asterisks');
        assert(FormScanner.humanizeIdentifier('candidate_first_name') === 'Candidate First Name', 'humanizeIdentifier snake_case');
        assert(FormScanner.humanizeIdentifier('applicantFirstName') === 'Applicant First Name', 'humanizeIdentifier camelCase');
        assert(typeof FormScanner.scanPage === 'function', 'scanPage function exported');
        assert(typeof FormScanner.startAutoScan === 'function', 'startAutoScan function exported');
        assert(typeof FormScanner.stopAutoScan === 'function', 'stopAutoScan function exported');
    });

    console.log('\n====================================================');
    console.log(`  Test Run Complete: ${passed} Passed, ${failed} Failed`);
    console.log('====================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runAllTests();
