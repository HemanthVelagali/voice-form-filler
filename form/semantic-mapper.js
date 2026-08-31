/**
 * Semantic Field Mapper — Phase 2: Canonical Entity Alignment
 * 
 * Maps raw DOM field metadata (labels, names, IDs, placeholders, types, autocomplete)
 * to a standardized semantic entity taxonomy (e.g. PERSON.FIRST_NAME, CONTACT.EMAIL).
 * 
 * Features:
 *  - Fast heuristic classifier with deterministic confidence scoring (0.0 to 1.0)
 *  - Universal standard taxonomy covering Personal, Contact, Address, Work, Auth, and General
 *  - In-place and clone snapshot enrichment
 *  - Zero external dependencies; Node.js and Browser compatible (UMD)
 */

(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const mapper = factory();
        root.SemanticMapper = mapper;
        if (root.FormFiller) {
            root.FormFiller.SemanticMapper = mapper;
        }
    }
})(typeof self !== 'undefined' ? self : (typeof global !== 'undefined' ? global : this), function() {
    'use strict';

    /**
     * Standard Canonical Taxonomy
     */
    const TAXONOMY = {
        // Personal Information
        'PERSON.FIRST_NAME': {
            description: "Given / First Name of an individual",
            examples: ['fname', 'given_name', 'candidate_first_name', 'firstName', 'forename']
        },
        'PERSON.LAST_NAME': {
            description: "Surname / Family / Last Name of an individual",
            examples: ['lname', 'surname', 'family_name', 'lastName', 'candidate_last_name']
        },
        'PERSON.MIDDLE_NAME': {
            description: "Middle name of an individual",
            examples: ['mname', 'middle_name', 'middleInitial']
        },
        'PERSON.FULL_NAME': {
            description: "Complete full name (first + last)",
            examples: ['name', 'full_name', 'candidate_name', 'applicant_name', 'your_name']
        },
        'PERSON.GENDER': {
            description: "Gender identity (male, female, other)",
            examples: ['gender', 'sex']
        },
        'PERSON.DATE_OF_BIRTH': {
            description: "Birth date",
            examples: ['dob', 'birth_date', 'date_of_birth', 'birthdate', 'bday']
        },

        // Contact Information
        'CONTACT.EMAIL': {
            description: "Email address",
            examples: ['email', 'applicant_email', 'candidateEmail', 'email_address', 'e-mail']
        },
        'CONTACT.PHONE': {
            description: "General telephone or contact number",
            examples: ['phone', 'contact_number', 'telephone', 'tel_no', 'phone_number']
        },
        'CONTACT.MOBILE': {
            description: "Mobile / cell phone number",
            examples: ['mobile', 'cell', 'mobile_no', 'cell_phone', 'mobile_number']
        },

        // Address & Location
        'ADDRESS.STREET': {
            description: "Street address or residential location",
            examples: ['address', 'street', 'street_address', 'address_line1', 'residence']
        },
        'ADDRESS.CITY': {
            description: "City or municipality",
            examples: ['city', 'town', 'locality']
        },
        'ADDRESS.STATE': {
            description: "State, province, or region",
            examples: ['state', 'province', 'region', 'state_code']
        },
        'ADDRESS.POSTAL_CODE': {
            description: "Postal code, ZIP code, or PIN code",
            examples: ['zip', 'zipcode', 'postal_code', 'postal', 'pin', 'pincode']
        },
        'ADDRESS.COUNTRY': {
            description: "Country or nation",
            examples: ['country', 'nation', 'country_code', 'country_select']
        },

        // Employment & Professional
        'WORK.EXPERIENCE_YEARS': {
            description: "Years of professional experience",
            examples: ['experience', 'work_exp', 'experience_years', 'years_of_experience']
        },
        'WORK.JOB_TITLE': {
            description: "Current or desired job designation",
            examples: ['job_title', 'designation', 'role', 'position', 'occupation']
        },
        'WORK.COMPANY': {
            description: "Company, organization, or employer name",
            examples: ['company', 'organization', 'employer', 'workplace']
        },
        'WORK.SKILLS': {
            description: "Technical or professional skills & competencies",
            examples: ['skills', 'technologies', 'tech_stack', 'competencies']
        },
        'WORK.RESUME_CV': {
            description: "Resume or Curriculum Vitae document",
            examples: ['resume', 'cv', 'curriculum_vitae', 'upload_resume']
        },

        // Authentication & Security
        'AUTH.USERNAME': {
            description: "Account username or handle",
            examples: ['username', 'user_id', 'login_id', 'user_name']
        },
        'AUTH.PASSWORD': {
            description: "Password or secret passkey",
            examples: ['password', 'passwd', 'user_password', 'current_password']
        },

        // General Form Elements
        'GENERAL.SEARCH_QUERY': {
            description: "Search or query input string",
            examples: ['search', 'search_term', 'query', 'find', 'q']
        },
        'GENERAL.COMMENTS': {
            description: "Free-form comments, notes, bio, or cover letter",
            examples: ['comments', 'feedback', 'notes', 'bio', 'cover_letter', 'message']
        },
        'GENERAL.RATING': {
            description: "Numeric or scalar rating / satisfaction score",
            examples: ['rating', 'satisfaction', 'score', 'feedback_rating']
        },
        'GENERAL.TERMS_AGREEMENT': {
            description: "Terms of service or privacy agreement checkbox",
            examples: ['agree_terms', 'terms_agree', 'terms', 'privacy_consent', 'accept_terms']
        }
    };

    /**
     * Autocomplete attribute exact mappings (HTML5 specification)
     */
    const AUTOCOMPLETE_MAP = {
        'given-name': { field: 'PERSON.FIRST_NAME', confidence: 0.99 },
        'family-name': { field: 'PERSON.LAST_NAME', confidence: 0.99 },
        'additional-name': { field: 'PERSON.MIDDLE_NAME', confidence: 0.99 },
        'name': { field: 'PERSON.FULL_NAME', confidence: 0.98 },
        'sex': { field: 'PERSON.GENDER', confidence: 0.98 },
        'bday': { field: 'PERSON.DATE_OF_BIRTH', confidence: 0.99 },
        'email': { field: 'CONTACT.EMAIL', confidence: 0.99 },
        'tel': { field: 'CONTACT.PHONE', confidence: 0.99 },
        'tel-national': { field: 'CONTACT.PHONE', confidence: 0.99 },
        'street-address': { field: 'ADDRESS.STREET', confidence: 0.99 },
        'address-line1': { field: 'ADDRESS.STREET', confidence: 0.99 },
        'address-level2': { field: 'ADDRESS.CITY', confidence: 0.99 },
        'address-level1': { field: 'ADDRESS.STATE', confidence: 0.99 },
        'postal-code': { field: 'ADDRESS.POSTAL_CODE', confidence: 0.99 },
        'country': { field: 'ADDRESS.COUNTRY', confidence: 0.99 },
        'country-name': { field: 'ADDRESS.COUNTRY', confidence: 0.99 },
        'organization-title': { field: 'WORK.JOB_TITLE', confidence: 0.98 },
        'organization': { field: 'WORK.COMPANY', confidence: 0.98 },
        'username': { field: 'AUTH.USERNAME', confidence: 0.99 },
        'current-password': { field: 'AUTH.PASSWORD', confidence: 0.99 },
        'new-password': { field: 'AUTH.PASSWORD', confidence: 0.99 }
    };

    /**
     * Rule definitions: regex patterns and their semantic targets
     */
    const RULES = [
        // 1. First Name
        {
            field: 'PERSON.FIRST_NAME',
            pattern: /\b(first[\s_-]?name|fname|given[\s_-]?name|candidate[\s_-]?first|applicant[\s_-]?first|forename|prenom)\b/i,
            negative: /\b(last|middle|full|sur|user)\b/i,
            confidence: 0.96
        },
        // 2. Last Name
        {
            field: 'PERSON.LAST_NAME',
            pattern: /\b(last[\s_-]?name|lname|surname|family[\s_-]?name|candidate[\s_-]?last|applicant[\s_-]?last|nachname)\b/i,
            negative: /\b(first|middle|full|user)\b/i,
            confidence: 0.96
        },
        // 3. Middle Name
        {
            field: 'PERSON.MIDDLE_NAME',
            pattern: /\b(middle[\s_-]?name|mname|middle[\s_-]?initial)\b/i,
            confidence: 0.95
        },
        // 4. Full Name (only if not explicitly first or last)
        {
            field: 'PERSON.FULL_NAME',
            pattern: /\b(full[\s_-]?name|candidate[\s_-]?name|applicant[\s_-]?name|your[\s_-]?name|contact[\s_-]?name|customer[\s_-]?name|^name$)\b/i,
            negative: /\b(first|last|middle|user|file|company|org)\b/i,
            confidence: 0.90
        },
        // 5. Email
        {
            field: 'CONTACT.EMAIL',
            pattern: /\b(email|e-mail|mail[\s_-]?address|candidate[\s_-]?email|applicant[\s_-]?email|contact[\s_-]?email)\b/i,
            confidence: 0.98
        },
        // 6. Mobile Phone
        {
            field: 'CONTACT.MOBILE',
            pattern: /\b(mobile|cell|cellphone|mobile[\s_-]?(?:no|number|phone))\b/i,
            confidence: 0.95
        },
        // 7. General Phone
        {
            field: 'CONTACT.PHONE',
            pattern: /\b(phone|telephone|contact[\s_-]?number|tel[\s_-]?no|phone[\s_-]?number)\b/i,
            confidence: 0.93
        },
        // 8. Date of Birth
        {
            field: 'PERSON.DATE_OF_BIRTH',
            pattern: /\b(dob|birth[\s_-]?date|date[\s_-]?of[\s_-]?birth|birthdate|birthday)\b/i,
            confidence: 0.97
        },
        // 9. Gender
        {
            field: 'PERSON.GENDER',
            pattern: /\b(gender|sex)\b/i,
            confidence: 0.95
        },
        // 10. Experience Years
        {
            field: 'WORK.EXPERIENCE_YEARS',
            pattern: /\b(experience|work[\s_-]?exp|years[\s_-]?of[\s_-]?experience|experience[\s_-]?years|exp[\s_-]?years)\b/i,
            confidence: 0.94
        },
        // 11. Country
        {
            field: 'ADDRESS.COUNTRY',
            pattern: /\b(country|nation|country[\s_-]?(?:code|name|select))\b/i,
            confidence: 0.96
        },
        // 12. State / Region
        {
            field: 'ADDRESS.STATE',
            pattern: /\b(state|province|region|state[\s_-]?(?:code|name|select))\b/i,
            negative: /\b(united)\b/i,
            confidence: 0.95
        },
        // 13. City
        {
            field: 'ADDRESS.CITY',
            pattern: /\b(city|town|locality|municipality)\b/i,
            confidence: 0.95
        },
        // 14. Postal Code / ZIP / PIN
        {
            field: 'ADDRESS.POSTAL_CODE',
            pattern: /\b(zip|zipcode|postal[\s_-]?code|postal|pincode|pin[\s_-]?code)\b/i,
            confidence: 0.97
        },
        // 15. Street Address
        {
            field: 'ADDRESS.STREET',
            pattern: /\b(address|street|street[\s_-]?address|address[\s_-]?line|residence)\b/i,
            negative: /\b(email|ip)\b/i,
            confidence: 0.92
        },
        // 16. Skills
        {
            field: 'WORK.SKILLS',
            pattern: /\b(skills|technologies|tech[\s_-]?stack|competencies|programming[\s_-]?languages)\b/i,
            confidence: 0.94
        },
        // 17. Job Title
        {
            field: 'WORK.JOB_TITLE',
            pattern: /\b(job[\s_-]?title|designation|position|role|occupation)\b/i,
            confidence: 0.93
        },
        // 18. Company
        {
            field: 'WORK.COMPANY',
            pattern: /\b(company|employer|organization|workplace)\b/i,
            confidence: 0.93
        },
        // 19. Resume / CV
        {
            field: 'WORK.RESUME_CV',
            pattern: /\b(resume|cv|curriculum[\s_-]?vitae)\b/i,
            confidence: 0.96
        },
        // 20. Search Query
        {
            field: 'GENERAL.SEARCH_QUERY',
            pattern: /\b(search|search[\s_-]?query|search[\s_-]?term|find[\s_-]?query|^q$)\b/i,
            confidence: 0.92
        },
        // 21. Rating
        {
            field: 'GENERAL.RATING',
            pattern: /\b(rating|satisfaction|score|stars)\b/i,
            confidence: 0.92
        },
        // 22. Terms & Privacy Agreement
        {
            field: 'GENERAL.TERMS_AGREEMENT',
            pattern: /\b(agree[\s_-]?terms|terms[\s_-]?agree|terms[\s_-]?and[\s_-]?conditions|privacy[\s_-]?policy|accept[\s_-]?terms|certify)\b/i,
            confidence: 0.96
        },
        // 23. Comments / Bio
        {
            field: 'GENERAL.COMMENTS',
            pattern: /\b(comments|feedback|notes|bio|cover[\s_-]?letter|description|remarks|message)\b/i,
            confidence: 0.89
        },
        // 24. Username
        {
            field: 'AUTH.USERNAME',
            pattern: /\b(username|user[\s_-]?id|login[\s_-]?id|handle)\b/i,
            confidence: 0.95
        },
        // 25. Password
        {
            field: 'AUTH.PASSWORD',
            pattern: /\b(password|passwd|passcode)\b/i,
            confidence: 0.98
        }
    ];

    /**
     * Classifies a single form field based on all available metadata signals.
     * 
     * @param {Object} field - Raw field metadata produced by FormScanner
     * @returns {Object} { semantic_field: string|null, confidence: number|null }
     */
    function classifyField(field) {
        if (!field) return { semantic_field: null, confidence: null };

        // Signal 1: Autocomplete attribute (highest authority)
        if (field.autocomplete) {
            const autoKey = field.autocomplete.trim().toLowerCase();
            if (AUTOCOMPLETE_MAP[autoKey]) {
                return {
                    semantic_field: AUTOCOMPLETE_MAP[autoKey].field,
                    confidence: AUTOCOMPLETE_MAP[autoKey].confidence
                };
            }
        }

        // Signal 2: Standard HTML5 type inference
        const type = (field.type || '').toLowerCase();
        if (type === 'email') {
            return { semantic_field: 'CONTACT.EMAIL', confidence: 0.98 };
        }
        if (type === 'password') {
            return { semantic_field: 'AUTH.PASSWORD', confidence: 0.98 };
        }
        if (type === 'search') {
            return { semantic_field: 'GENERAL.SEARCH_QUERY', confidence: 0.92 };
        }

        // Signal 3: Text clues aggregation across label, name, id, placeholder, and aria labels
        const clues = [];
        if (field.label) clues.push({ text: field.label, weight: 1.0 });
        if (field.name) clues.push({ text: field.name, weight: 0.9 });
        if (field.id) clues.push({ text: field.id, weight: 0.8 });
        if (field.aria_label) clues.push({ text: field.aria_label, weight: 0.95 });
        if (field.placeholder) clues.push({ text: field.placeholder, weight: 0.7 });

        let bestMatch = null;
        let highestScore = 0;

        for (const rule of RULES) {
            for (const clue of clues) {
                if (rule.negative && rule.negative.test(clue.text)) {
                    continue;
                }
                if (rule.pattern.test(clue.text)) {
                    const score = rule.confidence * clue.weight;
                    if (score > highestScore) {
                        highestScore = score;
                        bestMatch = rule.field;
                    }
                }
            }
        }

        if (bestMatch && highestScore >= 0.5) {
            return {
                semantic_field: bestMatch,
                confidence: Math.round(highestScore * 100) / 100
            };
        }

        // Signal 4: Secondary type fallbacks
        if (type === 'tel') {
            return { semantic_field: 'CONTACT.PHONE', confidence: 0.85 };
        }
        if (type === 'date') {
            return { semantic_field: 'PERSON.DATE_OF_BIRTH', confidence: 0.70 };
        }

        return { semantic_field: null, confidence: null };
    }

    /**
     * Enriches a full canonical Form Snapshot with semantic field classifications.
     * 
     * @param {Object} snapshot - Canonical Form Snapshot produced by FormScanner
     * @param {Object} options - { inPlace: true/false }
     * @returns {Object} Enriched Form Snapshot
     */
    function enrichSnapshot(snapshot, options = { inPlace: true }) {
        if (!snapshot || !snapshot.forms) return snapshot;

        const target = options.inPlace ? snapshot : JSON.parse(JSON.stringify(snapshot));

        for (const form of target.forms) {
            if (form.fields && Array.isArray(form.fields)) {
                for (const field of form.fields) {
                    const result = classifyField(field);
                    field.semantic_field = result.semantic_field;
                    field.confidence = result.confidence;
                }
            }
        }

        return target;
    }

    return {
        TAXONOMY,
        classifyField,
        enrichSnapshot
    };
});

