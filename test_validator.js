/**
 * Automated Unit Test Suite for FormValidator (Phase 5)
 */

const FormValidator = require('./form/validator.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
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
console.log('  Form Validator Phase 5 Verification Suite');
console.log('====================================================\n');

// Test 1: Required field blank
runTest(1, 'Required field validation fires when value is empty', () => {
    const result = FormValidator.validate('', { id: 'name', label: 'Name', required: true });
    assert(!result.valid, 'Empty required field should be invalid');
    assert(result.errors.length > 0, 'Should have at least one error');
    assert(result.errors[0].toLowerCase().includes('required'), `Error should mention required, got: ${result.errors[0]}`);
});

// Test 2: Valid email passes
runTest(2, 'Valid email address passes validation', () => {
    const result = FormValidator.validate('user@gmail.com', { type: 'email', label: 'Email', semantic_field: 'CONTACT.EMAIL' });
    assert(result.valid, `Valid email should pass, got errors: ${result.errors.join(', ')}`);
});

// Test 3: Invalid email fails with clear message
runTest(3, 'Invalid email address fails with voice-friendly message', () => {
    const result = FormValidator.validate('userATgmailDOTcom', { type: 'email', label: 'Email', semantic_field: 'CONTACT.EMAIL' });
    assert(!result.valid, 'Invalid email should fail');
    assert(result.suggestion !== null, 'Should have a spoken suggestion');
    assert(result.suggestion.toLowerCase().includes('email'), `Suggestion should mention email, got: ${result.suggestion}`);
});

// Test 4: Phone number — valid 10-digit
runTest(4, 'Valid phone number passes validation', () => {
    const result = FormValidator.validate('9876543210', { type: 'tel', label: 'Phone', semantic_field: 'CONTACT.PHONE' });
    assert(result.valid, `Valid phone should pass, got: ${result.errors.join(', ')}`);
});

// Test 5: Phone number — too short
runTest(5, 'Short phone number fails with digit-count message', () => {
    const result = FormValidator.validate('12345', { type: 'tel', label: 'Phone', semantic_field: 'CONTACT.PHONE' });
    assert(!result.valid, 'Short phone number should fail');
    assert(result.errors.some(e => e.includes('digit')), `Error should mention digits, got: ${result.errors.join(', ')}`);
});

// Test 6: Name — valid
runTest(6, 'Valid full name passes name validation', () => {
    const result = FormValidator.validate('Barack Obama', { id: 'fname', label: 'First Name', semantic_field: 'PERSON.FIRST_NAME' });
    assert(result.valid, `Valid name should pass, got: ${result.errors.join(', ')}`);
});

// Test 7: Name — too short
runTest(7, 'Single-letter name fails min-length rule', () => {
    const result = FormValidator.validate('X', { id: 'fname', label: 'First Name', semantic_field: 'PERSON.FIRST_NAME' });
    assert(!result.valid, 'Single-letter name should fail');
});

// Test 8: Name — contains digits triggers warning
runTest(8, 'Name with digits triggers a soft warning', () => {
    const result = FormValidator.validate('John3', { id: 'name', label: 'Name', semantic_field: 'PERSON.FULL_NAME' });
    assert(result.warnings.length > 0, 'Digit in name should produce a warning');
});

// Test 9: Experience years — valid
runTest(9, 'Valid experience years pass validation', () => {
    const result = FormValidator.validate('5', { label: 'Experience', semantic_field: 'WORK.EXPERIENCE_YEARS' });
    assert(result.valid, `Valid years should pass, got: ${result.errors.join(', ')}`);
});

// Test 10: Experience years — out of range
runTest(10, 'Out-of-range years fail validation', () => {
    const result = FormValidator.validate('150', { label: 'Experience', semantic_field: 'WORK.EXPERIENCE_YEARS' });
    assert(!result.valid, 'Out-of-range years should fail');
    assert(result.errors.some(e => e.includes('0') && e.includes('60')), `Error should mention range, got: ${result.errors.join(', ')}`);
});

// Test 11: Rating — valid
runTest(11, 'Valid rating value passes', () => {
    const result = FormValidator.validate('8', { label: 'Rating', semantic_field: 'GENERAL.RATING' });
    assert(result.valid, `Valid rating should pass, got: ${result.errors.join(', ')}`);
});

// Test 12: Pattern constraint
runTest(12, 'HTML pattern constraint enforced correctly', () => {
    const result = FormValidator.validate('abc123', {
        label: 'Code',
        pattern: '^[A-Z]{2}\\d{4}$'
    });
    assert(!result.valid, 'Value not matching pattern should fail');
    const pass = FormValidator.validate('AB1234', { label: 'Code', pattern: '^[A-Z]{2}\\d{4}$' });
    assert(pass.valid, 'Value matching pattern should pass');
});

console.log('\n====================================================');
console.log(`  Test Run Complete: ${passed} Passed, ${failed} Failed`);
console.log('====================================================\n');

if (failed > 0) process.exit(1);

