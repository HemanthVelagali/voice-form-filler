/**
 * Speech Cleaner & Entity Extractor — Phase 3: Voice Intent & Natural Speech Processing
 * 
 * Transforms raw conversational speech transcripts into clean, formatted form values:
 *   - Strips conversational prefixes ("My name is...", "It's...", "Enter...", "I live at...")
 *   - Formats domain values (Title-cases names, normalizes spoken emails "x at y dot com", cleans phone numbers)
 *   - Detects conversational command intents (Next, Previous, Submit, Clear)
 *   - Extracts multi-slot data from compound sentences
 * 
 * Zero external dependencies; Browser & Node.js compatible (UMD).
 */

(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const cleaner = factory();
        root.SpeechCleaner = cleaner;
        if (root.FormFiller) {
            root.FormFiller.SpeechCleaner = cleaner;
        }
    }
})(typeof self !== 'undefined' ? self : (typeof global !== 'undefined' ? global : this), function() {
    'use strict';

    // Command Intent Definitions
    const INTENT_PATTERNS = {
        NEXT_FIELD: /^(?:looks\s+good|next|next\s+field|go\s+to\s+next|next\s+please|proceed|continue|move\s+next|looks\s+fine|looks\s+ok)$/i,
        PREVIOUS_FIELD: /^(?:go\s+back|previous|previous\s+field|back|back\s+please|go\s+previous)$/i,
        SUBMIT_FORM: /^(?:submit|submit\s+form|submit\s+application|send\s+form|finish|done)$/i,
        CLEAR_FIELD: /^(?:clear|clear\s+field|erase|delete|reset\s+field|wipe\s+field)$/i
    };

    // Conversational Prefix Patterns to strip
    const PREFIX_PATTERNS = [
        /^(?:my\s+(?:first\s+name|last\s+name|full\s+name|name|email\s+address|email|phone\s+number|mobile\s+number|phone|mobile|contact\s+number|contact|address|residence|rating|job\s+title|company|experience)\s+(?:is|would\s+be|'s|:))\s*/i,
        /^(?:the\s+(?:first\s+name|last\s+name|full\s+name|name|email\s+address|email|phone\s+number|mobile\s+number|phone|mobile|contact\s+number|contact|address|residence|rating|job\s+title|company|experience)\s+(?:is|would\s+be|'s|:))\s*/i,
        /^(?:(?:first\s+name|last\s+name|full\s+name|name|email\s+address|email|phone\s+number|mobile\s+number|phone|mobile|contact\s+number|contact|address|residence|rating|job\s+title|company|experience)\s+(?:is|would\s+be|'s|:))\s*/i,
        /^(?:i\s+(?:am|live\s+at|reside\s+at|work\s+at|work\s+as|have|am\s+called))\s*/i,
        /^(?:please\s+)?(?:enter|put|write|fill|type|insert|set)\s+(?:in\s+|for\s+)?(?:the\s+)?(?:first\s+name|last\s+name|name|email|phone|address|field)?\s*(?:as|to|is|:)?\s*/i,
        /^(?:it\s+is|it's|this\s+is|here\s+is|my\s+answer\s+is|you\s+can\s+put|value\s+is)\s*/i,
        /^(?:i\s+would\s+say|i\s+guess|let's\s+put|let's\s+write)\s*/i
    ];

    // Word to number dictionary for spoken digits & numbers
    const WORD_TO_NUM = {
        'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
        'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
        'ten': '10', 'eleven': '11', 'twelve': '12', 'thirteen': '13',
        'fourteen': '14', 'fifteen': '15', 'sixteen': '16', 'seventeen': '17',
        'eighteen': '18', 'nineteen': '19', 'twenty': '20', 'thirty': '30',
        'forty': '40', 'fifty': '50', 'sixty': '60', 'seventy': '70',
        'eighty': '80', 'ninety': '90'
    };

    /**
     * Checks if utterance is a navigational command (Next, Submit, Clear, Previous).
     */
    function detectIntent(text) {
        if (!text || typeof text !== 'string') return null;
        const trimmed = text.trim().replace(/[.,!?;:]+$/, '').trim();

        for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
            if (pattern.test(trimmed)) {
                return intent;
            }
        }
        return null;
    }

    /**
     * Strips conversational prefixes and surrounding filler phrases.
     */
    function stripConversationalPrefix(text) {
        if (!text || typeof text !== 'string') return '';
        let cleaned = text.trim();

        for (const pattern of PREFIX_PATTERNS) {
            if (pattern.test(cleaned)) {
                cleaned = cleaned.replace(pattern, '').trim();
                break;
            }
        }

        // Strip trailing punctuation (like periods at the end of speech recognition output)
        cleaned = cleaned.replace(/[.]+$/, '').trim();
        return cleaned;
    }

    /**
     * Converts a string to Title Case.
     */
    function toTitleCase(str) {
        if (!str) return '';
        return str
            .toLowerCase()
            .split(/\s+/)
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    /**
     * Cleans personal name strings (removes prefixes, trailing periods, applies proper capitalization).
     */
    function cleanName(text) {
        const raw = stripConversationalPrefix(text);
        if (!raw) return '';
        // Remove trailing commas/periods and title-case
        const clean = raw.replace(/[.,!?;:]+$/, '').trim();
        return toTitleCase(clean);
    }

    /**
     * Normalizes spoken email addresses into valid standard email strings.
     * Handles spoken tokens: " at ", " at the rate ", " dot ", etc.
     */
    function cleanEmail(text) {
        let raw = stripConversationalPrefix(text).toLowerCase();
        if (!raw) return '';

        // Replace common spoken variations of "@"
        raw = raw.replace(/\s+(?:at\s+the\s+rate\s+of|at\s+the\s+rate|at\s+rate|at)\s+/gi, '@');
        raw = raw.replace(/\s+@\s+/g, '@');
        raw = raw.replace(/@\s+/g, '@');
        raw = raw.replace(/\s+@/g, '@');

        // Replace spoken variations of "."
        raw = raw.replace(/\s+dot\s+/gi, '.');
        raw = raw.replace(/\s+\.\s+/g, '.');
        raw = raw.replace(/\.\s+/g, '.');
        raw = raw.replace(/\s+\./g, '.');

        // Remove all remaining spaces within email
        raw = raw.replace(/\s+/g, '');
        // Strip trailing punctuation
        raw = raw.replace(/[.,!?;:]+$/, '');
        return raw;
    }

    /**
     * Cleans phone and mobile numbers (spoken digits to numbers, cleans formatting).
     */
    function cleanPhone(text) {
        let raw = stripConversationalPrefix(text);
        if (!raw) return '';

        // Convert word numbers to digits
        const words = raw.toLowerCase().split(/\s+/);
        const mapped = words.map(w => WORD_TO_NUM[w] || w).join(' ');

        // Extract digits, plus signs, dashes
        let cleaned = mapped.replace(/[^\d+]/g, '');
        return cleaned;
    }

    /**
     * Cleans numeric fields (experience, age, ratings).
     */
    function cleanNumber(text) {
        let raw = stripConversationalPrefix(text);
        if (!raw) return '';

        // Convert word numbers (e.g. "three years" -> "3 years")
        const words = raw.toLowerCase().split(/\s+/);
        const mapped = words.map(w => WORD_TO_NUM[w] || w).join(' ');

        // Match first integer or float in text
        const match = mapped.match(/[-+]?\d*\.?\d+/);
        return match ? match[0] : raw;
    }

    /**
     * Cleans address strings (strips "I live at...", trailing punctuation).
     */
    function cleanAddress(text) {
        const raw = stripConversationalPrefix(text);
        if (!raw) return '';
        return raw.replace(/[.]+$/, '').trim();
    }

    /**
     * Cleans input tailored to the active field's semantic type or HTML metadata.
     * 
     * @param {string} rawTranscript - Raw speech recognition text
     * @param {Object} fieldInfo - { semantic_field, type, name, label }
     * @returns {string} Cleaned field value
     */
    function cleanInputForField(rawTranscript, fieldInfo = {}) {
        if (!rawTranscript || typeof rawTranscript !== 'string') return '';

        const semanticType = fieldInfo.semantic_field || '';
        const htmlType = (fieldInfo.type || '').toLowerCase();
        const fieldName = (fieldInfo.name || '').toLowerCase();
        const fieldLabel = (fieldInfo.label || '').toLowerCase();

        // 1. Personal Names
        if (
            semanticType.startsWith('PERSON.FIRST_NAME') ||
            semanticType.startsWith('PERSON.LAST_NAME') ||
            semanticType.startsWith('PERSON.FULL_NAME') ||
            fieldName.includes('name') ||
            fieldLabel.includes('name')
        ) {
            return cleanName(rawTranscript);
        }

        // 2. Email Address
        if (
            semanticType === 'CONTACT.EMAIL' ||
            htmlType === 'email' ||
            fieldName.includes('email') ||
            fieldLabel.includes('email')
        ) {
            return cleanEmail(rawTranscript);
        }

        // 3. Phone / Mobile
        if (
            semanticType === 'CONTACT.PHONE' ||
            semanticType === 'CONTACT.MOBILE' ||
            htmlType === 'tel' ||
            fieldName.includes('phone') ||
            fieldName.includes('mobile') ||
            fieldLabel.includes('phone') ||
            fieldLabel.includes('mobile') ||
            fieldLabel.includes('contact number')
        ) {
            return cleanPhone(rawTranscript);
        }

        // 4. Number / Years of Experience / Rating
        if (
            semanticType === 'WORK.EXPERIENCE_YEARS' ||
            semanticType === 'GENERAL.RATING' ||
            htmlType === 'number' ||
            fieldName.includes('exp') ||
            fieldLabel.includes('experience') ||
            fieldLabel.includes('rating')
        ) {
            return cleanNumber(rawTranscript);
        }

        // 5. Address / Street
        if (
            semanticType.startsWith('ADDRESS.') ||
            fieldName.includes('address') ||
            fieldLabel.includes('address')
        ) {
            return cleanAddress(rawTranscript);
        }

        // Default: Strip conversational prefix and trailing period
        return stripConversationalPrefix(rawTranscript);
    }

    /**
     * Parses compound sentences containing multiple slot values.
     * E.g. "My name is Marshall and my email is marshall@example.com"
     * Returns: { "PERSON.FULL_NAME": "Marshall", "CONTACT.EMAIL": "marshall@example.com" }
     */
    function extractMultiSlot(text) {
        if (!text || typeof text !== 'string') return {};
        const results = {};

        // Extract Email
        const emailMatch = text.match(/(?:email\s+(?:is\s+|address\s+is\s+)?|mail\s+(?:is\s+)?)([\w\.\-]+(?:\s*@\s*|\s+at\s+)[\w\.\-]+(?:\s*\.\s*|\s+dot\s+)[\w]{2,})/i);
        if (emailMatch) {
            results['CONTACT.EMAIL'] = cleanEmail(emailMatch[1]);
        }

        // Extract Name (stopping before connector words)
        const nameMatch = text.match(/(?:my\s+name\s+is|name\s+is|i\s+am)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)(?=\s+(?:and|with|email|phone|contact|address|\.|$))/i);
        if (nameMatch) {
            results['PERSON.FULL_NAME'] = cleanName(nameMatch[1]);
        }

        // Extract Phone
        const phoneMatch = text.match(/(?:phone\s+(?:is|number\s+is)?|mobile\s+(?:is|number\s+is)?|contact\s+(?:is|number\s+is)?)\s+([\d\s\+\-\(\)]{7,})/i);
        if (phoneMatch) {
            results['CONTACT.PHONE'] = cleanPhone(phoneMatch[1]);
        }

        // Extract Experience
        const expMatch = text.match(/(?:experience\s+is|work\s+experience\s+is|\b(?:have|with)\b)\s+(\d+(?:\.\d+)?)\s+years?/i);
        if (expMatch) {
            results['WORK.EXPERIENCE_YEARS'] = expMatch[1];
        }

        return results;
    }

    return {
        detectIntent,
        stripConversationalPrefix,
        cleanName,
        cleanEmail,
        cleanPhone,
        cleanNumber,
        cleanAddress,
        cleanInputForField,
        extractMultiSlot,
        toTitleCase
    };
});

