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

export function isRequiredValidator(validators?: any): string | undefined {
    const requiredValidator = validators.find(
        (item: Validator) => item.type === 'requirevalidator'
    );

    if (requiredValidator) {
        return requiredValidator?.errorMessage;
    }
    return undefined;
}

export function isEmailValidator(validators?: any): string | undefined {
    const emailValidator = validators.find(
        (item: Validator) => item.type === 'emailvalidator'
    );

    if (emailValidator) {
        return emailValidator?.errorMessage;
    }
    return undefined;
}

export function isNumberValidator(validators?: any): string | undefined {
    const numberValidator = validators.find(
        (item: Validator) => item.type === 'numbervalidator'
    );

    if (numberValidator) {
        return numberValidator?.errorMessage;
    }
    return undefined;
}

export function isRegExpValidator(validators?: any): string | undefined {
    const regExpValidator = validators.find(
        (item: Validator) => item.type === 'regularexpressionvalidator'
    );

    if (regExpValidator) {
        return regExpValidator?.errorMessage;
    }
    return undefined;
}

export function getRegularExpression(validators?: any): string | undefined {
    const regExpValidator = validators.find(
        (item: Validator) => item.type === 'regularexpressionvalidator'
    );

    if (regExpValidator) {
        return regExpValidator?.regularExpressionValue;
    }
    return undefined;
}
