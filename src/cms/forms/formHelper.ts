interface Validator {
    type: string;
    errorMessage?: string;
    regularExpression?: string;
}


//// VALIDATORS
// Sample of validators JSON structure:
// [{
// 	{"type":"requirevalidator","errorMessage":"This field is required."},
// 	{"type":"emailvalidator","errorMessage":"Enter a valid email address."},
// 	{"type":"numbervalidator","errorMessage":"Invalid number."},
// 	{"type":"regularexpressionvalidator","errorMessage":"This field should be in \\"{0}\\" format.","regularExpression":"s"}
// }]

function parseValidators(validators?: any): Validator[] {
    if (!validators) return [];
    
    // If it's already an array, return it
    if (Array.isArray(validators)) return validators;
    
    // If it's a string, try to parse it as JSON
    if (typeof validators === 'string') {
        try {
            const parsed = JSON.parse(validators);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error('Failed to parse validators JSON:', error);
            return [];
        }
    }
    
    return [];
}

export function isRequiredValidator(validators?: any): boolean {
    const parsedValidators = parseValidators(validators);
    return parsedValidators.some(validator => validator.type === "requirevalidator");
}

export function isEmailValidator(validators?: any): boolean {
    const parsedValidators = parseValidators(validators);
    return parsedValidators.some(validator => validator.type === "emailvalidator");
}

export function isNumberValidator(validators?: any): boolean {
    const parsedValidators = parseValidators(validators);
    return parsedValidators.some(validator => validator.type === "numbervalidator");
}

export function isRegExpValidator(validators?: any): boolean {
    const parsedValidators = parseValidators(validators);
    return parsedValidators.some(validator => validator.type === "regularexpressionvalidator");
}

export function getRegularExpression(validators?: any): string {
    const parsedValidators = parseValidators(validators);
    // const regularExpressionValue = getRegularExpression(validators);
    const regularExpressionValue = "x";
    return regularExpressionValue;
}