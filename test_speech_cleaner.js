/**
 * Automated Unit Test Suite for Speech Cleaner & Entity Extractor (Phase 3)
 */

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
console.log('  Speech Cleaner Phase 3 Verification Suite');
console.log('====================================================\n');

// Test 1: Name conversational prefix removal & title-casing
runTest(1, 'Strips conversational prefixes from names and title-cases', () => {
    const testCases = [
        { input: 'My name is Marshall.', expected: 'Marshall' },
        { input: 'The first name is deepanshu.', expected: 'Deepanshu' },
        { input: 'I am Sarah Connor.', expected: 'Sarah Connor' },
        { input: 'Enter name as Alex Mercer.', expected: 'Alex Mercer' },
        { input: 'Put john.', expected: 'John' },
        { input: 'It is Bruce Wayne.', expected: 'Bruce Wayne' }
    ];

    for (const { input, expected } of testCases) {
        const result = SpeechCleaner.cleanName(input);
        assert(result === expected, `For '${input}', expected '${expected}', got '${result}'`);
    }
});

// Test 2: Spoken email normalization
runTest(2, 'Normalizes spoken email addresses (at, at the rate, dot)', () => {
    const testCases = [
        { input: 'My email is marshall at gmail dot com.', expected: 'marshall@gmail.com' },
        { input: 'applicant at the rate company dot org', expected: 'applicant@company.org' },
        { input: 'john dot doe at tech dot io', expected: 'john.doe@tech.io' },
        { input: 'Email is user@domain.com.', expected: 'user@domain.com' }
    ];

    for (const { input, expected } of testCases) {
        const result = SpeechCleaner.cleanEmail(input);
        assert(result === expected, `For '${input}', expected '${expected}', got '${result}'`);
    }
});

// Test 3: Phone number cleaning
runTest(3, 'Cleans phone and mobile number speech', () => {
    const testCases = [
        { input: 'My phone number is +1 555 123 4567.', expected: '+15551234567' },
        { input: 'Contact number is 9876543210', expected: '9876543210' },
        { input: 'mobile is nine eight seven six five four three two one zero', expected: '9876543210' }
    ];

    for (const { input, expected } of testCases) {
        const result = SpeechCleaner.cleanPhone(input);
        assert(result === expected, `For '${input}', expected '${expected}', got '${result}'`);
    }
});

// Test 4: Experience / Numeric field cleaning
runTest(4, 'Extracts numbers from experience and rating utterances', () => {
    const testCases = [
        { input: 'I have 5 years experience.', expected: '5' },
        { input: 'three years', expected: '3' },
        { input: 'about 3.5 years', expected: '3.5' },
        { input: 'Rating is 9 out of 10', expected: '9' }
    ];

    for (const { input, expected } of testCases) {
        const result = SpeechCleaner.cleanNumber(input);
        assert(result === expected, `For '${input}', expected '${expected}', got '${result}'`);
    }
});

// Test 5: Address cleaning
runTest(5, 'Strips residency prefixes and cleans street addresses', () => {
    const testCases = [
        { input: 'I live at 221B Baker Street, London.', expected: '221B Baker Street, London' },
        { input: 'The address is 10 Downing Street.', expected: '10 Downing Street' }
    ];

    for (const { input, expected } of testCases) {
        const result = SpeechCleaner.cleanAddress(input);
        assert(result === expected, `For '${input}', expected '${expected}', got '${result}'`);
    }
});

// Test 6: Command intent detection
runTest(6, 'Detects conversational navigation and action commands', () => {
    assert(SpeechCleaner.detectIntent('Looks good') === 'NEXT_FIELD', 'Failed to detect NEXT_FIELD');
    assert(SpeechCleaner.detectIntent('next field') === 'NEXT_FIELD', 'Failed to detect NEXT_FIELD');
    assert(SpeechCleaner.detectIntent('go back') === 'PREVIOUS_FIELD', 'Failed to detect PREVIOUS_FIELD');
    assert(SpeechCleaner.detectIntent('submit form') === 'SUBMIT_FORM', 'Failed to detect SUBMIT_FORM');
    assert(SpeechCleaner.detectIntent('clear field') === 'CLEAR_FIELD', 'Failed to detect CLEAR_FIELD');
    assert(SpeechCleaner.detectIntent('My name is Marshall') === null, 'Incorrectly flagged data as command');
});

// Test 7: cleanInputForField dispatcher
runTest(7, 'Automatically selects correct cleaner based on field metadata', () => {
    const nameField = { semantic_field: 'PERSON.FIRST_NAME', name: 'fname', type: 'text' };
    assert(SpeechCleaner.cleanInputForField('My name is Marshall.', nameField) === 'Marshall');

    const emailField = { semantic_field: 'CONTACT.EMAIL', name: 'email', type: 'email' };
    assert(SpeechCleaner.cleanInputForField('alex at domain dot com', emailField) === 'alex@domain.com');

    const phoneField = { semantic_field: 'CONTACT.PHONE', name: 'phone', type: 'tel' };
    assert(SpeechCleaner.cleanInputForField('call 9876543210.', phoneField) === '9876543210');
});

// Test 8: Multi-slot extraction
runTest(8, 'Extracts multiple slots from a single compound sentence', () => {
    const compound = 'My name is Marshall and my email is marshall at test dot com';
    const slots = SpeechCleaner.extractMultiSlot(compound);

    assert(slots['PERSON.FULL_NAME'] === 'Marshall', `Expected Marshall, got ${slots['PERSON.FULL_NAME']}`);
    assert(slots['CONTACT.EMAIL'] === 'marshall@test.com', `Expected marshall@test.com, got ${slots['CONTACT.EMAIL']}`);
});

console.log('\n====================================================');
console.log(`  Test Run Complete: ${passed} Passed, ${failed} Failed`);
console.log('====================================================\n');

if (failed > 0) {
    process.exit(1);
}

