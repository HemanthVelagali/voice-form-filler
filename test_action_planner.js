/**
 * Automated Unit Test Suite for Action Planner (Phase 4)
 */

const ActionPlanner = require('./form/action-planner.js');
const SpeechCleaner = require('./form/speech-cleaner.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

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
console.log('  Action Planner Phase 4 Verification Suite');
console.log('====================================================\n');

// Mock Form Snapshot
const mockSnapshot = {
    forms: [
        {
            form_id: 'jobAppForm',
            fields: [
                { id: 'fname', name: 'candidate_first_name', type: 'text', label: 'First Name' },
                { id: 'email', name: 'applicant_email', type: 'email', label: 'Email Address' },
                { id: 'phone', name: 'contact_number', type: 'tel', label: 'Phone Number' },
                {
                    id: 'country_select',
                    name: 'country',
                    type: 'select',
                    label: 'Country',
                    options: [
                        { text: 'India', value: 'IN' },
                        { text: 'United States', value: 'US' },
                        { text: 'United Kingdom', value: 'UK' }
                    ]
                },
                {
                    id: 'gender-group',
                    name: 'gender',
                    type: 'radio',
                    label: 'Gender',
                    options: [
                        { label: 'Male', value: 'male' },
                        { label: 'Female', value: 'female' },
                        { label: 'Other', value: 'other' }
                    ]
                },
                {
                    id: 'skills-group',
                    name: 'skills',
                    type: 'checkbox_group',
                    label: 'Skills',
                    options: [
                        { label: 'Python', value: 'python' },
                        { label: 'JavaScript', value: 'javascript' },
                        { label: 'Java', value: 'java' }
                    ]
                }
            ]
        }
    ]
};

// Test 1: Navigation commands
runTest(1, 'Plans NEXT_FIELD, PREVIOUS_FIELD, and SUBMIT_FORM actions', () => {
    const nextPlan = ActionPlanner.planAction('Looks good', { formSnapshot: mockSnapshot });
    assert(nextPlan.action === 'NEXT_FIELD', `Expected NEXT_FIELD, got ${nextPlan.action}`);

    const prevPlan = ActionPlanner.planAction('Go back', { formSnapshot: mockSnapshot });
    assert(prevPlan.action === 'PREVIOUS_FIELD', `Expected PREVIOUS_FIELD, got ${prevPlan.action}`);

    const submitPlan = ActionPlanner.planAction('Submit application', { formSnapshot: mockSnapshot });
    assert(submitPlan.action === 'SUBMIT_FORM', `Expected SUBMIT_FORM, got ${submitPlan.action}`);
});

// Test 2: Field jumping navigation
runTest(2, 'Plans NAVIGATE_TO_FIELD when user specifies a target field name or label', () => {
    const jumpPlan = ActionPlanner.planAction('Go to email', { formSnapshot: mockSnapshot });
    assert(jumpPlan.action === 'NAVIGATE_TO_FIELD', `Expected NAVIGATE_TO_FIELD, got ${jumpPlan.action}`);
    assert(jumpPlan.targetFieldId === 'email', `Expected target email, got ${jumpPlan.targetFieldId}`);

    const jumpPhone = ActionPlanner.planAction('Switch to phone number', { formSnapshot: mockSnapshot });
    assert(jumpPhone.action === 'NAVIGATE_TO_FIELD', `Expected NAVIGATE_TO_FIELD, got ${jumpPhone.action}`);
    assert(jumpPhone.targetFieldId === 'phone', `Expected target phone, got ${jumpPhone.targetFieldId}`);
});

// Test 3: Select dropdown options
runTest(3, 'Plans SELECT_OPTION by matching option text or value in select elements', () => {
    const selectPlan = ActionPlanner.planAction('Select India', { formSnapshot: mockSnapshot });
    assert(selectPlan.action === 'SELECT_OPTION', `Expected SELECT_OPTION, got ${selectPlan.action}`);
    assert(selectPlan.value === 'IN', `Expected value IN, got ${selectPlan.value}`);
    assert(selectPlan.fieldId === 'country_select', `Expected fieldId country_select, got ${selectPlan.fieldId}`);
});

// Test 4: Radio group selection
runTest(4, 'Plans SET_RADIO by matching option label in radio group', () => {
    const radioPlan = ActionPlanner.planAction('Select Male', { formSnapshot: mockSnapshot });
    assert(radioPlan.action === 'SET_RADIO', `Expected SET_RADIO, got ${radioPlan.action}`);
    assert(radioPlan.value === 'male', `Expected value male, got ${radioPlan.value}`);
    assert(radioPlan.fieldId === 'gender-group', `Expected fieldId gender-group, got ${radioPlan.fieldId}`);
});

// Test 5: Checkbox group toggling
runTest(5, 'Plans TOGGLE_CHECKBOX by matching checkbox options', () => {
    const cbPlan = ActionPlanner.planAction('Check Python', { formSnapshot: mockSnapshot });
    assert(cbPlan.action === 'TOGGLE_CHECKBOX', `Expected TOGGLE_CHECKBOX, got ${cbPlan.action}`);
    assert(cbPlan.value === 'python', `Expected value python, got ${cbPlan.value}`);
});

// Test 6: Value filling with speech cleaning
runTest(6, 'Cleans speech and plans FILL_VALUE for active field (e.g. Barack Obama)', () => {
    const fillPlan = ActionPlanner.planAction('My name is Barack Obama.', {
        activeFieldId: 'fname',
        formSnapshot: mockSnapshot
    });

    assert(fillPlan.action === 'FILL_VALUE', `Expected FILL_VALUE, got ${fillPlan.action}`);
    assert(fillPlan.value === 'Barack Obama', `Expected Barack Obama, got ${fillPlan.value}`);
    assert(fillPlan.targetFieldId === 'fname', `Expected targetFieldId fname, got ${fillPlan.targetFieldId}`);
});

// Test 7: Action Execution handlers
runTest(7, 'Executes planned actions through callback dispatchers', () => {
    let filledValue = '';
    let filledTarget = '';
    let navTarget = '';

    const handlers = {
        onFill: (target, val) => { filledTarget = target; filledValue = val; },
        onNavigate: (target) => { navTarget = target; }
    };

    const fillPlan = ActionPlanner.planAction('My name is Barack Obama.', { activeFieldId: 'fname', formSnapshot: mockSnapshot });
    ActionPlanner.executeAction(fillPlan, handlers);
    assert(filledValue === 'Barack Obama', `Expected Barack Obama, got ${filledValue}`);
    assert(filledTarget === 'fname', `Expected fname, got ${filledTarget}`);

    const jumpPlan = ActionPlanner.planAction('Go to email', { formSnapshot: mockSnapshot });
    ActionPlanner.executeAction(jumpPlan, handlers);
    assert(navTarget === 'email', `Expected email, got ${navTarget}`);
});

console.log('\n====================================================');
console.log(`  Test Run Complete: ${passed} Passed, ${failed} Failed`);
console.log('====================================================\n');

if (failed > 0) {
    process.exit(1);
}
