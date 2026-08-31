/**
 * Automated Unit Test Suite for Semantic Field Mapper (Phase 2)
 */

const SemanticMapper = require('./form/semantic-mapper.js');
const FormScanner = require('./form/scanner.js');

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
console.log('  Semantic Field Mapper Phase 2 Verification Suite');
console.log('====================================================\n');

// Test 1: First Name variants
runTest(1, 'Maps diverse first name field identifiers to PERSON.FIRST_NAME', () => {
    const variants = [
        { name: 'fname', label: 'First Name' },
        { name: 'given_name', label: 'Given Name' },
        { name: 'candidate_first_name', label: 'Candidate First Name' },
        { name: 'applicantFirstName', label: 'Applicant First Name' },
        { name: 'forename', label: 'Forename' }
    ];

    for (const v of variants) {
        const res = SemanticMapper.classifyField(v);
        assert(res.semantic_field === 'PERSON.FIRST_NAME', `Expected PERSON.FIRST_NAME for ${JSON.stringify(v)}, got ${res.semantic_field}`);
        assert(res.confidence >= 0.8, `Expected confidence >= 0.8, got ${res.confidence}`);
    }
});

// Test 2: Last Name variants
runTest(2, 'Maps surname/family name identifiers to PERSON.LAST_NAME', () => {
    const variants = [
        { name: 'lname', label: 'Last Name' },
        { name: 'surname', label: 'Surname' },
        { name: 'family_name', label: 'Family Name' },
        { name: 'applicant_last_name', label: 'Applicant Last Name' }
    ];

    for (const v of variants) {
        const res = SemanticMapper.classifyField(v);
        assert(res.semantic_field === 'PERSON.LAST_NAME', `Expected PERSON.LAST_NAME for ${JSON.stringify(v)}, got ${res.semantic_field}`);
        assert(res.confidence >= 0.8, `Expected confidence >= 0.8, got ${res.confidence}`);
    }
});

// Test 3: Email fields
runTest(3, 'Maps email fields via type, name, and label to CONTACT.EMAIL', () => {
    const res1 = SemanticMapper.classifyField({ type: 'email', name: 'user_mail' });
    assert(res1.semantic_field === 'CONTACT.EMAIL', `Expected CONTACT.EMAIL, got ${res1.semantic_field}`);
    assert(res1.confidence >= 0.95, `Expected confidence >= 0.95, got ${res1.confidence}`);

    const res2 = SemanticMapper.classifyField({ type: 'text', name: 'applicant_email', label: 'Email Address' });
    assert(res2.semantic_field === 'CONTACT.EMAIL', `Expected CONTACT.EMAIL, got ${res2.semantic_field}`);
});

// Test 4: Phone and Mobile fields
runTest(4, 'Maps phone and mobile number variants to CONTACT.PHONE / CONTACT.MOBILE', () => {
    const resPhone = SemanticMapper.classifyField({ name: 'contact_number', label: 'Contact Phone Number' });
    assert(resPhone.semantic_field === 'CONTACT.PHONE' || resPhone.semantic_field === 'CONTACT.MOBILE', `Expected CONTACT.PHONE or CONTACT.MOBILE, got ${resPhone.semantic_field}`);

    const resMobile = SemanticMapper.classifyField({ name: 'mobile_no', label: 'Mobile Number' });
    assert(resMobile.semantic_field === 'CONTACT.MOBILE', `Expected CONTACT.MOBILE, got ${resMobile.semantic_field}`);
});

// Test 5: Address, Country, State, Postal Code
runTest(5, 'Maps geographical and address concepts to standard ADDRESS.* taxonomy', () => {
    const resCountry = SemanticMapper.classifyField({ name: 'country', label: 'Select Country' });
    assert(resCountry.semantic_field === 'ADDRESS.COUNTRY', `Expected ADDRESS.COUNTRY, got ${resCountry.semantic_field}`);

    const resState = SemanticMapper.classifyField({ name: 'state', label: 'State / Province' });
    assert(resState.semantic_field === 'ADDRESS.STATE', `Expected ADDRESS.STATE, got ${resState.semantic_field}`);

    const resZip = SemanticMapper.classifyField({ name: 'zipcode', label: 'Postal / PIN Code' });
    assert(resZip.semantic_field === 'ADDRESS.POSTAL_CODE', `Expected ADDRESS.POSTAL_CODE, got ${resZip.semantic_field}`);

    const resStreet = SemanticMapper.classifyField({ name: 'street_address', label: 'Residential Address' });
    assert(resStreet.semantic_field === 'ADDRESS.STREET', `Expected ADDRESS.STREET, got ${resStreet.semantic_field}`);
});

// Test 6: Work & Employment concepts
runTest(6, 'Maps professional and work-related fields to WORK.* taxonomy', () => {
    const resExp = SemanticMapper.classifyField({ name: 'work_exp', label: 'Experience (Years)' });
    assert(resExp.semantic_field === 'WORK.EXPERIENCE_YEARS', `Expected WORK.EXPERIENCE_YEARS, got ${resExp.semantic_field}`);

    const resSkills = SemanticMapper.classifyField({ name: 'skills', label: 'Technical Skills' });
    assert(resSkills.semantic_field === 'WORK.SKILLS', `Expected WORK.SKILLS, got ${resSkills.semantic_field}`);

    const resJob = SemanticMapper.classifyField({ name: 'job_title', label: 'Designation' });
    assert(resJob.semantic_field === 'WORK.JOB_TITLE', `Expected WORK.JOB_TITLE, got ${resJob.semantic_field}`);
});

// Test 7: Autocomplete attribute prioritization
runTest(7, 'Gives top priority (0.99 confidence) to HTML5 autocomplete attributes', () => {
    const field = {
        name: 'generic_fld_123',
        label: 'Field 123',
        autocomplete: 'given-name'
    };
    const res = SemanticMapper.classifyField(field);
    assert(res.semantic_field === 'PERSON.FIRST_NAME', `Expected PERSON.FIRST_NAME, got ${res.semantic_field}`);
    assert(res.confidence === 0.99, `Expected 0.99 confidence, got ${res.confidence}`);
});

// Test 8: General UI controls (Terms, Search, Comments, Ratings)
runTest(8, 'Maps general form elements (terms, search, rating, bio/comments)', () => {
    const resTerms = SemanticMapper.classifyField({ name: 'terms_agree', label: 'I agree to the terms' });
    assert(resTerms.semantic_field === 'GENERAL.TERMS_AGREEMENT', `Expected GENERAL.TERMS_AGREEMENT, got ${resTerms.semantic_field}`);

    const resSearch = SemanticMapper.classifyField({ type: 'search', name: 'search_term', label: 'Universal Search' });
    assert(resSearch.semantic_field === 'GENERAL.SEARCH_QUERY', `Expected GENERAL.SEARCH_QUERY, got ${resSearch.semantic_field}`);

    const resBio = SemanticMapper.classifyField({ type: 'textarea', name: 'bio', label: 'Cover Letter / Bio' });
    assert(resBio.semantic_field === 'GENERAL.COMMENTS', `Expected GENERAL.COMMENTS, got ${resBio.semantic_field}`);

    const resRating = SemanticMapper.classifyField({ type: 'number', name: 'feedback_rating', label: 'Satisfaction Rating (1 to 10)' });
    assert(resRating.semantic_field === 'GENERAL.RATING', `Expected GENERAL.RATING, got ${resRating.semantic_field}`);
});

// Test 9: Snapshot enrichment
runTest(9, 'Enriches entire Canonical Form Snapshot in-place with semantic mappings', () => {
    const mockSnapshot = {
        page: { url: 'http://test.local', title: 'Test Form' },
        forms: [
            {
                form_id: 'form1',
                fields: [
                    { id: 'f1', name: 'fname', type: 'text', label: 'First Name', semantic_field: null, confidence: null },
                    { id: 'f2', name: 'email', type: 'email', label: 'Email', semantic_field: null, confidence: null },
                    { id: 'f3', name: 'mobile', type: 'tel', label: 'Mobile No', semantic_field: null, confidence: null }
                ],
                actions: []
            }
        ]
    };

    SemanticMapper.enrichSnapshot(mockSnapshot);
    const fields = mockSnapshot.forms[0].fields;

    assert(fields[0].semantic_field === 'PERSON.FIRST_NAME', 'f1 not enriched to PERSON.FIRST_NAME');
    assert(fields[1].semantic_field === 'CONTACT.EMAIL', 'f2 not enriched to CONTACT.EMAIL');
    assert(fields[2].semantic_field === 'CONTACT.MOBILE', 'f3 not enriched to CONTACT.MOBILE');
    assert(fields[0].confidence > 0.8, 'Confidence not set on f1');
});

// Test 10: Taxonomy completeness
runTest(10, 'Exposes standard taxonomy dictionary with documentation and examples', () => {
    assert(typeof SemanticMapper.TAXONOMY === 'object', 'TAXONOMY is not an object');
    assert(SemanticMapper.TAXONOMY['PERSON.FIRST_NAME'] !== undefined, 'Missing PERSON.FIRST_NAME in taxonomy');
    assert(SemanticMapper.TAXONOMY['CONTACT.EMAIL'] !== undefined, 'Missing CONTACT.EMAIL in taxonomy');
    assert(SemanticMapper.TAXONOMY['ADDRESS.COUNTRY'] !== undefined, 'Missing ADDRESS.COUNTRY in taxonomy');
});

console.log('\n====================================================');
console.log(`  Test Run Complete: ${passed} Passed, ${failed} Failed`);
console.log('====================================================\n');

if (failed > 0) {
    process.exit(1);
}

