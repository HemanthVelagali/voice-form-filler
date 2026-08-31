// ============================================================
// Voice Form Filler - Universal AI Integration
// ============================================================
//
// Pipeline:
//
//   ASR
//    ↓
//   Speech Cleaner
//    ↓
//   Action Planner
//    ↓
//   Qwen 2.5 3B fallback (only when needed)
//    ↓
//   Validator
//    ↓
//   DOM Executor
//    ↓
//   Actual Form
//
// Existing ASR + TTS WebSockets are preserved.
// ============================================================


// ============================================================
// GLOBAL STATE
// ============================================================

let socket = null;

let voiceSocket = null;
let audioQueue = [];
let isPlaying = false;
let currentSource = null;
let audioContext = null;

let currentResponseString = "";

let displayDiv = document.getElementById("textDisplay");

let server_available = false;
let mic_available = false;

let fullSentences = [];

let mediaRecorder = null;
let audioChunks = [];

let isAskingCorrection = false;

let stream = null;
let isRecording = false;

let activeFieldId = null;

const serverCheckInterval = 5000;

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

let reconnectTimeout = null;


// Local AI service
const AI_SERVER_URL = "http://127.0.0.1:8090";


// ============================================================
// MODULE ACCESS
// ============================================================

function getScanner() {
    return window.FormScanner ||
        (typeof FormScanner !== "undefined" ? FormScanner : null);
}

function getSemanticMapper() {
    return window.SemanticMapper ||
        (typeof SemanticMapper !== "undefined" ? SemanticMapper : null);
}

function getSpeechCleaner() {
    return window.SpeechCleaner ||
        (typeof SpeechCleaner !== "undefined" ? SpeechCleaner : null);
}

function getActionPlanner() {
    return window.ActionPlanner ||
        (typeof ActionPlanner !== "undefined" ? ActionPlanner : null);
}

function getValidator() {
    return window.FormValidator ||
        (typeof FormValidator !== "undefined" ? FormValidator : null);
}

function getDOMExecutor() {
    return window.DOMExecutor ||
        (typeof DOMExecutor !== "undefined" ? DOMExecutor : null);
}


// ============================================================
// FORM SNAPSHOT
// ============================================================

function getFormSnapshot() {

    const scanner = getScanner();

    if (!scanner ||
        typeof scanner.getFormSnapshot !== "function") {

        console.warn("FormScanner unavailable.");

        return null;
    }

    try {

        let snapshot = scanner.getFormSnapshot();

        if (!snapshot) {
            return null;
        }

        // Enrich snapshot with semantic mapping if available.
        const mapper = getSemanticMapper();

        if (
            mapper &&
            typeof mapper.enrichSnapshot === "function"
        ) {
            try {
                snapshot = mapper.enrichSnapshot(snapshot) || snapshot;
            } catch (error) {
                console.warn(
                    "Semantic enrichment failed:",
                    error
                );
            }
        }

        return snapshot;

    } catch (error) {

        console.error(
            "Unable to create form snapshot:",
            error
        );

        return null;
    }
}


// ============================================================
// GET ALL FIELD IDS DYNAMICALLY
// ============================================================

function getDynamicFieldIds() {

    const snapshot = getFormSnapshot();

    if (!snapshot || !Array.isArray(snapshot.forms)) {
        return [];
    }

    const ids = [];

    for (const form of snapshot.forms) {

        if (!Array.isArray(form.fields)) {
            continue;
        }

        for (const field of form.fields) {

            if (
                field &&
                field.id &&
                !ids.includes(field.id)
            ) {
                ids.push(field.id);
            }
        }
    }

    return ids;
}


// ============================================================
// FIND FIELD
// ============================================================

function findFieldById(fieldId) {

    if (!fieldId) {
        return null;
    }

    const snapshot = getFormSnapshot();

    if (!snapshot || !Array.isArray(snapshot.forms)) {
        return null;
    }

    for (const form of snapshot.forms) {

        if (!Array.isArray(form.fields)) {
            continue;
        }

        for (const field of form.fields) {

            if (
                field &&
                (
                    field.id === fieldId ||
                    field.name === fieldId
                )
            ) {
                return field;
            }
        }
    }

    return null;
}


// ============================================================
// ACTIVE FIELD INFO
// ============================================================

function getActiveFieldInfo() {

    if (!activeFieldId) {
        return null;
    }

    const field = findFieldById(activeFieldId);

    if (field) {
        return field;
    }

    const element = document.getElementById(activeFieldId);

    if (!element) {
        return {
            id: activeFieldId,
            name: activeFieldId,
            label: activeFieldId
        };
    }

    return {
        id: element.id,
        name: element.name,
        type: element.type || element.tagName.toLowerCase(),
        label: activeFieldId
    };
}


// ============================================================
// INITIAL ACTIVE FIELD
// ============================================================

function initializeActiveField() {

    const ids = getDynamicFieldIds();

    if (ids.length === 0) {

        console.warn(
            "No form fields discovered."
        );

        return;
    }

    activeFieldId = ids[0];

    setActiveFieldVisualState(activeFieldId);
}


// ============================================================
// ACTIVE FIELD VISUAL STATE
// ============================================================

function setActiveFieldVisualState(fieldId) {

    if (!fieldId) {
        return;
    }

    // Remove previous active state.
    document
        .querySelectorAll(".active-field")
        .forEach(element => {
            element.classList.remove("active-field");
        });

    document
        .querySelectorAll(".recording")
        .forEach(element => {
            element.classList.remove("recording");
        });

    const element = document.getElementById(fieldId);

    if (element) {

        element.classList.add("active-field");

        const group =
            document.getElementById(fieldId + "Group");

        if (
            group &&
            isRecording
        ) {
            group.classList.add("recording");
        }
    }
}


// ============================================================
// SET ACTIVE FIELD
// ============================================================

function setActiveField(newFieldId) {

    if (!newFieldId) {
        return;
    }

    const element = document.getElementById(newFieldId);

    if (!element) {

        console.warn(
            "Cannot activate unknown field:",
            newFieldId
        );

        return;
    }

    activeFieldId = newFieldId;

    setActiveFieldVisualState(newFieldId);

    try {
        element.focus();
    } catch (_) {}

    displayRealtimeText(
        `Active field: ${newFieldId}`,
        displayDiv
    );

    console.log(
        "Active field:",
        newFieldId
    );
}


// ============================================================
// FIELD CLICK / FOCUS LISTENERS
// ============================================================

function attachDynamicFieldListeners() {

    const snapshot = getFormSnapshot();

    if (!snapshot || !Array.isArray(snapshot.forms)) {
        return;
    }

    for (const form of snapshot.forms) {

        if (!Array.isArray(form.fields)) {
            continue;
        }

        for (const field of form.fields) {

            if (!field || !field.id) {
                continue;
            }

            const element =
                document.getElementById(field.id);

            if (!element) {
                continue;
            }

            // Avoid duplicate listeners.
            if (element.dataset.voiceFillerBound === "true") {
                continue;
            }

            element.dataset.voiceFillerBound = "true";

            element.addEventListener(
                "focus",
                () => setActiveField(field.id)
            );

            element.addEventListener(
                "click",
                () => setActiveField(field.id)
            );
        }
    }
}


// ============================================================
// BUILT-IN SPEECH CLEANER FALLBACK
// ============================================================

function inlineCleanSpeech(text, fieldId) {

    if (
        !text ||
        typeof text !== "string"
    ) {
        return "";
    }

    let clean = text
        .trim()

        .replace(
            /^(?:my\s+(?:first\s+name|last\s+name|full\s+name|name|email\s+address|email|phone\s+number|mobile\s+number|phone|mobile|contact\s+number|contact|address|residence|rating|job\s+title|company|experience)\s+(?:is|would\s+be|'s|:))\s*/i,
            ""
        )

        .replace(
            /^(?:the\s+(?:first\s+name|last\s+name|full\s+name|name|email\s+address|email|phone\s+number|mobile\s+number|phone|mobile|contact\s+number|contact|address|residence|rating|job\s+title|company|experience)\s+(?:is|would\s+be|'s|:))\s*/i,
            ""
        )

        .replace(
            /^(?:(?:first\s+name|last\s+name|full\s+name|name|email\s+address|email|phone\s+number|mobile\s+number|phone|mobile|contact\s+number|contact|address|residence|rating|job\s+title|company|experience)\s+(?:is|would\s+be|'s|:))\s*/i,
            ""
        )

        .replace(
            /^(?:i\s+(?:am|live\s+at|reside\s+at|work\s+at))\s*/i,
            ""
        )

        .replace(
            /^(?:please\s+)?(?:enter|put|write|fill|type|insert|set)\s+(?:in\s+|for\s+)?(?:the\s+)?(?:first\s+name|last\s+name|name|email|phone|address|field)?\s*(?:as|to|is|:)?\s*/i,
            ""
        )

        .replace(
            /^(?:it\s+is|it's|this\s+is)\s*/i,
            ""
        )

        .replace(/[.]+$/, "")
        .trim();


    const field = findFieldById(fieldId);

    const semantic =
        field &&
        field.semantic_field
            ? field.semantic_field
            : "";


    // Names
    if (
        semantic.includes("NAME") ||
        (fieldId &&
            (
                fieldId.toLowerCase().includes("name") ||
                fieldId === "fname" ||
                fieldId === "lname"
            ))
    ) {

        clean = clean
            .toLowerCase()
            .split(/\s+/)
            .map(
                word =>
                    word.charAt(0).toUpperCase() +
                    word.slice(1)
            )
            .join(" ");
    }


    // Email
    if (
        semantic.includes("EMAIL") ||
        (
            fieldId &&
            fieldId.toLowerCase().includes("email")
        )
    ) {

        clean = clean
            .replace(
                /\s+(?:at\s+the\s+rate|at)\s+/gi,
                "@"
            )
            .replace(
                /\s+dot\s+/gi,
                "."
            )
            .replace(/\s+/g, "")
            .toLowerCase();
    }


    // Phone
    if (
        semantic.includes("PHONE") ||
        semantic.includes("MOBILE") ||
        (
            fieldId &&
            (
                fieldId.toLowerCase().includes("phone") ||
                fieldId.toLowerCase().includes("mobile") ||
                fieldId.toLowerCase().includes("contact")
            )
        )
    ) {

        clean = clean.replace(/[^\d+]/g, "");
    }

    return clean;
}


// ============================================================
// CLEAN SPEECH
// ============================================================

function cleanSpeech(text) {

    const cleaner = getSpeechCleaner();

    const fieldInfo =
        getActiveFieldInfo();

    if (
        cleaner &&
        typeof cleaner.cleanInputForField === "function"
    ) {

        try {

            const cleaned =
                cleaner.cleanInputForField(
                    text,
                    fieldInfo
                );

            if (cleaned !== undefined && cleaned !== null) {
                return cleaned;
            }

        } catch (error) {

            console.warn(
                "SpeechCleaner failed:",
                error
            );
        }
    }

    return inlineCleanSpeech(
        text,
        activeFieldId
    );
}


// ============================================================
// VALIDATION
// ============================================================

function validateValue(
    value,
    fieldInfo,
    fieldElement
) {

    const validator = getValidator();

    if (!validator) {
        return {
            valid: true,
            errors: [],
            warnings: []
        };
    }

    if (
        value === "" ||
        value === null ||
        value === undefined
    ) {
        return {
            valid: true,
            errors: [],
            warnings: []
        };
    }

    try {

        if (
            fieldElement &&
            typeof validator.validateFromElement === "function"
        ) {

            return validator.validateFromElement(
                value,
                fieldElement,
                {
                    semantic_field:
                        fieldInfo?.semantic_field || "",

                    label:
                        fieldInfo?.label ||
                        fieldInfo?.human_label ||
                        activeFieldId
                }
            );
        }

        if (
            typeof validator.validate === "function"
        ) {

            return validator.validate(
                value,
                fieldInfo
            );
        }

    } catch (error) {

        console.error(
            "Validator error:",
            error
        );

        return {
            valid: false,
            errors: ["Unable to validate this value."],
            warnings: []
        };
    }

    return {
        valid: true,
        errors: [],
        warnings: []
    };
}


// ============================================================
// DOM EXECUTOR
// ============================================================

function getExecutorInstance() {

    const executor = getDOMExecutor();

    if (!executor) {
        return null;
    }

    // Some implementations expose methods directly.
    if (
        typeof executor.setValue === "function" ||
        typeof executor.selectOption === "function"
    ) {
        return executor;
    }

    // Some implementations expose a class.
    if (typeof executor === "function") {

        try {
            return new executor();
        } catch (error) {

            console.warn(
                "Could not instantiate DOMExecutor:",
                error
            );

            return null;
        }
    }

    return null;
}


// ============================================================
// EXECUTE DOM ACTION
// ============================================================

function executeDOMAction(plan) {

    if (!plan) {
        return false;
    }

    const executor = getExecutorInstance();

    if (!executor) {

        console.error(
            "DOMExecutor unavailable."
        );

        return false;
    }

    const action =
        plan.action;

    const target =
        plan.targetFieldId ||
        plan.fieldId ||
        plan.target;

    const value =
        plan.value;

    console.log(
        "Executing DOM action:",
        plan
    );


    try {

        // ----------------------------------------------------
        // FILL
        // ----------------------------------------------------

        if (
            action === "FILL_VALUE" ||
            action === "SET_VALUE"
        ) {

            if (
                typeof executor.setValue !== "function"
            ) {
                return false;
            }

            return executor.setValue(
                target,
                value ?? ""
            );
        }


        // ----------------------------------------------------
        // SELECT
        // ----------------------------------------------------

        if (
            action === "SELECT_OPTION"
        ) {

            if (
                typeof executor.selectOption !== "function"
            ) {
                return false;
            }

            return executor.selectOption(
                target,
                value
            );
        }


        // ----------------------------------------------------
        // RADIO
        // ----------------------------------------------------

        if (
            action === "SET_RADIO"
        ) {

            if (
                typeof executor.setRadio !== "function"
            ) {
                return false;
            }

            return executor.setRadio(
                target,
                value
            );
        }


        // ----------------------------------------------------
        // CHECKBOX
        // ----------------------------------------------------

        if (
            action === "TOGGLE_CHECKBOX"
        ) {

            if (
                typeof executor.setCheckbox !== "function"
            ) {
                return false;
            }

            // If planner supplied explicit checked state,
            // respect it. Otherwise toggle/select it.
            const checked =
                plan.checked !== undefined
                    ? plan.checked
                    : true;

            return executor.setCheckbox(
                target,
                checked
            );
        }


        // ----------------------------------------------------
        // CLEAR
        // ----------------------------------------------------

        if (
            action === "CLEAR_FIELD"
        ) {

            if (
                typeof executor.clearField === "function"
            ) {

                return executor.clearField(
                    target
                );
            }

            if (
                typeof executor.setValue === "function"
            ) {

                return executor.setValue(
                    target,
                    ""
                );
            }

            return false;
        }


        // ----------------------------------------------------
        // NAVIGATION
        // ----------------------------------------------------

        if (
            action === "NAVIGATE_TO_FIELD"
        ) {

            setActiveField(target);

            return true;
        }


        // ----------------------------------------------------
        // NEXT
        // ----------------------------------------------------

        if (
            action === "NEXT_FIELD"
        ) {

            moveToNextField();

            return true;
        }


        // ----------------------------------------------------
        // PREVIOUS
        // ----------------------------------------------------

        if (
            action === "PREVIOUS_FIELD"
        ) {

            moveToPreviousField();

            return true;
        }


        // ----------------------------------------------------
        // SUBMIT
        // ----------------------------------------------------

        if (
            action === "SUBMIT_FORM"
        ) {

            const form =
                document.querySelector("form");

            if (form) {

                form.requestSubmit
                    ? form.requestSubmit()
                    : form.submit();

                return true;
            }

            return false;
        }


        return false;

    } catch (error) {

        console.error(
            "DOMExecutor action failed:",
            error
        );

        return false;
    }
}


// ============================================================
// COMMIT VALUE THROUGH DOM EXECUTOR
// ============================================================

function commitValue(
    value,
    fieldId = activeFieldId
) {

    const fieldInfo =
        findFieldById(fieldId);

    const fieldElement =
        document.getElementById(fieldId);

    // --------------------------------------------
    // Validate first
    // --------------------------------------------

    const validation =
        validateValue(
            value,
            fieldInfo || {},
            fieldElement
        );


    if (
        validation &&
        validation.valid === false
    ) {

        console.warn(
            "Value rejected:",
            validation.errors
        );

        if (
            getValidator() &&
            typeof getValidator().applyVisualFeedback === "function" &&
            fieldElement
        ) {

            getValidator().applyVisualFeedback(
                fieldElement,
                validation
            );
        }

        const message =
            validation.errors &&
            validation.errors.length
                ? validation.errors[0]
                : "Invalid value.";

        displayRealtimeText(
            "⚠ " + message,
            displayDiv
        );

        document
            .getElementById("confirmationMessage")
            .textContent =
                "Validation error — please try again.";

        announce(
            validation.suggestion ||
            message
        );

        return false;
    }


    // --------------------------------------------
    // Execute through Phase 6
    // --------------------------------------------

    const success =
        executeDOMAction({
            action: "FILL_VALUE",
            targetFieldId: fieldId,
            value: value
        });


    if (!success) {

        console.error(
            "DOMExecutor could not fill:",
            fieldId
        );

        // Last-resort fallback.
        // This should only happen if DOMExecutor
        // is unavailable.
        if (fieldElement) {

            fieldElement.value =
                value ?? "";

            fieldElement.dispatchEvent(
                new Event(
                    "input",
                    {
                        bubbles: true
                    }
                )
            );

            fieldElement.dispatchEvent(
                new Event(
                    "change",
                    {
                        bubbles: true
                    }
                )
            );

        } else {

            return false;
        }
    }


    // --------------------------------------------
    // Visual validation feedback
    // --------------------------------------------

    if (
        getValidator() &&
        typeof getValidator().applyVisualFeedback === "function" &&
        fieldElement
    ) {

        getValidator().applyVisualFeedback(
            fieldElement,
            validation || {
                valid: true,
                errors: [],
                warnings: []
            }
        );
    }


    // --------------------------------------------
    // Warnings
    // --------------------------------------------

    if (
        validation &&
        validation.warnings &&
        validation.warnings.length
    ) {

        displayRealtimeText(
            "💡 " +
            validation.warnings[0],
            displayDiv
        );

    } else {

        displayRealtimeText(
            "",
            displayDiv
        );
    }


    return true;
}


// ============================================================
// AI FALLBACK
// ============================================================

async function askLocalAI(
    utterance,
    snapshot,
    activeField
) {

    try {

        console.log(
            "Calling local Qwen fallback..."
        );

        const response =
            await fetch(
                `${AI_SERVER_URL}/ai/decide`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        utterance,
                        form_snapshot:
                            snapshot,

                        active_field:
                            activeField || null
                    })
                }
            );


        if (!response.ok) {

            throw new Error(
                `AI server returned ${response.status}`
            );
        }


        const result =
            await response.json();


        console.log(
            "Qwen action:",
            result
        );


        if (
            !result ||
            !result.action
        ) {

            return null;
        }


        return result;

    } catch (error) {

        console.error(
            "Local AI fallback failed:",
            error
        );

        return null;
    }
}


// ============================================================
// NORMALIZE AI ACTION
// ============================================================

function normalizeAIAction(
    action,
    snapshot
) {

    if (!action) {
        return null;
    }

    // AI already returned a DOM target.
    if (action.targetFieldId) {
        return action;
    }

    // AI returned semantic field.
    if (action.semanticField) {

        if (
            snapshot &&
            Array.isArray(snapshot.forms)
        ) {

            for (const form of snapshot.forms) {

                if (!Array.isArray(form.fields)) {
                    continue;
                }

                for (const field of form.fields) {

                    if (
                        field.semantic_field ===
                        action.semanticField
                    ) {

                        return {
                            ...action,

                            targetFieldId:
                                field.id
                        };
                    }
                }
            }
        }
    }

    return action;
}


// ============================================================
// PLANNER
// ============================================================

async function planCommand(
    rawText
) {

    const planner =
        getActionPlanner();

    const snapshot =
        getFormSnapshot();

    const activeField =
        getActiveFieldInfo();


    // --------------------------------------------------------
    // First use deterministic planner.
    // --------------------------------------------------------

    if (
        planner &&
        typeof planner.planAction === "function"
    ) {

        try {

            const plan =
                planner.planAction(
                    rawText,
                    {
                        activeFieldId,
                        formSnapshot: snapshot
                    }
                );


            console.log(
                "Deterministic plan:",
                plan
            );


            // If planner understood it,
            // don't spend time calling Qwen.
            if (
                plan &&
                plan.action &&
                plan.action !== "NOOP"
            ) {

                return plan;
            }

        } catch (error) {

            console.warn(
                "ActionPlanner failed:",
                error
            );
        }
    }


    // --------------------------------------------------------
    // Planner could not understand it.
    // Use local Qwen.
    // --------------------------------------------------------

    const aiAction =
        await askLocalAI(
            rawText,
            snapshot,
            activeField
        );


    return normalizeAIAction(
        aiAction,
        snapshot
    );
}


// ============================================================
// PROCESS ACTION
// ============================================================

async function processAction(
    plan,
    rawText,
    data
) {

    if (!plan) {

        console.warn(
            "No action generated."
        );

        return false;
    }


    console.log(
        "Final action:",
        plan
    );


    const action =
        plan.action;


    // ========================================================
    // NEXT
    // ========================================================

    if (
        action === "NEXT_FIELD"
    ) {

        displayRealtimeText(
            "Command: Next Field",
            displayDiv
        );

        moveToNextField();

        announce(
            "Moving to next field."
        );

        return true;
    }


    // ========================================================
    // PREVIOUS
    // ========================================================

    if (
        action === "PREVIOUS_FIELD"
    ) {

        displayRealtimeText(
            "Command: Previous Field",
            displayDiv
        );

        moveToPreviousField();

        announce(
            "Moving to previous field."
        );

        return true;
    }


    // ========================================================
    // NAVIGATE
    // ========================================================

    if (
        action === "NAVIGATE_TO_FIELD"
    ) {

        const target =
            plan.targetFieldId ||
            plan.fieldId ||
            plan.target;


        if (!target) {

            announce(
                "I could not identify that field."
            );

            return false;
        }


        setActiveField(target);

        announce(
            `Moving to ${target}.`
        );

        return true;
    }


    // ========================================================
    // CLEAR
    // ========================================================

    if (
        action === "CLEAR_FIELD"
    ) {

        const target =
            plan.targetFieldId ||
            activeFieldId;


        const success =
            executeDOMAction({
                action: "CLEAR_FIELD",
                targetFieldId: target
            });


        if (success) {

            displayRealtimeText(
                "Field cleared.",
                displayDiv
            );

            announce(
                "Field cleared."
            );
        }

        return success;
    }


    // ========================================================
    // SUBMIT
    // ========================================================

    if (
        action === "SUBMIT_FORM"
    ) {

        const validator =
            getValidator();

        const form =
            document.querySelector("form");


        // Validate browser form before submission.
        if (
            form &&
            typeof form.checkValidity === "function" &&
            !form.checkValidity()
        ) {

            displayRealtimeText(
                "⚠ Please complete the required fields.",
                displayDiv
            );

            announce(
                "Please complete the required fields before submitting."
            );

            return false;
        }


        executeDOMAction({
            action: "SUBMIT_FORM"
        });


        announce(
            "Submitting form."
        );

        return true;
    }


    // ========================================================
    // SELECT / RADIO / CHECKBOX
    // ========================================================

    if (
        action === "SELECT_OPTION" ||
        action === "SET_RADIO" ||
        action === "TOGGLE_CHECKBOX"
    ) {

        const target =
            plan.targetFieldId ||
            plan.fieldId ||
            plan.target;


        if (!target) {

            announce(
                "I could not identify the target field."
            );

            return false;
        }


        const field =
            findFieldById(target);


        // Validate option/value when possible.
        if (
            action === "SELECT_OPTION" ||
            action === "SET_RADIO"
        ) {

            const options =
                field &&
                Array.isArray(field.options)
                    ? field.options
                    : [];


            if (options.length > 0) {

                const requested =
                    String(
                        plan.value ?? ""
                    ).toLowerCase();


                const found =
                    options.some(option => {

                        const text =
                            String(
                                option.text ??
                                option.label ??
                                ""
                            ).toLowerCase();

                        const value =
                            String(
                                option.value ??
                                ""
                            ).toLowerCase();

                        return (
                            requested === text ||
                            requested === value ||
                            text.includes(requested)
                        );
                    });


                if (!found) {

                    displayRealtimeText(
                        "⚠ That option is not available.",
                        displayDiv
                    );

                    announce(
                        "That option is not available in this field."
                    );

                    return false;
                }
            }
        }


        const success =
            executeDOMAction({
                ...plan,
                targetFieldId: target
            });


        if (success) {

            const message =
                plan.message ||
                `${action.replaceAll("_", " ").toLowerCase()} completed.`;


            displayRealtimeText(
                message,
                displayDiv
            );

            announce(message);
        }

        return success;
    }


    // ========================================================
    // FILL VALUE
    // ========================================================

    if (
        action === "FILL_VALUE"
    ) {

        const target =
            plan.targetFieldId ||
            plan.fieldId ||
            activeFieldId;


        const value =
            plan.value ?? "";


        if (!target) {

            announce(
                "I could not identify the field to fill."
            );

            return false;
        }


        // If AI returned another field,
        // make it the active field.
        if (target !== activeFieldId) {
            setActiveField(target);
        }


        const field =
            findFieldById(target);


        // --------------------------------------------
        // Clean the value
        // --------------------------------------------

        let cleanedValue =
            value;


        const cleaner =
            getSpeechCleaner();


        if (
            cleaner &&
            typeof cleaner.cleanInputForField === "function"
        ) {

            try {

                cleanedValue =
                    cleaner.cleanInputForField(
                        String(value),
                        field
                    );

            } catch (error) {

                console.warn(
                    "AI value cleaning failed:",
                    error
                );

                cleanedValue =
                    inlineCleanSpeech(
                        String(value),
                        target
                    );
            }

        } else {

            cleanedValue =
                inlineCleanSpeech(
                    String(value),
                    target
                );
        }


        // --------------------------------------------
        // Commit through Validator + DOMExecutor
        // --------------------------------------------

        const success =
            commitValue(
                cleanedValue,
                target
            );


        if (!success) {
            return false;
        }


        currentResponseString =
            cleanedValue;


        displayRealtimeText(
            cleanedValue,
            displayDiv
        );


        const rtf =
            data &&
            typeof data.rtf === "number"
                ? data.rtf
                : 0;


        document
            .getElementById(
                "confirmationMessage"
            )
            .textContent =
                `Was this correctly recognized? (RTF: ${rtf.toFixed(2)})`;


        announce(
            cleanedValue +
            " — Was this correctly recognized?"
        );


        return true;
    }


    // ========================================================
    // NOOP
    // ========================================================

    if (
        action === "NOOP"
    ) {

        displayRealtimeText(
            "I couldn't determine the requested form action.",
            displayDiv
        );

        announce(
            "I couldn't determine what you want me to do."
        );

        return false;
    }


    return false;
}


// ============================================================
// ASR SERVER CONNECTION
// ============================================================

function connectToServer() {

    if (reconnectTimeout) {

        clearTimeout(
            reconnectTimeout
        );

        reconnectTimeout = null;
    }


    if (socket) {

        try {
            socket.close();
        } catch (_) {}
    }


    try {

        socket =
            new WebSocket(
                "ws://localhost:8001"
            );


        socket.onopen =
            function () {

                server_available = true;

                reconnectAttempts = 0;

                updateStatus(
                    "Server connected"
                );

                console.log(
                    "ASR WebSocket connected"
                );
            };


        socket.onmessage =
            async function (event) {

                try {

                    const data =
                        JSON.parse(
                            event.data
                        );


                    if (
                        data.type !==
                        "fullSentence"
                    ) {

                        if (
                            data.type === "error"
                        ) {

                            updateStatus(
                                `Error: ${data.message}`
                            );

                            console.error(
                                "Server error:",
                                data.message
                            );
                        }

                        return;
                    }


                    const rawText =
                        data.text;


                    if (!rawText) {
                        return;
                    }


                    console.log(
                        "ASR:",
                        rawText
                    );


                    // =================================================
                    // CORRECTION MODE
                    // =================================================

                    if (
                        isAskingCorrection
                    ) {

                        const corrected =
                            await askLocalAI(
                                `Correct the following value according to this instruction: ${rawText}. Current value: ${currentResponseString}`,
                                getFormSnapshot(),
                                getActiveFieldInfo()
                            );


                        isAskingCorrection =
                            false;


                        if (
                            corrected &&
                            corrected.value !== undefined
                        ) {

                            commitValue(
                                corrected.value,
                                activeFieldId
                            );

                        } else {

                            const fallback =
                                cleanSpeech(
                                    rawText
                                );

                            commitValue(
                                fallback,
                                activeFieldId
                            );
                        }


                        return;
                    }


                    // =================================================
                    // ACTION PLANNING
                    // =================================================

                    const plan =
                        await planCommand(
                            rawText
                        );


                    if (
                        plan &&
                        plan.action &&
                        plan.action !== "NOOP"
                    ) {

                        await processAction(
                            plan,
                            rawText,
                            data
                        );

                        return;
                    }


                    // =================================================
                    // FINAL FALLBACK:
                    // Treat speech as value for active field.
                    // =================================================

                    const result =
                        cleanSpeech(
                            rawText
                        );


                    if (
                        result
                    ) {

                        commitValue(
                            result,
                            activeFieldId
                        );

                        currentResponseString =
                            result;

                        fullSentences.push(
                            rawText
                        );

                        displayRealtimeText(
                            result,
                            displayDiv
                        );

                        document
                            .getElementById(
                                "confirmationMessage"
                            )
                            .textContent =
                                `Was this correctly recognized? (RTF: ${
                                    typeof data.rtf === "number"
                                        ? data.rtf.toFixed(2)
                                        : "0.00"
                                })`;

                        announce(
                            result +
                            " — Was this correctly recognized?"
                        );
                    }

                } catch (error) {

                    console.error(
                        "Error processing ASR message:",
                        error,
                        event.data
                    );
                }
            };


        socket.onclose =
            function (event) {

                server_available =
                    false;

                updateStatus(
                    "Server disconnected"
                );


                if (isRecording) {
                    stopRecording();
                }


                if (
                    reconnectAttempts <
                    MAX_RECONNECT_ATTEMPTS
                ) {

                    reconnectAttempts++;


                    reconnectTimeout =
                        setTimeout(
                            connectToServer,
                            Math.min(
                                1000 *
                                Math.pow(
                                    2,
                                    reconnectAttempts
                                ),
                                16000
                            )
                        );

                } else {

                    updateStatus(
                        "Failed to reconnect to recognition server."
                    );
                }
            };


        socket.onerror =
            function (error) {

                console.error(
                    "ASR WebSocket error:",
                    error
                );
            };


    } catch (error) {

        console.error(
            "Could not create ASR WebSocket:",
            error
        );

        server_available = false;
    }
}


// ============================================================
// AUDIO CONTEXT
// ============================================================

function initAudioContext() {

    if (!audioContext) {

        audioContext =
            new (
                window.AudioContext ||
                window.webkitAudioContext
            )();
    }

    return audioContext;
}


// ============================================================
// DISPLAY
// ============================================================

function displayRealtimeText(
    realtimeText,
    target
) {

    if (!target) {
        return;
    }


    const displayedText =
        fullSentences
            .map(
                (sentence, index) =>
                    `<span class="${
                        index % 2 === 0
                            ? "yellow"
                            : "cyan"
                    }">${sentence} </span>`
            )
            .join("") +
        realtimeText;


    target.innerHTML =
        displayedText;
}


// ============================================================
// STATUS
// ============================================================

function updateStatus(message) {

    console.log(
        "Status:",
        message
    );


    if (!mic_available) {

        displayRealtimeText(
            "🎤 Please allow microphone access 🎤",
            displayDiv
        );

    } else if (!server_available) {

        displayRealtimeText(
            "🖥️ Please start the recognition server 🖥️",
            displayDiv
        );

    } else if (message) {

        displayRealtimeText(
            message,
            displayDiv
        );
    }
}


// ============================================================
// START RECORDING
// ============================================================

function startRecording() {

    if (!mic_available) {

        alert(
            "Microphone access is not available."
        );

        return;
    }


    if (!server_available) {

        alert(
            "Recognition server is not connected."
        );

        return;
    }


    if (isRecording) {
        return;
    }


    isRecording = true;


    document
        .getElementById(
            "startRecording"
        )
        .disabled = true;


    document
        .getElementById(
            "stopRecording"
        )
        .disabled = false;


    fullSentences = [];

    audioChunks = [];


    displayRealtimeText(
        "Listening...",
        displayDiv
    );


    setActiveFieldVisualState(
        activeFieldId
    );


    if (stream) {

        startAudioProcessing();

    } else {

        navigator
            .mediaDevices
            .getUserMedia({
                audio: true
            })

            .then(
                receivedStream => {

                    stream =
                        receivedStream;

                    mic_available = true;

                    startAudioProcessing();
                }
            )

            .catch(
                error => {

                    console.error(
                        "Microphone error:",
                        error
                    );

                    updateStatus(
                        "Failed to access microphone."
                    );

                    isRecording = false;
                }
            );
    }
}


// ============================================================
// AUDIO PROCESSING
// ============================================================

function startAudioProcessing() {

    try {

        mediaRecorder =
            new MediaRecorder(
                stream,
                {
                    mimeType:
                        "audio/webm"
                }
            );


        mediaRecorder.ondataavailable =
            function (event) {

                if (
                    event.data.size > 0
                ) {

                    audioChunks.push(
                        event.data
                    );


                    if (
                        socket &&
                        socket.readyState ===
                            WebSocket.OPEN
                    ) {

                        socket.send(
                            event.data
                        );

                    } else {

                        console.error(
                            "ASR socket not open."
                        );

                        connectToServer();
                    }
                }
            };


        mediaRecorder.onerror =
            function (error) {

                console.error(
                    "MediaRecorder error:",
                    error
                );
            };


        mediaRecorder.start(100);

    } catch (error) {

        console.error(
            "Could not start recording:",
            error
        );
    }
}


// ============================================================
// STOP RECORDING
// ============================================================

function stopRecording() {

    if (!isRecording) {
        return;
    }


    isRecording = false;


    document
        .getElementById(
            "startRecording"
        )
        .disabled = false;


    document
        .getElementById(
            "stopRecording"
        )
        .disabled = true;


    if (
        mediaRecorder &&
        mediaRecorder.state !== "inactive"
    ) {

        mediaRecorder.stop();


        mediaRecorder.onstop =
            function () {

                if (
                    audioChunks.length === 0
                ) {

                    updateStatus(
                        "No audio recorded."
                    );

                    return;
                }


                if (
                    socket &&
                    socket.readyState ===
                        WebSocket.OPEN
                ) {

                    socket.send(
                        JSON.stringify({
                            type: "stop"
                        })
                    );


                    displayRealtimeText(
                        "Processing audio...",
                        displayDiv
                    );
                }


                audioChunks = [];
            };
    }
}


// ============================================================
// MOVE TO NEXT FIELD
// ============================================================

function moveToNextField() {

    const ids =
        getDynamicFieldIds();


    if (
        ids.length === 0
    ) {
        return;
    }


    const currentIndex =
        ids.indexOf(
            activeFieldId
        );


    const nextIndex =
        currentIndex >= 0 &&
        currentIndex < ids.length - 1
            ? currentIndex + 1
            : 0;


    setActiveField(
        ids[nextIndex]
    );


    fullSentences = [];


    document
        .getElementById(
            "confirmationMessage"
        )
        .textContent = "";


    displayRealtimeText(
        `Now recording for ${activeFieldId}...`,
        displayDiv
    );
}


// ============================================================
// MOVE TO PREVIOUS FIELD
// ============================================================

function moveToPreviousField() {

    const ids =
        getDynamicFieldIds();


    if (
        ids.length === 0
    ) {
        return;
    }


    const currentIndex =
        ids.indexOf(
            activeFieldId
        );


    const previousIndex =
        currentIndex > 0
            ? currentIndex - 1
            : ids.length - 1;


    setActiveField(
        ids[previousIndex]
    );


    fullSentences = [];


    document
        .getElementById(
            "confirmationMessage"
        )
        .textContent = "";


    displayRealtimeText(
        `Now recording for ${activeFieldId}...`,
        displayDiv
    );
}


// ============================================================
// ASK CORRECTION
// ============================================================

function askCorrection() {

    isAskingCorrection = true;

    startRecording();
}


// ============================================================
// TTS ANNOUNCEMENT
// ============================================================

function announce(message) {

    if (!message) {
        return;
    }


    initAudioContext();


    audioQueue = [];

    isPlaying = false;


    if (voiceSocket) {

        try {
            voiceSocket.close();
        } catch (_) {}
    }


    voiceSocket =
        new WebSocket(
            "ws://localhost:8000/ws/stream"
        );


    voiceSocket.onopen =
        function () {

            voiceSocket.send(
                JSON.stringify({
                    text: message,
                    voice: "af_nicole",
                    speed: 1.0,
                    language: "en-us"
                })
            );
        };


    voiceSocket.onmessage =
        async function (event) {

            if (
                event.data instanceof Blob
            ) {

                const arrayBuffer =
                    await event.data.arrayBuffer();


                audioQueue.push(
                    arrayBuffer
                );


                if (!isPlaying) {
                    playNextInQueue();
                }

            } else {

                console.log(
                    "TTS server:",
                    event.data
                );
            }
        };


    voiceSocket.onerror =
        function (error) {

            console.error(
                "TTS WebSocket error:",
                error
            );
        };
}


// ============================================================
// PLAY AUDIO
// ============================================================

async function playNextInQueue() {

    if (
        audioQueue.length === 0
    ) {

        isPlaying = false;

        return;
    }


    isPlaying = true;


    const arrayBuffer =
        audioQueue.shift();


    try {

        const audioBuffer =
            await audioContext.decodeAudioData(
                arrayBuffer
            );


        currentSource =
            audioContext.createBufferSource();


        currentSource.buffer =
            audioBuffer;


        currentSource.connect(
            audioContext.destination
        );


        currentSource.start(0);


        currentSource.onended =
            function () {

                currentSource = null;

                playNextInQueue();
            };


    } catch (error) {

        console.error(
            "Audio playback error:",
            error
        );

        playNextInQueue();
    }
}


// ============================================================
// INITIALIZATION
// ============================================================

function initializeApplication() {

    console.log(
        "Initializing Universal AI Form Filler..."
    );


    // Scanner should already be loaded
    // because voice-form.html loads the scripts
    // before fill.js.


    initializeActiveField();

    attachDynamicFieldListeners();


    connectToServer();


    navigator
        .mediaDevices
        .getUserMedia({
            audio: true
        })

        .then(
            receivedStream => {

                stream =
                    receivedStream;

                mic_available = true;

                updateStatus(
                    "Microphone access granted. Ready."
                );
            }
        )

        .catch(
            error => {

                console.error(
                    "Microphone access failed:",
                    error
                );

                updateStatus(
                    "Failed to access microphone."
                );
            }
        );


    setInterval(
        () => {

            // Re-scan because modern forms can
            // dynamically add/remove fields.
            attachDynamicFieldListeners();


            if (
                !server_available &&
                !reconnectTimeout
            ) {

                connectToServer();
            }

        },
        serverCheckInterval
    );


    // --------------------------------------------------------
    // UI events
    // --------------------------------------------------------

    const startButton =
        document.getElementById(
            "startRecording"
        );

    if (startButton) {

        startButton.addEventListener(
            "click",
            startRecording
        );
    }


    const stopButton =
        document.getElementById(
            "stopRecording"
        );

    if (stopButton) {

        stopButton.addEventListener(
            "click",
            stopRecording
        );
    }


    const nextButton =
        document.getElementById(
            "lookGood"
        );

    if (nextButton) {

        nextButton.addEventListener(
            "click",
            moveToNextField
        );
    }


    const correctionButton =
        document.getElementById(
            "askCorrect"
        );

    if (correctionButton) {

        correctionButton.addEventListener(
            "click",
            askCorrection
        );
    }


    const form =
        document.getElementById(
            "voiceForm"
        );


    if (form) {

        form.addEventListener(
            "submit",
            function (event) {

                event.preventDefault();

                console.log(
                    "Form submission intercepted."
                );
            }
        );
    }


    console.log(
        "Universal AI Form Filler initialized."
    );
}


// ============================================================
// START
// ============================================================

initializeApplication();